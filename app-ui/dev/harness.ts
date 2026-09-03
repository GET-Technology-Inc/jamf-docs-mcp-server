/**
 * A local MCP Apps host, for looking at the viewer while you change it.
 *
 * The viewer is an MCP App: it only ever runs inside a host, in a sandboxed
 * iframe, talking `postMessage` JSON-RPC to something that hands it tool
 * results and design tokens. That makes the obvious iteration loop — edit CSS,
 * look at it — unavailable, because there is nothing to look at without a
 * host. The loop everyone reaches for instead is `npm run build && npm run
 * test:inspector && click through to the app`, which is tens of seconds per
 * edit and reconnects the server every time.
 *
 * `AppBridge` is the SDK's host-side half, and its constructor takes
 * `Client | null` — a host with no MCP server behind it is a supported mode,
 * not a hack. So this is a real host, speaking the real protocol to the real
 * `App` class, that answers `tools/call` out of a fixture file instead of out
 * of Fluid Topics. An edit is a browser reload.
 *
 * It also does three things no inspector can:
 *
 *  - **Strip `hostContext.styles` entirely.** Hosts may send any subset of the
 *    76 style variables, so the viewer's `:root` block has to be a coherent
 *    palette on its own rather than a pile of per-token guesses. Turning the
 *    tokens off is the only way to see whether it is.
 *  - **Resize the container continuously.** The viewer's layout is driven by
 *    `@container` queries against a panel that is ~320px in a sidebar and
 *    ~900px in fullscreen. A slider walks the whole range in one gesture.
 *  - **Lie about the device.** `deviceCapabilities.hover` is what separates a
 *    hover-reveal affordance from an invisible one on a touch host.
 *
 * Not a substitute for `npm run test:inspector`, which is the only thing that
 * exercises the real `ui://` resource, the real CSP and the real `_meta`. Use
 * this to design; use the inspector before shipping.
 */

import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiHostContext, McpUiTheme } from '@modelcontextprotocol/ext-apps';
import rawFixtures from './fixtures.json';
import { DARK, HOST_CANVAS, LIGHT } from './host-styles.js';

interface Fixture {
  key: string;
  label: string;
  why: string;
  tool: string;
  arguments: Record<string, unknown>;
  structuredContent: Record<string, unknown>;
}

const fixtures = rawFixtures as unknown as Fixture[];

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** Everything the toolbar can change, in one object so `rebuild` has one input. */
const state = {
  fixture: fixtures[0]?.key ?? '',
  theme: 'light' as McpUiTheme,
  /** Whether to send `hostContext.styles` at all. The load-bearing toggle. */
  styles: true,
  width: 420,
  mode: 'inline' as 'inline' | 'fullscreen',
  hover: true,
  locale: 'en-US',
  /**
   * How a `tools/call` behaves. The loading and error views are otherwise
   * unreachable — a fixture answers in the same tick and never fails — so the
   * two states nobody has looked at are the two that need this most.
   */
  behaviour: 'instant',
  /**
   * What the host claims it has room for, as a string so the radio group can
   * carry 'none' — the case that matters most, since a host that states no
   * budget is exactly the one the viewer has to bound itself for.
   */
  budget: '640',
};

function need<T extends Element>(selector: string, _hint?: T): T {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`harness.html is missing ${selector}`);
  }
  return element as T;
}

const frame = need<HTMLIFrameElement>('#frame');
const stage = need<HTMLDivElement>('#stage');
const panel = need<HTMLDivElement>('#panel');
const logList = need<HTMLDivElement>('#log');
const fixtureSelect = need<HTMLSelectElement>('#fixture');
const fixtureWhy = need<HTMLParagraphElement>('#why');

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

/**
 * Every protocol event, newest first.
 *
 * This is the half of the loop that CSS cannot show you: a click that renders
 * nothing is either a dead handler or a tool call the host answered with the
 * wrong fixture, and those look identical in the panel.
 */
