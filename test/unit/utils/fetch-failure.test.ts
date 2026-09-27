/**
 * The rules the glossary's and the search's failure messages share: what a
 * failed request is, whether trying it again may help, and how a provider's
 * own reason is quoted.
 */

import { describe, it, expect } from 'vitest';
import { HttpError } from '../../../src/core/http-client.js';
import { isRequestFailure, mayBeTemporary, reasonGiven } from '../../../src/core/utils/fetch-failure.js';
import { connectionRefused, notJson, timedOut } from '../../helpers/search-upstream.js';

const URL = 'https://learn.jamf.com/api/khub/clustered-search';

describe('mayBeTemporary', () => {
  it.each([400, 401, 403, 404, 410, 422])('is false for an HTTP %i: the request itself was refused', (status) => {
    expect(mayBeTemporary(new HttpError(status, '', URL))).toBe(false);
  });

  it.each([408, 429, 500, 502, 503, 504])('is true for an HTTP %i', (status) => {
    expect(mayBeTemporary(new HttpError(status, '', URL))).toBe(true);
  });

  it('is true for a timeout, a network error and a body that was not JSON', () => {
    for (const error of [timedOut(), connectionRefused(), new TypeError('fetch failed'), notJson()]) {
      expect(mayBeTemporary(error)).toBe(true);
    }
  });
});

describe('isRequestFailure', () => {
  it('is true for what http-client throws', () => {
    for (const error of [
      new HttpError(503, 'Service Unavailable', URL),
      timedOut(),
      connectionRefused(),
      new TypeError('fetch failed'),
      notJson(),
    ]) {
      expect(isRequestFailure(error)).toBe(true);
    }
  });

  it('is false for what something else threw, which describeFetchFailure would misname', () => {
    for (const error of [
      new TypeError('maps.map is not a function'),
      new Error('ENOSPC: no space left on device'),
      'fetch failed',
      undefined,
    ]) {
      expect(isRequestFailure(error)).toBe(false);
    }
  });
});

describe('reasonGiven', () => {
  it('is the message of an Error, or the string a provider rejected with, trimmed', () => {
    expect(reasonGiven(new Error('  KV namespace unavailable \n'))).toBe('KV namespace unavailable');
    expect(reasonGiven(' quota exceeded ')).toBe('quota exceeded');
  });

  it('is undefined when nothing was said', () => {
    for (const error of [new Error(''), new Error(' \n\t '), '', '   ', undefined, null, { code: 7 }]) {
      expect(reasonGiven(error)).toBeUndefined();
    }
  });

  it('removes file paths and stack lines', () => {
    const error = new Error(
      'ENOENT: no such file or directory, open /srv/worker/secrets/maps.json\n' +
      '    at readMaps (/srv/worker/index.js:12:3)\n' +
      '    at async getMaps (C:\\worker\\index.js:40:9)',
    );

    expect(reasonGiven(error)).toBe('ENOENT: no such file or directory, open <path>');
  });

  it('puts what is left on one line, so a reply quoting it keeps its own lines', () => {
    expect(reasonGiven(new Error('KV failed\n\n# Heading\r\n- item\tand more'))).toBe(
      'KV failed # Heading - item and more',
    );
  });

  it('keeps a reason of 200 characters whole, and cuts a longer one to 200 with an ellipsis', () => {
    const exactly = 'y'.repeat(200);

    expect(reasonGiven(exactly)).toBe(exactly);
    expect(reasonGiven(`${exactly}z`)).toBe(`${'y'.repeat(199)}…`);
    // A cut that ends on a space leaves the space out.
    expect(reasonGiven(`${'y'.repeat(198)} and the rest`)).toBe(`${'y'.repeat(198)}…`);
  });

  it('counts and cuts by character, not by UTF-16 unit, so no surrogate pair is split', () => {
    const emoji = '🔑'.repeat(250);

    const reason = reasonGiven(emoji) ?? '';

    expect(Array.from(reason)).toHaveLength(200);
    expect(reason).toBe(`${'🔑'.repeat(199)}…`);
    expect(reasonGiven('🔑'.repeat(200))).toBe('🔑'.repeat(200));
  });
});
