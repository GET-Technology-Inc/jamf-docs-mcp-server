/**
 * `maxTokens` on every shape `buildArticleView` returns.
 *
 * Until 2026-09-24 only the full article was cut to budget. Measured live on
 * Computer Configuration Profiles at `maxTokens: 100`, a missed section
 * reported 415/100 and `summaryOnly` 459/100, both `truncated: false`. On
 * Components Installed on Managed Computers the full article reported 172/100,
 * because the truncation notice's section list was charged to nothing. A note
 * (the pair, static-source and language notes) was appended after the count
 * was taken, so it was in no count at all.
 *
 * The rule these tests hold every shape to: `content` is at most `maxTokens`,
 * `tokenCount` is the estimate of exactly `content`, and a list that had to be
 * cut says how much it left out and sets `truncated`.
 */

import { describe, it, expect } from 'vitest';
import { buildArticleView, withNote, type ArticleViewOptions } from '../../../src/core/services/article-view.js';
import { estimateTokens, extractSections } from '../../../src/core/services/tokenizer.js';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import type { ArticleNavigation, FetchArticleResult } from '../../../src/core/types.js';

const MIN = TOKEN_CONFIG.MIN_TOKENS;

/** Computer Configuration Profiles, as parsed: four paragraphs and no heading. */
const HEADING_FREE = [
  'Configuration profiles are XML files (.mobileconfig) that provide an easy way to define settings and restrictions for devices, computers, and users.',
  'You can use Jamf Pro to create a configuration profile or you can upload a configuration profile that was created using third-party software.',
  'When you create a computer configuration profile, you must specify the level at which to apply the profile—computer-level or user-level. Each level has a unique set of payloads and a few that are common to both. User-level profiles may not apply until the MDM-enabled user logs out of the computer and logs back in, or when the computer is restarted.',
  'There are two different ways to distribute a configuration profile: install it automatically (requires no interaction from the user) or make it available in Self Service.',
].join('\n\n');

/** Headed sections of ~50 tokens each: more titles than fit in 100 tokens. */
const HEADINGS = 24;
const HEADED = [
  'This bundle contains the following notable components among others:',
  ...Array.from({ length: HEADINGS }, (_, i) =>
    `## Component Group ${i + 1}\n\n${'The binary used to execute most tasks. '.repeat(5)}`),
].join('\n\n');

/** A long first paragraph, then three headed sections. */
const LONG_LEAD = [
  'Lead sentence of an introduction that runs on for a while. '.repeat(20).trim(),
  ...Array.from({ length: 3 }, (_, i) => `## Step ${i + 1}\n\nDo the thing.`),
].join('\n\n');

const CHILD = 'Creating a Computer Configuration Profile in Jamf Pro';

