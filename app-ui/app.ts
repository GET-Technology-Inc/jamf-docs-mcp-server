/**
 * Jamf documentation MCP App.
 *
 * One app serves all three view-bearing tools. Which view renders is decided
 * by the shape of the `structuredContent` the host hands over — `results` for
 * a search, `entries` for a table of contents, `content` for an article — so
 * the three tools can share a single `ui://` resource instead of shipping
 * three copies of the same bundle.
 */

import { App } from '@modelcontextprotocol/ext-apps';
import { CSS } from './styles.js';

// ---------------------------------------------------------------------------
// Tool result shapes (mirrors of src/core/schemas/output.ts)
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  product: string;
  version?: string;
  breadcrumb?: string[];
}

/**
 * The filters a search was run under, echoed back by the server.
 *
 * Needed to ask for page 2 of the *same* search: `product`, `docType` and
 * `version` reach Fluid Topics and `product`/`topic` are re-applied on the
 * server, so a page request without them queries a different population and
 * returns plausible-looking but wrong results.
 */
interface SearchFilters {
  product?: string;
  topic?: string;
  version?: string;
  docType?: string;
  language?: string;
}

interface SearchView {
  query: string;
  filters?: SearchFilters;
  totalResults: number;
  page: number;
  totalPages: number;
  /** Page size — carried forward so the next page is the same size as this one. */
  limit?: number;
  results: SearchResult[];
  suggestions?: string[];
}

interface TocEntry {
  title: string;
  url: string;
}

interface TocView {
  /** Display name, for the heading. */
  product: string;
  /**
   * The product ID, which is what `jamf_docs_get_toc` accepts. Distinct from
   * `product` above: passing the display name back is a validation error.
   */
  productId: string;
  version: string;
  totalEntries: number;
  page: number;
  totalPages: number;
  entries: TocEntry[];
}

interface ArticleSection {
  id: string;
  title: string;
  level: number;
}

interface ArticleView {
  title: string;
  url: string;
  content: string;
  product?: string;
  version?: string;
  lastUpdated?: string;
  breadcrumb?: string[];
  sections: ArticleSection[];
  truncated: boolean;
}

type View =
  | { kind: 'search'; data: SearchView }
  | { kind: 'toc'; data: TocView }
  | { kind: 'article'; data: ArticleView }
  | { kind: 'error'; message: string };

