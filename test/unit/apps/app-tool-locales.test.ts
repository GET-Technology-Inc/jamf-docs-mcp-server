/**
 * The MCP App forwards the host's locale as `language` for every locale the
 * tools take, and only those.
 *
 * The App kept its own list, `TOOL_LOCALES` in app.ts, of eight locales. The
 * tools take eleven: it-IT, pt-BR and zh-CN, which they have taken since
 * #259, were never on it, so on a host in one of those three an article
 * opened in English. Live on 2026-09-28,
 * "Downloading Jamf Parent" (`jamf-parent-guide-for-parents`) opened as
 * "Scaricare Jamf Parent", "Como baixar o Jamf Parent" and "下载 Jamf Parent"
 * when the host's language was sent, and as "Downloading Jamf Parent" on
 * such a host. The list is now `SUPPORTED_LOCALE_IDS` itself, which the
 * bundle carries from src/: the tools' `language` enum is built from it.
 *
 * Asserted against `app-ui/language.ts`, which lives apart from app.ts
 * because importing app.ts throws outside a browser, against the `language`
 * of every tool as a client lists it, and against the built bundle.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import { TOOL_LOCALES, hostLanguage } from '../../../app-ui/language.js';
import { createMcpServer } from '../../../src/core/create-server.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { inlinedScript } from '../../helpers/app-bundle.js';

/** Each tool's `language` enum, as `tools/list` gives it. */
const accepted = new Map<string, unknown>();

beforeAll(async () => {
  const server = createMcpServer(createMockContext());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'app-tool-locales-test', version: '0.0.1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const language = (tool.inputSchema.properties as Record<string, { enum?: unknown } | undefined> | undefined)
      ?.language;
    if (language !== undefined) {
      accepted.set(tool.name, language.enum);
    }
  }
  await client.close();
});

describe('the locales the App forwards', () => {
  it('are every locale each tool with a `language` accepts', () => {
    // Five tools: every one but jamf_docs_list_products.
    expect(accepted.size).toBe(5);
    for (const [tool, locales] of accepted) {
      expect({ tool, locales: [...TOOL_LOCALES].sort() }).toEqual({ tool, locales: [...(locales as string[])].sort() });
    }
  });

  it('forward a host locale that is one of them, as it is', () => {
    for (const locale of ['en-US', 'ja-JP', 'it-IT', 'pt-BR', 'zh-CN']) {
      expect(hostLanguage(locale)).toBe(locale);
    }
  });

  it('forward nothing for a host locale in no language they take, which would fail the call', () => {
    // `en`, `en-GB` and `zh-Hant-TW` are read as en-US and zh-TW since
    // 2026-09-28: see app-host-locale.test.ts.
    for (const locale of ['ko-KR', '', undefined, 7]) {
      expect(hostLanguage(locale)).toBeUndefined();
    }
  });
});

describe('the built bundle', () => {
  it('carries every locale the tools accept', () => {
    // Until 2026-09-28 it carried eight, without it-IT, pt-BR and zh-CN.
    const script = inlinedScript();
    for (const locale of SUPPORTED_LOCALE_IDS) {
      expect(script).toContain(`"${locale}"`);
    }
  });
});