/** Nine children, eight handed over — the TOC's cap — as for CCP. */
const NAVIGATION: ArticleNavigation = {
  self: { title: 'Computer Configuration Profiles', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles' },
  siblings: [],
  siblingCount: 0,
  children: [
    ['Payload Variables for Configuration Profiles', 'Payload_Variables_for_macOS_Configuration_Profiles'],
    ['General Requirements', 'GenReq_ConfigurationProfiles'],
    [CHILD, 'Manually_Creating_a_Configuration_Profile_macOS'],
    ['Uploading a Configuration Profile', 'Uploading_a_Configuration_Profile_macOS'],
    ['Editing the Settings or Scope of a Configuration Profile', 'Editing_the_Settings_or_Scope_of_a_Configuration_Profile_macOS'],
    ['Downloading a Configuration Profile', 'Downloading-a-Configuration-Profile'],
    ['Viewing the Status of a Configuration Profile', 'Viewing-the-Status-of-a-Configuration-Profile'],
    ['Troubleshooting a Failed Status of a Configuration Profile', 'Troubleshooting_a_Failed_Status_of_a_Configuration_Profile'],
  ].map(([title, slug]) => ({ title, url: `https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/${slug}` })),
  childCount: 9,
};

/**
 * The longest note the server writes: a url that did not match the pair, and
 * a `language` the pair's map is not in. 84 tokens, which leaves a body of 16
 * at the schema's minimum.
 */
const LONGEST_NOTE = 'This article was fetched by its mapId + contentId. The url passed with them'
  + ' does not match its address and was not used: with both, a learn.jamf.com'
  + ' fetch follows the pair. Language "ja-JP" was requested, but `language` has no effect'
  + ' on a mapId + contentId pair: this article comes from the pair\'s map, which is "en-US".';
const SHORT_NOTE = 'mapId and contentId were ignored: they address learn.jamf.com (Fluid Topics)'
  + ' topics, and a concepts.jamf.com url is fetched by url alone.';

/** The view of `content`, with CCP's children as its sub-topics unless `withChildren` is false. */
function view(
  content: string,
  options: ArticleViewOptions,
  maxTokens: number,
  withChildren = true,
): FetchArticleResult {
  const sections = extractSections(content);
  return buildArticleView(
    {
      title: 'Computer Configuration Profiles',
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles',
      ...(withChildren && { navigation: NAVIGATION }),
      sections,
    },
    content,
    options,
    maxTokens,
    sections,
  );
}

/** Lines of a markdown list of links or outline entries. */
function items(content: string): string[] {
  return content.split('\n').filter(line => /^ *- /.test(line));
}

const SHAPES: [string, string, ArticleViewOptions][] = [
  ['summaryOnly, no headings', HEADING_FREE, { summaryOnly: true }],
  ['summaryOnly, with headings', HEADED, { summaryOnly: true }],
  ['summaryOnly, a long first paragraph', LONG_LEAD, { summaryOnly: true }],
  ['a missed section, no headings', HEADING_FREE, { section: 'Nonexistent Zzz' }],
  ['a missed section, with headings', HEADED, { section: 'Nonexistent Zzz' }],
  ['a missed section matching a sub-topic', HEADING_FREE, { section: CHILD }],
  ['a found section', HEADED, { section: 'Component Group 2' }],
  ['the full article, no headings', HEADING_FREE, {}],
  ['the full article, with headings', HEADED, {}],
];

describe('buildArticleView: maxTokens bounds every shape', () => {
  describe.each([
    ['no note', undefined],
    ['a short note', SHORT_NOTE],
    ['the longest note', LONGEST_NOTE],
  ])('with %s', (_label, note) => {
    it.each(SHAPES.flatMap(([name, content, options]) =>
      [MIN, 150, 300, 1000].map(maxTokens => ({ name, content, options, maxTokens }))))(
      '$name at $maxTokens tokens',
      ({ content, options, maxTokens }) => {
        const result = view(content, { ...options, note }, maxTokens);

        expect(result.tokenInfo.maxTokens).toBe(maxTokens);
        expect(result.tokenInfo.tokenCount).toBe(estimateTokens(result.content));
        expect(result.tokenInfo.tokenCount).toBeLessThanOrEqual(maxTokens);
        if (note !== undefined) {
          expect(result.content.endsWith(`*Note: ${note}*\n`)).toBe(true);
        }
      },
    );
  });
});

describe('buildArticleView: what a cut reply says', () => {
  it('lists what fits of a missed section\'s sub-topics, the matching one first, and counts the rest', () => {
    // At 100 the matching link (~54 tokens) and the count do not fit beside
    // the not-found line; the next test covers what 100 does say.
    const result = view(HEADING_FREE, { section: CHILD }, 150);

    expect(result.sectionNotFound).toBe(true);
    expect(result.content).toContain(`*Section "${CHILD}" not found.*`);
    expect(result.tokenInfo.truncated).toBe(true);
    const links = items(result.content);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toContain('Manually_Creating_a_Configuration_Profile_macOS');
    expect(links[0]).toContain('matches');
    // Nine children: the ones listed plus the count add up to all of them.
    const more = /\.\.\.and (\d+) more/.exec(result.content);
    expect(links.length + Number(more?.[1])).toBe(9);
  });

  it('says a sub-topic list it cannot fit at all is there, rather than dropping it silently', () => {
    for (const options of [{ section: CHILD }, { summaryOnly: true }]) {
      const result = view(HEADING_FREE, options, MIN);

      expect(result.tokenInfo.truncated).toBe(true);
      expect(result.content).toContain(
        '*Sub-topics (9): not listed within `maxTokens`; `jamf_docs_get_toc` shows them all.*',
      );
    }
  });

  it('cuts a missed section\'s headings, leaving the sub-topics room to say they are there', () => {
    const result = view(HEADED, { section: 'Nonexistent Zzz' }, MIN);

    expect(result.tokenInfo.truncated).toBe(true);
    const listed = items(result.content);
    const more = /\.\.\.and (\d+) more, not listed within `maxTokens`/.exec(result.content);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length + Number(more?.[1])).toBe(HEADINGS);
    expect(result.content).toContain('Sub-topics (9)');
  });

  it('cuts a long outline and counts the rest', () => {
    const result = view(HEADED, { summaryOnly: true }, MIN, false);

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.content).toContain(`## Article Outline (${HEADINGS} sections)`);
    const listed = items(result.content);
    const more = /\.\.\.and (\d+) more sections, not listed within `maxTokens`/.exec(result.content);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length + Number(more?.[1])).toBe(HEADINGS);
    expect(result.content).toContain('*Estimated read time:');
  });

  it('does not let a long first paragraph push the outline out', () => {
    const result = view(LONG_LEAD, { summaryOnly: true }, 200, false);

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.content).toMatch(/## Summary\n\nLead sentence[^\n]*…\n/);
    expect(items(result.content)).toHaveLength(3);
  });

  it('makes room for a note by cutting the body, and says so', () => {
    // ~200 tokens of body fit 250 alone; with the longest note they do not.
    const alone = view(HEADING_FREE, {}, 250);
    const noted = view(HEADING_FREE, { note: LONGEST_NOTE }, 250);

    expect(alone.tokenInfo.truncated).toBe(false);
    expect(noted.tokenInfo.truncated).toBe(true);
    expect(noted.tokenInfo.tokenCount).toBe(estimateTokens(noted.content));
    expect(noted.tokenInfo.tokenCount).toBeGreaterThan(estimateTokens(`*Note: ${LONGEST_NOTE}*`));
  });
});

