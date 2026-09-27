/**
 * The rules the glossary's and the search's failure messages share: what a
 * failed request is, and whether trying it again may help.
 */

import { describe, it, expect } from 'vitest';
import { HttpError } from '../../../src/core/http-client.js';
import { isRequestFailure, mayBeTemporary } from '../../../src/core/utils/fetch-failure.js';
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