function classify(payload: unknown): View | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.results) && typeof p.query === 'string') {
    return { kind: 'search', data: p as unknown as SearchView };
  }
  if (Array.isArray(p.entries) && typeof p.product === 'string') {
    return { kind: 'toc', data: p as unknown as TocView };
  }
  if (typeof p.content === 'string' && typeof p.title === 'string') {
    return { kind: 'article', data: p as unknown as ArticleView };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Everything rendered here originates from fetched documentation, so it is
 * escaped before any markup is applied. The inline formatter below only ever
 * re-introduces tags it generated itself.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline markdown: code spans, bold, italics, links. Operates on escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-external>$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

/**
 * A deliberately small markdown subset: headings, fenced code, lists, tables
 * collapsed to rows, and paragraphs. Jamf articles arrive as markdown produced
 * by our own turndown pass, so this covers what actually shows up.
 */
function markdown(src: string): string {
  const out: string[] = [];
  const lines = src.split('\n');
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = (): void => {
    if (listType !== null) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (line.startsWith('```')) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      closeList();
      const level = Math.min((heading[1] ?? '').length + 1, 6);
      out.push(`<h${level}>${inline(esc(heading[2] ?? ''))}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(esc(bullet[1] ?? ''))}</li>`);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered !== null) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(esc(numbered[1] ?? ''))}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${inline(esc(line))}</p>`);
  }

  closeList();
  if (inCode) {
    out.push('</code></pre>');
  }
  return out.join('\n');
}

function chip(label: string): string {
  return `<span class="chip">${esc(label)}</span>`;
}

function crumbs(path: string[] | undefined): string {
  if (path === undefined || path.length === 0) {
    return '';
  }
  return `<div class="crumbs">${path.map((c) => esc(c)).join(' <span aria-hidden="true">›</span> ')}</div>`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function renderSearch(v: SearchView): string {
  if (v.results.length === 0) {
    const tips =
      v.suggestions !== undefined && v.suggestions.length > 0
        ? `<p class="muted">Try: ${v.suggestions.map((s) => `<button class="link" data-search="${esc(s)}">${esc(s)}</button>`).join(', ')}</p>`
        : '';
    return `<header><h1>No results</h1><p class="muted">Nothing matched “${esc(v.query)}”.</p>${tips}</header>`;
  }

  const cards = v.results
    .map(
      (r) => `
      <li class="card" data-url="${esc(r.url)}" tabindex="0" role="button">
        ${crumbs(r.breadcrumb)}
        <h2>${esc(r.title)}</h2>
        <p class="snippet">${inline(esc(r.snippet))}</p>
        <div class="meta">${chip(r.product)}${r.version !== undefined && r.version !== '' ? chip(r.version) : ''}</div>
      </li>`,
    )
    .join('');

  return `
    <header>
      <h1>${esc(v.query)}</h1>
      <p class="muted">${v.totalResults} result${v.totalResults === 1 ? '' : 's'}${
        v.totalPages > 1 ? ` · page ${v.page} of ${v.totalPages}` : ''
      }</p>
    </header>
    <ul class="cards">${cards}</ul>
    ${v.page < v.totalPages ? '<button class="more">Load more</button>' : ''}
  `;
}

function renderToc(v: TocView): string {
  const items = v.entries
    .map(
      (e) =>
        `<li class="row" data-url="${esc(e.url)}" tabindex="0" role="button">${esc(e.title)}</li>`,
    )
    .join('');

  return `
    <header>
      <h1>${esc(v.product)}</h1>
      <p class="muted">${chip(v.version)} ${v.totalEntries} article${v.totalEntries === 1 ? '' : 's'}${
        v.totalPages > 1 ? ` · page ${v.page} of ${v.totalPages}` : ''
      }</p>
    </header>
    <ul class="rows">${items}</ul>
    ${v.page < v.totalPages ? '<button class="more">Load more</button>' : ''}
  `;
}

function renderArticle(v: ArticleView, canGoBack: boolean): string {
  const nav =
    v.sections.length > 1
      ? `<nav class="sections">${v.sections
          .filter((s) => s.level <= 3)
          .map((s) => `<button class="link" data-anchor="${esc(s.id)}">${esc(s.title)}</button>`)
          .join('')}</nav>`
      : '';

  return `
    ${canGoBack ? '<button class="back" data-back>← Back</button>' : ''}
    <header>
      ${crumbs(v.breadcrumb)}
      <h1>${esc(v.title)}</h1>
      <p class="muted">
        ${v.product !== undefined && v.product !== '' ? chip(v.product) : ''}${v.version !== undefined && v.version !== '' ? chip(v.version) : ''}
        ${v.lastUpdated !== undefined && v.lastUpdated !== '' ? `Updated ${esc(v.lastUpdated)}` : ''}
        <a href="${esc(v.url)}" data-external class="link">Open on learn.jamf.com</a>
      </p>
    </header>
    ${nav}
    <article>${markdown(v.content)}</article>
    ${v.truncated ? '<p class="muted note">Content was truncated to fit the token budget.</p>' : ''}
  `;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * The container `app.html` ships.
 *
 * A missing one means the shell and this bundle have come apart — a build
 * fault, not a runtime state worth degrading into. Saying so beats rendering
 * into a detached node nobody will ever see; the non-null assertion this
 * replaces also failed here, just one step later and with a worse message.
 */
function requireRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (element === null) {
    throw new Error('app.html is missing its #root container');
  }
  return element;
}

const root = requireRoot();
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

const app = new App({ name: 'Jamf Documentation', version: '1.0.0' });
const history: View[] = [];
let current: View | null = null;
let busy = false;

function paint(): void {
  if (current === null) {
    return;
  }
  if (current.kind === 'error') {
    root.innerHTML = `<header><h1>Something went wrong</h1><p class="muted">${esc(current.message)}</p></header>`;
    return;
  }
  root.innerHTML =
    current.kind === 'search'
      ? renderSearch(current.data)
      : current.kind === 'toc'
        ? renderToc(current.data)
        : renderArticle(current.data, history.length > 0);
  root.scrollTop = 0;
}

function show(view: View, push: boolean): void {
  if (push && current !== null) {
    history.push(current);
  }
  current = view;
  paint();
}

function setBusy(on: boolean): void {
  busy = on;
  root.setAttribute('aria-busy', String(on));
}

/** Structured payload of a tool result, whichever field the host populated. */
function payloadOf(result: {
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
}): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (text === undefined) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call(name: string, args: Record<string, unknown>, push: boolean): Promise<void> {
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    const result = await app.callServerTool({ name, arguments: args });
    const view = classify(payloadOf(result));
    show(view ?? { kind: 'error', message: `${name} returned nothing renderable.` }, push);
  } catch (err) {
    show({ kind: 'error', message: err instanceof Error ? err.message : String(err) }, push);
  } finally {
    setBusy(false);
  }
}

void app.connect();

app.ontoolresult = (result) => {
  const view = classify(payloadOf(result));
  if (view !== null) {
    history.length = 0;
    show(view, false);
  }
};

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const external: HTMLAnchorElement | null = target.closest('a[data-external]');
  if (external !== null) {
    // Navigation is the host's call — the iframe cannot open tabs itself.
    event.preventDefault();
    void app.sendOpenLink({ url: external.href });
    return;
  }

  if (target.closest('[data-back]') !== null) {
    const previous = history.pop();
    if (previous !== undefined) {
      current = previous;
      paint();
    }
    return;
  }

  const anchor: HTMLElement | null = target.closest('[data-anchor]');
  if (anchor !== null) {
    const id = anchor.dataset.anchor;
    const heading = Array.from(root.querySelectorAll('article h2, article h3')).find(
      (h) => h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') === id,
    );
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const suggestion: HTMLElement | null = target.closest('[data-search]');
  if (suggestion !== null) {
    void call('jamf_docs_search', { query: suggestion.dataset.search }, true);
    return;
  }

  const more: HTMLElement | null = target.closest('.more');
  if (more !== null) {
    // Paging arguments come from the view being displayed, not from data
    // attributes on the button. The attributes could only carry what fits in a
    // string, which is how the two paging bugs arose: the TOC button sent the
    // product *display name* into a parameter that only accepts IDs, and the
    // search button carried the query while dropping every filter. `current`
    // holds the whole result set the server described, so there is nothing to
    // re-encode and nothing to lose.
    if (current?.kind === 'search') {
      void call(
        'jamf_docs_search',
        {
          ...current.data.filters,
          ...(current.data.limit !== undefined ? { limit: current.data.limit } : {}),
          query: current.data.query,
          page: current.data.page + 1,
        },
        true,
      );
    } else if (current?.kind === 'toc') {
      void call(
        'jamf_docs_get_toc',
        { product: current.data.productId, page: current.data.page + 1 },
        true,
      );
    }
    return;
  }

  const openable: HTMLElement | null = target.closest('[data-url]');
  if (openable !== null) {
    void call('jamf_docs_get_article', { url: openable.dataset.url }, true);
  }
});

root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const target = event.target as HTMLElement;
  if (target.matches('[data-url]')) {
    event.preventDefault();
    void call('jamf_docs_get_article', { url: target.dataset.url }, true);
  }
});