describe('buildArticleView: a budget that holds everything changes nothing', () => {
  it('lists every sub-topic under the full header when they fit', () => {
    const result = view(HEADING_FREE, { section: CHILD }, TOKEN_CONFIG.DEFAULT_MAX_TOKENS);

    expect(result.tokenInfo.truncated).toBe(false);
    expect(result.content).toContain('**Sub-topics (9):** this topic\'s children in the table of contents');
    expect(items(result.content)).toHaveLength(8);
    expect(result.content).toContain('*...and 1 more, not listed here; `jamf_docs_get_toc` shows them all.*');
    expect(result.content).not.toContain('within `maxTokens`');
  });

  it('prints the whole outline, and counts exactly the string it returns', () => {
    const result = view(HEADED, { summaryOnly: true }, TOKEN_CONFIG.DEFAULT_MAX_TOKENS);

    expect(result.tokenInfo.truncated).toBe(false);
    expect(items(result.content)).toHaveLength(HEADINGS + 8);
    // It used to be the count of `extractSummary`'s own, differently built
    // string: 459 for a reply of 449 on CCP, live.
    expect(result.tokenInfo.tokenCount).toBe(estimateTokens(result.content));
  });
});

describe('withNote: a reply rendered elsewhere, ended with core\'s note', () => {
  const MAX = 100;
  const block = `\n\n---\n*Note: ${SHORT_NOTE}*\n`;
  /** What the reply may take up and still leave the note room within MAX. */
  const budget = MAX - estimateTokens(block);

  /** A provider's reply of `tokens` tokens, sized by the provider for its own `maxTokens`. */
  function rendered(tokens: number, maxTokens = MAX): FetchArticleResult {
    const content = 'A line of a page a provider rendered itself.\n'.repeat(tokens).slice(0, tokens * 4);
    expect(estimateTokens(content)).toBe(tokens);
    return {
      title: 'Policies', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies', content, sections: [],
      tokenInfo: { tokenCount: tokens, truncated: false, maxTokens },
    };
  }

  it('appends the note to a reply that leaves it room exactly, and cuts nothing', () => {
    const reply = rendered(budget);

    const result = withNote(reply, SHORT_NOTE, MAX);

    expect(result.content).toBe(reply.content + block);
    expect(result.tokenInfo).toEqual({ tokenCount: MAX, truncated: false, maxTokens: MAX });
  });

  it('cuts a reply one token longer than that, and says so', () => {
    const result = withNote(rendered(budget + 1), SHORT_NOTE, MAX);

    expect(result.content.endsWith(block)).toBe(true);
    expect(result.tokenInfo.tokenCount).toBe(estimateTokens(result.content));
    expect(result.tokenInfo.tokenCount).toBeLessThanOrEqual(MAX);
    expect(result.tokenInfo.truncated).toBe(true);
  });

  it('reports the maxTokens it kept the reply within, not the one the provider sized it for', () => {
    const result = withNote(rendered(budget, TOKEN_CONFIG.DEFAULT_MAX_TOKENS), SHORT_NOTE, MAX);

    expect(result.tokenInfo.maxTokens).toBe(MAX);
  });
});
