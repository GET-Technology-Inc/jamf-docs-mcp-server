/**
 * A one-character Chinese, Japanese or Korean query to `jamf_docs_search`:
 * the registered tool over MCP, with the real input schema and search
 * service, and Fluid Topics stubbed.
 *
 * `query` needed two characters, a length chosen for Latin text, where one
 * letter is not a word. One Han character can be: 鎖 is "lock", 鍵 "key".
 * Until 2026-09-28 the schema refused them before anything was searched.
 * Fluid Topics answers them. Live and read-only that day, 鎖 had 337 results
 * in zh-TW, led by 解鎖 Jamf Pro 使用者帳戶 ("Unlock a Jamf Pro user
 * account"), and 鍵 had 384 in ja-JP, led by 公開鍵のダウンロード ("Download
 * the public key"). Every one of the first ten highlighted the character.
 *
 * One Latin letter is still refused, as is one digit or mark.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import type { FtSearchRequest } from '../../../src/core/types.js';

const TOO_SHORT = 'Query must be at least 2 characters, or one Chinese, Japanese or Korean character';

describe('one Chinese, Japanese or Korean character', () => {
  it.each([
    ['鎖', 'zh-TW', 'Han'],
    ['鍵', 'ja-JP', 'Han'],
    ['ア', 'ja-JP', 'Katakana'],
    ['の', 'ja-JP', 'Hiragana'],
    ['한', 'en-US', 'Hangul'],
  ])('%s (%s, %s) is searched as typed', async (query, language) => {
    const sent: FtSearchRequest[] = [];
    const { ctx } = searchUpstream({ clusteredSearch: (request) => { sent.push(request); return []; } });

    const reply = await callSearch(ctx, { query, language });

    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.text).toMatch(new RegExp(`^No results found for "${query}"`));
    expect(sent.map(r => [r.query, r.contentLocale])).toContainEqual([query, language]);
  });
});

describe('one character of any other kind is still refused', () => {
  it.each([
    ['a', 'a Latin letter'],
    ['é', 'an accented Latin letter'],
    ['7', 'a digit'],
    ['ー', 'the Katakana long vowel mark, which is in the Common script'],
    ['、', 'an ideographic comma'],
    [' ', 'a space'],
    ['', 'nothing'],
  ])('%j, %s', async (query) => {
    const { ctx, requests } = searchUpstream();

    const reply = await callSearch(ctx, { query });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(`query: ${TOO_SHORT}`);
    expect(requests).toEqual([]);
  });

  it('while two Latin letters are searched, as before', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'ID' });

    expect(reply.isError, reply.text).not.toBe(true);
  });
});

describe('the published input schema', () => {
  it('says what query accepts, where JSON Schema cannot', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, searchUpstream().ctx);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'jamf_docs_search');
      const { query } = tool?.inputSchema.properties as Record<string, Record<string, unknown> | undefined>;

      // The bounds a validator can check: one character at the least, since
      // one can be enough.
      expect(query).toMatchObject({ type: 'string', minLength: 1, maxLength: 200 });
      // And the rule it cannot, in words.
      expect(query?.description).toContain('2-200 characters, or one Chinese, Japanese or Korean character');
      expect(tool?.description).toContain(
        'query (string, required): Search keywords (2-200 characters, or one Chinese, Japanese or Korean character)',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