function log(kind: string, detail: string): void {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.dataset.kind = kind;
  row.innerHTML = `<span class="log-kind">${kind}</span><span class="log-detail"></span>`;
  const target = row.querySelector('.log-detail');
  if (target !== null) {
    target.textContent = detail;
  }
  logList.prepend(row);
  while (logList.childElementCount > 80) {
    logList.lastElementChild?.remove();
  }
}

// ---------------------------------------------------------------------------
// Fixture routing
// ---------------------------------------------------------------------------

const byKey = new Map(fixtures.map((f) => [f.key, f]));

function current(): Fixture | undefined {
  return byKey.get(state.fixture);
}

/**
 * Answer a `tools/call` the viewer made, out of the fixture set.
 *
 * Matching is by tool name with a preference for the fixture whose arguments
 * look like the request, rather than by exact argument equality: the viewer
 * calls `jamf_docs_get_article` with whatever URL the user clicked, and no
 * fixture set can hold every article in the Jamf corpus. Returning *an*
 * article for an article request is what keeps click-through navigable, which
 * is the thing being designed.
 */
function answer(name: string, args: Record<string, unknown>): Fixture | undefined {
  const candidates = fixtures.filter((f) => f.tool === name);
  if (candidates.length === 0) {
    return undefined;
  }

  // A `page` above 1 is the "Load more" path; prefer a fixture that actually
  // has more pages so the button does something visible.
  const page = typeof args.page === 'number' ? args.page : 1;
  if (page > 1) {
    const paged = candidates.find(
      (f) => (f.structuredContent.totalPages as number | undefined ?? 1) > 1,
    );
    if (paged !== undefined) {
      return paged;
    }
  }

  // Prefer one whose captured query/url matches, so clicking a suggestion in
  // the empty state lands on the populated result set rather than back on the
  // empty one.
  const query = typeof args.query === 'string' ? args.query.toLowerCase() : null;
  if (query !== null) {
    const match = candidates.find(
      (f) =>
        typeof f.arguments.query === 'string' &&
        f.arguments.query.toLowerCase().includes(query.slice(0, 12)),
    );
    if (match !== undefined) {
      return match;
    }
    const populated = candidates.find(
      (f) => ((f.structuredContent.results as unknown[] | undefined)?.length ?? 0) > 0,
    );
    if (populated !== undefined) {
      return populated;
    }
  }

  return candidates[0];
}

/** A `CallToolResult` shaped the way the server shapes one. */
function toolResult(fixture: Fixture): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(fixture.structuredContent) }],
    structuredContent: fixture.structuredContent,
  };
}

// ---------------------------------------------------------------------------
// Host context
// ---------------------------------------------------------------------------

