/**
 * The rules the glossary's and the search's failure messages share: what a
 * failed request is, whether trying it again may help, and how a provider's
 * own reason is quoted.
 */

import { describe, it, expect } from 'vitest';
import { HttpError } from '../../../src/core/http-client.js';
import { isRequestFailure, mayBeTemporary, reasonGiven, reasonStated } from '../../../src/core/utils/fetch-failure.js';
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

  it('never cuts inside a %XX escape, or between the escapes of one encoded character', () => {
    // 関 is %E9%96%A2: cut by character, 197 + 2 would end on "%E".
    expect(reasonGiven(`${'x'.repeat(197)}${'%E9%96%A2'.repeat(3)}`)).toBe(`${'x'.repeat(197)}…`);
    // は is %E3%81%AF: cut by character, 193 + 6 would end on "%E3%81", half
    // of it. 190 + 9 is 199, so the whole of it fits.
    expect(reasonGiven(`${'x'.repeat(193)}${'%E3%81%AF'.repeat(3)}`)).toBe(`${'x'.repeat(193)}…`);
    expect(reasonGiven(`${'x'.repeat(190)}${'%E3%81%AF'.repeat(3)}`)).toBe(`${'x'.repeat(190)}%E3%81%AF…`);
    // A single escape that starts no encoded character.
    expect(reasonGiven(`${'x'.repeat(197)}%20and the rest`)).toBe(`${'x'.repeat(197)}…`);
    // A % that starts no escape is one character, as any other.
    expect(reasonGiven(`${'x'.repeat(198)}%zz and the rest`)).toBe(`${'x'.repeat(198)}%…`);
  });
});

describe('reasonStated', () => {
  it('is the reason on one line, without file paths or stack lines, and not cut', () => {
    const long = `Could not read\n the page at /srv/app/page.html ${'%E3%81%AF'.repeat(40)}\n    at f (/srv/app/a.js:1:1)`;

    expect(reasonStated(new Error(long))).toBe(`Could not read the page at <path> ${'%E3%81%AF'.repeat(40)}`);
    expect(reasonStated(' quota exceeded ')).toBe('quota exceeded');
    for (const error of [new Error(''), ' \n', undefined, null, { code: 7 }]) {
      expect(reasonStated(error)).toBeUndefined();
    }
  });
});
