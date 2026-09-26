/**
 * Reading a bundle family off a documentation URL.
 *
 * A SearchProvider result for a product Jamf classifies nothing under
 * (jamf-routines) is matched against that product's publication, and its
 * URL is one of the two things it may carry that name it.
 */

import { describe, it, expect } from 'vitest';
import { extractBundleStemFromUrl } from '../../../src/core/utils/url.js';

describe('extractBundleStemFromUrl', () => {
  it('reads the family from both Fluid Topics address shapes', () => {
    expect(extractBundleStemFromUrl('https://learn.jamf.com/r/en-US/jamf-routines-documentation/Creating_a_Routine'))
      .toBe('jamf-routines-documentation');
    // A whole publication, which is how a MAP result is addressed.
    expect(extractBundleStemFromUrl('https://learn.jamf.com/r/en-US/jamf-routines-documentation'))
      .toBe('jamf-routines-documentation');
    expect(extractBundleStemFromUrl('https://learn.jamf.com/en-US/bundle/jamf-routines-documentation/page/Routines.html'))
      .toBe('jamf-routines-documentation');
  });

  it('drops `-current` and a version number, as the maps registry does', () => {
    expect(extractBundleStemFromUrl('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Policies.html'))
      .toBe('jamf-pro-documentation');
    expect(extractBundleStemFromUrl('https://docs.jamf.com/r/en-US/jamf-pro-documentation-11.31.0/Policies'))
      .toBe('jamf-pro-documentation');
  });

  it('returns null for any other address', () => {
    expect(extractBundleStemFromUrl('https://example.com/r/en-US/jamf-routines-documentation/Routines')).toBeNull();
    expect(extractBundleStemFromUrl('https://concepts.jamf.com/child_pages/mdm.html')).toBeNull();
    expect(extractBundleStemFromUrl('https://learn.jamf.com/en-US/page/Routines.html')).toBeNull();
    expect(extractBundleStemFromUrl('https://learn.jamf.com/r/en-US')).toBeNull();
    expect(extractBundleStemFromUrl('not a url')).toBeNull();
  });
});
