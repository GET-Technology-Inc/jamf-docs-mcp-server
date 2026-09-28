/**
 * failureReason: what a tool's or resource's catch-all says went wrong.
 * failure-reason-in-replies.test.ts drives it through the registered tools
 * and the TOC resource over MCP; this pins each kind of failure on its own,
 * including the ones only the search's and list_products' last-resort
 * catches can meet.
 */

import { describe, it, expect } from 'vitest';
import { failureReason, NO_REASON_GIVEN } from '../../../src/core/services/failure-reason.js';
import { MapsProviderError } from '../../../src/core/services/maps-registry.js';
import { ProviderError } from '../../../src/core/services/provider-error.js';
import { HttpError } from '../../../src/core/http-client.js';
import { JamfDocsError, JamfDocsErrorCode } from '../../../src/core/types.js';

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

describe('failureReason', () => {
  it('names a MapsProvider that threw, with its reason or without one', () => {
    expect(failureReason(new MapsProviderError(new Error('KV namespace unavailable')))).toBe(
      'the list of documentation maps could not be read from the configured maps provider (KV namespace unavailable)',
    );
    expect(failureReason(new MapsProviderError(undefined))).toBe(
      'the list of documentation maps could not be read from the configured maps provider, which gave no reason',
    );
  });

  it('describes a request as describeFetchFailure does, with the address an HttpError was sent to', () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });

    expect(failureReason(new HttpError(503, 'Service Unavailable', MAPS_LIST)))
      .toBe(`HTTP 503 Service Unavailable: ${MAPS_LIST}`);
    expect(failureReason(new HttpError(502, '', MAPS_LIST))).toBe(`HTTP 502: ${MAPS_LIST}`);
    expect(failureReason(refused)).toBe('a network error: ECONNREFUSED');
    expect(failureReason(new TypeError('fetch failed'))).toBe('a network error');
    expect(failureReason(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
      .toBe('the request timed out');
    expect(failureReason(new SyntaxError('Unexpected token \'<\'')))
      .toBe('a response that was not valid JSON');
  });

  it('quotes anything else by its reason: one line, no file paths or stack lines, at most 200 characters', () => {
    const long = new Error(`open /srv/app/secret.json failed\n\n# heading\n${'y'.repeat(500)}\n    at f (/srv/app/a.js:1:1)`);
    const reason = failureReason(long);

    expect(reason).toBe(`${'open <path> failed # heading '.padEnd(199, 'y')}…`);
    expect(Array.from(reason)).toHaveLength(200);
    // A TypeError that is not a request's keeps its own words, as it did:
    // nothing here says where it came from.
    expect(failureReason(new TypeError('maps.map is not a function'))).toBe('maps.map is not a function');
    expect(failureReason('quota exceeded')).toBe('quota exceeded');
  });

  it('leaves this server\'s own short messages as they were', () => {
    const own = new JamfDocsError('Could not resolve map for jamf-pro version current locale en-US', JamfDocsErrorCode.NOT_FOUND);

    expect(failureReason(own)).toBe('Could not resolve map for jamf-pro version current locale en-US');
  });

  it('puts this server\'s own long message on one line and does not cut it', () => {
    const url = `https://support.jamf.com/ja/articles/10631329-self-service-${'%E3%81%AF'.repeat(40)}`;
    const own = new JamfDocsError(`Could not read a Jamf Support Knowledge Base article at ${url}`, JamfDocsErrorCode.PARSE_ERROR);
    const lines = new JamfDocsError('Could not read\n  the page at /srv/app/page.html', JamfDocsErrorCode.PARSE_ERROR);

    expect(failureReason(own)).toBe(own.message);
    expect(failureReason(own).length).toBeGreaterThan(200);
    expect(failureReason(lines)).toBe('Could not read the page at <path>');
    expect(failureReason(new JamfDocsError('', JamfDocsErrorCode.PARSE_ERROR))).toBe(NO_REASON_GIVEN);
  });

  it.each([
    ['a SyntaxError', new SyntaxError('Unexpected token u in JSON at position 0'), 'Unexpected token u in JSON at position 0'],
    ['a TimeoutError', new DOMException('D1 query exceeded 30s', 'TimeoutError'), 'D1 query exceeded 30s'],
    ['fetch\'s TypeError', new TypeError('fetch failed'), 'fetch failed'],
    ['an HttpError', new HttpError(502, 'Bad Gateway', 'https://r2.example.test/a'), 'HTTP 502 Bad Gateway: https://r2.example.test/a'],
  ])('quotes a provider that threw %s by its own reason, not as a request of this server\'s', (_label, failure, reason) => {
    for (const provider of ['toc', 'article', 'glossary'] as const) {
      expect(failureReason(new ProviderError(provider, failure))).toBe(reason);
    }
  });

  it('cuts a provider\'s reason, this server\'s own error class included, and says when it gave none', () => {
    const long = new JamfDocsError(`Unrecognized URL format: https://r2.example.test/${'a'.repeat(300)}`, JamfDocsErrorCode.INVALID_URL);

    expect(failureReason(new ProviderError('article', long))).toBe(`${long.message.slice(0, 199)}…`);
    expect(failureReason(new ProviderError('toc', undefined))).toBe(NO_REASON_GIVEN);
    expect(failureReason(new ProviderError('glossary', new Error('')))).toBe(NO_REASON_GIVEN);
  });

  it.each([
    ['an Error with no message', new Error('')],
    ['a blank message', new Error('\n \t')],
    ['undefined', undefined],
    ['null', null],
    ['a blank string', ' '],
    ['an object that is not an Error', { code: 7 }],
  ])('says no reason was given for %s', (_label, failure) => {
    expect(failureReason(failure)).toBe(NO_REASON_GIVEN);
  });
});
