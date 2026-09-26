/**
 * The SearchResult-level version collapse applied to SearchProvider results.
 *
 * search-provider-versions.test.ts drives it through the tool and compares it
 * with the Fluid Topics path. These cases pin the rules themselves: what is
 * read as a topic and a version, which version is kept, that every result at
 * that version stays, and that anything it cannot read is left exactly as it
 * was.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupeResultsToLatestVersions,
  versionedTopicOf,
} from '../../../src/core/services/search-result-versions.js';
import type { SearchResult } from '../../../src/core/types.js';

const LEARN = 'https://learn.jamf.com';

function result(url: string, version?: string, extra: Partial<SearchResult> = {}): SearchResult {
  return {
    title: url.slice(url.lastIndexOf('/') + 1),
    url,
    snippet: 'A snippet.',
    product: 'Jamf Pro',
    ...(version !== undefined ? { version } : {}),
    ...extra,
  };
}

const proUrl = (bundle: string, slug = 'Policies'): string => `${LEARN}/r/en-US/${bundle}/${slug}`;

describe('versionedTopicOf()', () => {
  it('reads a reader url and its version, as the Fluid Topics path hands them out', () => {
    expect(versionedTopicOf(result(proUrl('jamf-pro-documentation-current'), '11.32.0'))).toEqual({
      topic: 'learn.jamf.com|en-US|jamf-pro-documentation|Policies',
      version: '11.32.0',
    });
  });

  it('reads the version off the url when the result carries none', () => {
    expect(versionedTopicOf(result(proUrl('jamf-pro-documentation-11.31.0')))?.version).toBe('11.31.0');
  });

  it('takes the version field over the number in the url, as the Fluid Topics path takes its metadata', () => {
    expect(versionedTopicOf(result(proUrl('jamf-pro-documentation-11.31.0'), '11.30.0'))?.version).toBe('11.30.0');
  });

  it('reads the legacy address of a topic as the same topic as its reader address', () => {
    const legacy = versionedTopicOf(result(
      `${LEARN}/en-US/bundle/jamf-pro-documentation-11.30.0/page/Policies.html`,
    ));
    const reader = versionedTopicOf(result(proUrl('jamf-pro-documentation-current'), '11.32.0'));

    expect(legacy?.version).toBe('11.30.0');
    expect(legacy?.topic).toBe(reader?.topic);
  });

  it('reads a legacy address without `.html` as the same topic', () => {
    const bare = versionedTopicOf(result(`${LEARN}/en-US/bundle/jamf-pro-documentation-11.30.0/page/Policies`));
    const reader = versionedTopicOf(result(proUrl('jamf-pro-documentation-11.30.0')));

    expect(bare).toEqual(reader);
  });

  it('reads a `#fragment` or `?query` variant as the page it is on', () => {
    const page = versionedTopicOf(result(proUrl('jamf-pro-documentation-11.31.0')));

    expect(versionedTopicOf(result(`${proUrl('jamf-pro-documentation-11.31.0')}#Scope`))).toEqual(page);
    expect(versionedTopicOf(result(`${proUrl('jamf-pro-documentation-11.31.0')}?lang=en`))).toEqual(page);
  });

  it('reads the address of a whole publication, which a release-notes volume is found under', () => {
    expect(versionedTopicOf(result(`${LEARN}/r/en-US/jamf-pro-release-notes-11.13.1`))).toEqual({
      topic: 'learn.jamf.com|en-US|jamf-pro-release-notes|',
      version: '11.13.1',
    });
  });

  it('reads Jamf Connect\'s numbered snapshot, under the same stem as its current pages', () => {
    // Jamf clusters it as `jamf-connect-documentation-2.45.0/FileVault_Settings`,
    // apart from the current page. The current page has no version to read
    // (below), so the two are never merged.
    expect(versionedTopicOf(result(`${LEARN}/r/en-US/jamf-connect-documentation-2.45.0/FileVault_Settings`, '2.45.0')))
      .toEqual({ topic: 'learn.jamf.com|en-US|jamf-connect-documentation|FileVault_Settings', version: '2.45.0' });
  });

  it('keeps locales apart', () => {
    const en = versionedTopicOf(result(proUrl('jamf-pro-documentation-11.31.0')));
    const ja = versionedTopicOf(result(`${LEARN}/r/ja-JP/jamf-pro-documentation-11.31.0/Policies`));

    expect(en?.topic).not.toBe(ja?.topic);
  });

  const unreadable: [string, SearchResult][] = [
    ['a `-current` url with no version: an unversioned publication', result(proUrl('jamf-connect-documentation-current'))],
    ['a `current` version, which is an alias', result(proUrl('jamf-pro-documentation-current'), 'current')],
    ['an empty version', result(proUrl('jamf-pro-documentation-current'), '')],
    ['a version that is not a number', result(
      proUrl('jamf-connect-documentation-current'),
      'Enter the latest product version for which the topic was revised.',
    )],
    ['an unversioned bundle with no version', result(`${LEARN}/r/en-US/jamf-school-documentation/Enrollment`)],
    ['Jamf\'s locale-less `legacy_url`, which every locale\'s copy of a topic shares', result(
      `${LEARN}/bundle/jamf-pro-documentation-11.31.0/page/Policies.html`,
    )],
    ['a reader url with a lowercase locale', result(`${LEARN}/r/en-us/jamf-pro-documentation-11.31.0/Policies`)],
    ['a legacy url with a lowercase locale', result(
      `${LEARN}/en-us/bundle/jamf-pro-documentation-11.31.0/page/Policies.html`,
    )],
    ['another host', result('https://concepts.jamf.com/r/en-US/jamf-pro-documentation-11.31.0/Policies', '11.31.0')],
    ['another path', result(`${LEARN}/some/other/path.html`, '11.31.0')],
    ['a relative url', result('/r/en-US/jamf-pro-documentation-11.31.0/Policies', '11.31.0')],
    ['no url at all', result('', '11.31.0')],
  ];

  it.each(unreadable)('reads nothing from %s', (_label, r) => {
    expect(versionedTopicOf(r)).toBeNull();
  });

  it('falls back to the url when the version field is not a number', () => {
    const r = result(proUrl('jamf-pro-documentation-11.31.0'), 'Enter the latest product version');

    expect(versionedTopicOf(r)?.version).toBe('11.31.0');
  });
});

describe('dedupeResultsToLatestVersions()', () => {
  const v32 = result(proUrl('jamf-pro-documentation-current'), '11.32.0');
  const v31 = result(proUrl('jamf-pro-documentation-11.31.0'), '11.31.0');
  const v30 = result(proUrl('jamf-pro-documentation-11.30.0'), '11.30.0');
  const other = result(proUrl('jamf-pro-documentation-current', 'Scripts'), '11.32.0');
  const school = result(`${LEARN}/r/en-US/jamf-school-documentation/Enrollment`);

  it('keeps the newest in the place of the topic\'s first result, and names the rest newest first', () => {
    const out = dedupeResultsToLatestVersions([v30, school, v32, other, v31]);

    expect(out).toEqual([{ ...v32, otherVersions: ['11.31.0', '11.30.0'] }, school, other]);
  });

  it('leaves a topic at one version as it came, however many results it has', () => {
    // Passages of one page, and its `#fragment` and `?query` variants, are
    // not versions of it.
    const input = [
      v31,
      school,
      { ...v31, snippet: 'Another passage of the same page.' },
      { ...v31, url: `${v31.url}#Scope`, snippet: 'The Scope section.' },
      { ...v31, url: `${v31.url}?lang=en` },
    ];

    const out = dedupeResultsToLatestVersions(input);

    expect(out).toHaveLength(input.length);
    out.forEach((r, i) => { expect(r).toBe(input[i]); });
  });

  it('keeps every result at the version kept, the first-ranked in the topic\'s first place', () => {
    const passage = { ...v32, url: `${v32.url}#Scope`, snippet: 'The Scope section.' };

    const out = dedupeResultsToLatestVersions([v30, school, v32, passage, v31]);

    expect(out).toEqual([{ ...v32, otherVersions: ['11.31.0', '11.30.0'] }, school, passage]);
    expect(out[2]).toBe(passage);
  });

  it('returns every result it did not collapse as the same object', () => {
    const input = [v32, school, other];

    const out = dedupeResultsToLatestVersions(input);

    expect(out).toEqual(input);
    out.forEach((r, i) => { expect(r).toBe(input[i]); });
  });

  it('is idempotent', () => {
    const once = dedupeResultsToLatestVersions([v30, school, v32, other, v31]);
    const twice = dedupeResultsToLatestVersions(once);

    expect(twice).toEqual(once);
    twice.forEach((r, i) => { expect(r).toBe(once[i]); });
  });

  it('does not change the results it was given', () => {
    const input = [v30, v32];
    const before = JSON.parse(JSON.stringify(input)) as SearchResult[];

    dedupeResultsToLatestVersions(input);

    expect(input).toEqual(before);
  });

  it('keeps the versions a collapsed result already listed, without repeating the survivor\'s', () => {
    const listed = { ...v32, otherVersions: ['11.31.0', '11.14.0'] };
    const older = { ...v30, otherVersions: ['11.32.0', '11.29.0'] };

    const out = dedupeResultsToLatestVersions([older, listed]);

    expect(out).toEqual([{ ...listed, otherVersions: ['11.31.0', '11.30.0', '11.29.0', '11.14.0'] }]);
  });

  it('does not carry over an empty version a result listed', () => {
    const listed = { ...v32, otherVersions: ['', '11.14.0'] };

    expect(dedupeResultsToLatestVersions([listed, v31])).toEqual([
      { ...listed, otherVersions: ['11.31.0', '11.14.0'] },
    ]);
  });

  it('collapses a topic addressed both ways, keeping the survivor as it came', () => {
    const legacy = result(`${LEARN}/en-US/bundle/jamf-pro-documentation-11.30.0/page/Policies.html`);

    expect(dedupeResultsToLatestVersions([legacy, v31])).toEqual([{ ...v31, otherVersions: ['11.30.0'] }]);
  });

  it('collapses two numbered Jamf Connect snapshots, which Fluid Topics clusters apart', () => {
    // There is one numbered snapshot today (2.45.0), so the two paths agree.
    // This pins what a second would do: collapse here, stay two clusters there.
    const connect = (version: string): SearchResult => ({
      ...result(`${LEARN}/r/en-US/jamf-connect-documentation-${version}/FileVault_Settings`, version),
      product: 'Jamf Connect',
    });
    const current = { ...result(`${LEARN}/r/en-US/jamf-connect-documentation-current/FileVault_Settings`), product: 'Jamf Connect' };

    expect(dedupeResultsToLatestVersions([connect('2.45.0'), current, connect('2.46.0')])).toEqual([
      { ...connect('2.46.0'), otherVersions: ['2.45.0'] },
      current,
    ]);
  });

  it('collapses the volumes of a publication, as it does the versions of a topic', () => {
    const current = result(`${LEARN}/r/en-US/jamf-pro-release-notes-current`, '11.32.0');
    const older = result(`${LEARN}/r/en-US/jamf-pro-release-notes-11.13.1`, '11.13.1');

    expect(dedupeResultsToLatestVersions([older, current])).toEqual([
      { ...current, otherVersions: ['11.13.1'] },
    ]);
  });

  describe('with a requested version', () => {
    it('keeps that version where the topic has it, even when a newer one ranked first', () => {
      expect(dedupeResultsToLatestVersions([v32, v30, v31], '11.30.0')).toEqual([
        { ...v30, otherVersions: ['11.32.0', '11.31.0'] },
      ]);
    });

    it('keeps the first-ranked of two results at that version in the lead, and the other in its place', () => {
      const passage = { ...v30, snippet: 'Another passage of the same page.' };

      expect(dedupeResultsToLatestVersions([v32, v30, passage], '11.30.0')).toEqual([
        { ...v30, otherVersions: ['11.32.0'] },
        passage,
      ]);
    });

    it('keeps the newest where the topic does not have it', () => {
      expect(dedupeResultsToLatestVersions([v31, v32], '11.14.0')).toEqual([
        { ...v32, otherVersions: ['11.31.0'] },
      ]);
    });

    it.each(['current', ''])('treats %j as no version in particular', (requested) => {
      expect(dedupeResultsToLatestVersions([v30, v32], requested))
        .toEqual(dedupeResultsToLatestVersions([v30, v32]));
    });

    it('cannot bring back a version an earlier pass without it dropped', () => {
      // Why a provider that collapses its own results must pass the version.
      const without = dedupeResultsToLatestVersions([v32, v30]);

      expect(dedupeResultsToLatestVersions(without, '11.30.0')).toEqual([{ ...v32, otherVersions: ['11.30.0'] }]);
      expect(dedupeResultsToLatestVersions([v32, v30], '11.30.0')).toEqual([{ ...v30, otherVersions: ['11.32.0'] }]);
    });
  });
});