function hostContext(): McpUiHostContext {
  const fixture = current();
  return {
    theme: state.theme,
    // Omitted entirely rather than sent empty when the toggle is off: a host
    // that supplies no tokens sends no `styles` key, and an empty object would
    // exercise a different branch than the one being tested.
    ...(state.styles
      ? { styles: { variables: state.theme === 'dark' ? DARK : LIGHT } }
      : {}),
    displayMode: state.mode,
    availableDisplayModes: ['inline', 'fullscreen'],
    containerDimensions:
      state.mode === 'fullscreen' || state.budget === 'none'
        ? { width: state.width, maxHeight: undefined }
        : { width: state.width, maxHeight: Number(state.budget) },
    locale: state.locale,
    timeZone: 'Asia/Taipei',
    userAgent: 'app-ui-harness',
    platform: 'desktop',
    deviceCapabilities: { hover: state.hover, touch: !state.hover },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    ...(fixture !== undefined
      ? { toolInfo: { id: 1, tool: { name: fixture.tool, inputSchema: { type: 'object' } } } }
      : {}),
  } as McpUiHostContext;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

let bridge: AppBridge | null = null;

async function connect(): Promise<void> {
  const { contentWindow } = frame;
  if (contentWindow === null) {
    throw new Error('the app iframe has no contentWindow');
  }

  const next = new AppBridge(
    null,
    { name: 'app-ui harness', version: '1.0.0' },
    {
      openLinks: {},
      serverTools: { listChanged: false },
      logging: {},
      updateModelContext: { text: {} },
      message: { text: {} },
      // Mirrors the grant the resource asks the real host for, so a copy
      // button that works here is a copy button that works in Claude.
      sandbox: { permissions: { clipboardWrite: {} } },
    },
    { hostContext: hostContext() },
  );

  // Every handler before connect(). The bridge gates handlers on the view
  // having sent `ui/notifications/initialized`, and a handler registered after
  // the handshake races it.
  next.oncalltool = async (params) => {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const fixture = answer(params.name, args);
    log('tools/call', `${params.name} ${JSON.stringify(args)}`);

    if (state.behaviour === 'slow') {
      // Long enough to clear the view's own 120ms delay before it shows a
      // skeleton, which is the thing being looked at.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (state.behaviour === 'fail') {
      log('error', 'forced failure');
      throw new Error('Fluid Topics returned 503 Service Unavailable');
    }

    if (fixture === undefined) {
      log('error', `no fixture for ${params.name}`);
      return {
        content: [{ type: 'text', text: `No harness fixture for ${params.name}.` }],
        isError: true,
      };
    }
    log('result', `→ ${fixture.key}`);
    return toolResult(fixture);
  };

  // The SDK types these handlers as Promise-returning; a local host answering
  // from memory has nothing to await, so each one carries the exemption.
  // eslint-disable-next-line @typescript-eslint/require-await
  next.onopenlink = async ({ url }) => {
    log('ui/open-link', url);
    return {};
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  next.onmessage = async ({ content }) => {
    log('ui/message', JSON.stringify(content).slice(0, 160));
    return {};
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  next.ondownloadfile = async () => {
    log('ui/download-file', 'requested');
    return {};
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  next.onrequestdisplaymode = async ({ mode }) => {
    log('ui/request-display-mode', mode);
    if (mode === 'inline' || mode === 'fullscreen') {
      state.mode = mode;
      syncControls();
      applyStage();
      void next.sendHostContextChange(hostContext());
    }
    return { mode: state.mode };
  };

  next.onsizechange = ({ width, height }) => {
    log('size-changed', `${width ?? '?'}×${height ?? '?'}`);
    // Sizing the iframe is the host's job, and doing it faithfully is what
    // makes the clipping visible: Claude caps an inline app's height and cuts
    // the rest off. A harness that let the frame grow without bound would
    // hide the single worst article-view failure — a long page guillotined
    // mid-sentence with nothing on screen saying so.
    applyFrameHeight(height);
  };

  next.onloggingmessage = ({ level, data }) => {
    log(`log:${level}`, typeof data === 'string' ? data : JSON.stringify(data));
  };

  next.oninitialized = () => {
    log('initialized', 'view connected');
    const fixture = current();
    if (fixture !== undefined) {
      // The real sequence: the host announces the arguments before the tool
      // runs, then delivers the result. Sending both is what lets the viewer
      // render a header and a skeleton rather than the word "Loading".
      void next.sendToolInput({ arguments: fixture.arguments });
      void next.sendToolResult(toolResult(fixture));
    }
  };

  await next.connect(new PostMessageTransport(contentWindow, contentWindow));
  bridge = next;
}

/** Reload the app frame and re-handshake. Used on fixture change and on demand. */
function reload(): void {
  // Close the previous bridge first. Its PostMessageTransport keeps a listener
  // on `window`, so an un-closed bridge goes on answering the *new* frame's
  // handshake as well — which the SDK reports as "the View may be
  // double-mounting", and which leaves two hosts racing to send tool results.
  void bridge?.close();
  bridge = null;
  logList.replaceChildren();
  frame.addEventListener(
    'load',
    () => {
      void connect().catch((error: unknown) => {
        log('error', error instanceof Error ? error.message : String(error));
      });
    },
    { once: true },
  );
  // A cache-busting query so an edited bundle is never served from the bfcache.
  frame.src = `/app.html?t=${String(performance.now())}`;
}

/** Push a context change without reloading — the path a theme toggle takes in Claude. */
function pushContext(): void {
  applyStage();
  if (bridge !== null) {
    void bridge.sendHostContextChange(hostContext());
    log('host-context-changed', `theme=${state.theme} styles=${String(state.styles)}`);
  }
}

/** The last height the view asked for, so a mode change can re-clamp it. */
let requestedHeight = 240;

/**
 * Give the iframe the height the view asked for, clamped the way Claude clamps.
 *
 * Inline, the host caps the panel and clips; fullscreen is unbounded. The
 * clamp lives here rather than in CSS because the overflow has to land on the
 * *panel*, which is the host's scroll container — the iframe document itself
 * is content-height by construction.
 */
function applyFrameHeight(height?: number): void {
  if (typeof height === 'number' && height > 0) {
    requestedHeight = height;
  }
  // The host clips at its own budget regardless of what the view asks for.
  // Honouring that here is what makes an over-tall panel *visible* rather than
  // silently fine in the harness and blown out in Claude.
  const budget = state.budget === 'none' ? Infinity : Number(state.budget);
  const capped = state.mode === 'fullscreen' ? requestedHeight : Math.min(requestedHeight, budget);
  frame.style.height = `${String(Math.max(capped, 120))}px`;
}

/** Paint the host chrome around the iframe so the viewer is judged in context. */
function applyStage(): void {
  const canvas = HOST_CANVAS[state.theme];
  stage.style.background = canvas;
  stage.dataset.theme = state.theme;
  panel.style.width = `${String(state.width)}px`;
  panel.dataset.mode = state.mode;
  applyFrameHeight();
}

// ---------------------------------------------------------------------------
// Toolbar wiring
// ---------------------------------------------------------------------------

for (const fixture of fixtures) {
  const option = document.createElement('option');
  option.value = fixture.key;
  option.textContent = fixture.label;
  fixtureSelect.append(option);
}

function syncControls(): void {
  fixtureSelect.value = state.fixture;
  fixtureWhy.textContent = current()?.why ?? '';
  need<HTMLOutputElement>('#width-out').value = `${String(state.width)}px`;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-radio]')) {
    const [key, value] = (input.dataset.radio ?? '').split(':');
    input.checked = String(state[key as keyof typeof state]) === value;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-flag]')) {
    input.checked = Boolean(state[(input.dataset.flag ?? '') as keyof typeof state]);
  }
}

fixtureSelect.addEventListener('change', () => {
  state.fixture = fixtureSelect.value;
  syncControls();
  reload();
});

need<HTMLInputElement>('#width').addEventListener('input', (event) => {
  state.width = Number((event.target as HTMLInputElement).value);
  syncControls();
  pushContext();
});

for (const input of document.querySelectorAll<HTMLInputElement>('input[data-radio]')) {
  input.addEventListener('change', () => {
    const [key, value] = (input.dataset.radio ?? '').split(':');
    if (key !== undefined && value !== undefined) {
      (state as Record<string, unknown>)[key] = value;
      syncControls();
      pushContext();
    }
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[data-flag]')) {
  input.addEventListener('change', () => {
    const key = input.dataset.flag;
    if (key !== undefined) {
      (state as Record<string, unknown>)[key] = input.checked;
      syncControls();
      pushContext();
    }
  });
}

need<HTMLButtonElement>('#reload').addEventListener('click', reload);

// Live reload: the dev server pushes one event per rebuild.
new EventSource('/dev-events').addEventListener('rebuild', () => {
  reload();
});

syncControls();
applyStage();
reload();
