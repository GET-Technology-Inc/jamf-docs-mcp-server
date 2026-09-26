/**
 * Jamf Pro and LAPS topics as the Fluid Topics API serves them, for suites that
 * drive `jamf_docs_get_article` end to end with the HTTP layer mocked.
 *
 * The payloads get-article-addressing.test.ts uses, captured live on
 * 2026-09-24 and trimmed to the fields the code reads, plus the LAPS child
 * that shares its parent's slug, and Policies in the previous Jamf Pro
 * version. The topic metadata carries no `readerUrl`, because the live
 * single-topic endpoint sends none.
 */

import type { LocaleId } from '../../src/core/constants.js';
import type { ResolvedTopic, TopicResolverInput } from '../../src/core/services/topic-resolver.js';
import type { FtMetadataEntry, FtTocNode, FtTopicInfo } from '../../src/core/types.js';

// ── Live identifiers (2026-09-24) ───────────────────────────────────────────

/** Jamf Pro Documentation 11.32.0, en-US, and its ja-JP counterpart. */
export const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
export const PRO_MAP_JA = 'GE9~jUeMhje7axrw1dW5VA';
/**
 * Jamf Pro Documentation 11.31.0, en-US. A topic keeps its contentId from one
 * version to the next: all 747 topics it shares with 11.32.0 do (2026-09-26),
 * Policies among them.
 */
export const PRO_MAP_PREVIOUS = 'wqin5wmqOhRZNP0CChQ8MQ';
/** Technical paper: Local Administrator Password Solution for Jamf Pro. */
export const LAPS_MAP = '1ZN5bkFvUa6baRoUXR6Zog';

export const CCP = 'fFa7Mu0YJW87Bs~ZXE_j2Q';
export const POLICIES = '0Kv7TU1RQ7Sd8J2yMYv8Ew';
export const POLICIES_JA = '5j4iXKsKVvDiCZ055Zr_xA';
/** "Use LAPS". */
export const USE_LAPS = 'cS8N6f3zVb5pvf0xGCi_ug';
/** "Using LAPS in the Jamf Pro API", the child of "Use LAPS" published at the same slug. */
export const LAPS_API = 'XD_dFGbPnBjOLmq~fF_mSw';

export const POLICIES_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
export const CCP_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Computer_Configuration_Profiles.html';
export const CCP_OWN = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles';
/** A search result's url for "Use LAPS" — a slug two topics in the map share. */
export const USING_LAPS_URL = 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The nine children of Computer Configuration Profiles, in TOC order. */
const CCP_CHILDREN: FtTocNode[] = [
  ['aHcXwrQyqrcQ2D2EdCMDMw', '3Mpui0ZOoQ3uGb7cGLsTfQ', 'Payload Variables for Configuration Profiles', 'Payload_Variables_for_macOS_Configuration_Profiles'],
  ['_8WC9PXcqdD2X4XsobK9Yw', 'o151BksE0LcObjYlsr~qZA', 'General Requirements', 'GenReq_ConfigurationProfiles'],
  ['2JZZTtUS9I8p2giBSwU_fQ', 'v50nLP18~OletJXXnqIA1w', 'Creating a Computer Configuration Profile in Jamf Pro', 'Manually_Creating_a_Configuration_Profile_macOS'],
  ['dT6fHhDN_pjVZp853z51zw', 'b5PDi2GCMUSyh2CUh~qNVQ', 'Uploading a Configuration Profile', 'Uploading_a_Configuration_Profile_macOS'],
  ['G8HplcHA6xHIULqeC5jU9w', 'ttd37oezfA_GOJTovqjqJg', 'Editing the Settings or Scope of a Configuration Profile', 'Editing_the_Settings_or_Scope_of_a_Configuration_Profile_macOS'],
  ['GTmgmp8yRi~MfkSVGA1C3A', 'eZGvEE25TuCm~lHfBok4KQ', 'Downloading a Configuration Profile', 'Downloading-a-Configuration-Profile'],
  ['SuxinLUtxHtNYe3Un~jzMw', 'XFEgU~UjMrMqU63LZjr3gA', 'Viewing the Status of a Configuration Profile', 'Viewing-the-Status-of-a-Configuration-Profile'],
  ['ikjp2h3NYjHdYIAwn1etXw', 'bCqoSPHrfqtXEXqKT43EuQ', 'Troubleshooting a Failed Status of a Configuration Profile', 'Troubleshooting_a_Failed_Status_of_a_Configuration_Profile'],
  ['tUX1Oo8q_xDaOn7Ge1oXJA', '2aaPG7B2hnyp_D0cKRsUDg', 'Adding a Computer Configuration Profile to the Jamf Pro Dashboard', 'Adding_a_Computer_Configuration_Policy_to_the_Jamf_Pro_Dashboard'],
].map(([tocId, contentId, title, slug]) => ({
  tocId, contentId, title,
  prettyUrl: `/r/en-US/jamf-pro-documentation-current/${slug}`,
}));

/** The four children of Policies, in TOC order; pages of their own on the site. */
const POLICIES_CHILDREN: FtTocNode[] = [
  ['hr0vbSRVrOqLV1RxhsC0Iw', 'sMX6~O1sgr8I2lopUhnZ0Q', 'Execution Frequency for Policies', 'Execution_Frequency_for_Policies'],
  ['FQ6MqL_2snRXkLOF~Os7qw', 'KGltaN4o3nLWOd_zhvw~fA', 'Policy Management', 'Policy_Management'],
  ['9ofnWI3RPaBzMt5h73VT0w', 'td3bR3BReqbILEFegdYk1w', 'Policy Payload Reference', 'Policy_Payload_Reference'],
  ['u8f6UbvG8l02Qe2w2YFlqQ', 'Eynb~9d86NgqSpbKOddwnQ', 'User Interaction with Policies', 'User_Interaction_with_Policies'],
].map(([tocId, contentId, title, slug]) => ({
  tocId, contentId, title,
  prettyUrl: `/r/en-US/jamf-pro-documentation-current/${slug}`,
}));

const TOCS: Record<string, FtTocNode[]> = {
  [PRO_MAP]: [{
    tocId: 'managing-computers', contentId: 'managing-computers-topic', title: 'Managing Computers',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Managing_Computers',
    children: [
      {
        tocId: '29eZhNisNhAykqfEi9dP_w', contentId: POLICIES, title: 'Policies',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Policies',
        children: POLICIES_CHILDREN,
      },
      {
        tocId: 'ccHIl700Hz_GM3SLvzTKzA', contentId: CCP, title: 'Computer Configuration Profiles',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles',
        children: CCP_CHILDREN,
      },
    ],
  }],
  [PRO_MAP_JA]: [{
    tocId: 'X0J6QXaT5MVKAhdMtgAaIg', contentId: POLICIES_JA, title: 'ポリシー',
    prettyUrl: '/r/ja-JP/jamf-pro-documentation-current/Policies',
  }],
  [PRO_MAP_PREVIOUS]: [{
    tocId: '29eZhNisNhAykqfEi9dP_w', contentId: POLICIES, title: 'Policies',
    prettyUrl: '/r/en-US/jamf-pro-documentation-11.31.0/Policies',
  }],
  // "Use LAPS" and its child "Using LAPS in the Jamf Pro API" publish under the
  // same `Using_LAPS` slug, so resolving that url alone lands on the child.
  [LAPS_MAP]: [{
    tocId: 'VN~_HlL~gTRFdtIP~ZP3kw', contentId: USE_LAPS, title: 'Use LAPS',
    prettyUrl: '/r/en-US/technical-paper-laps-current/Using_LAPS',
    children: [{
      tocId: 'pZaUv5ZbiUCDcZprz9NILw', contentId: LAPS_API,
      title: 'Using LAPS in the Jamf Pro API',
      prettyUrl: '/r/en-US/technical-paper-laps-current/Using_LAPS',
    }],
  }],
};

function metadata(prettyUrl: string, locale: string, version: string): FtMetadataEntry[] {
  return [
    { key: 'version', label: 'version', values: [version] },
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
    { key: 'ft:lastEdition', label: 'ft:lastEdition', values: ['2025-07-31'] },
    { key: 'ft:locale', label: 'ft:locale', values: [locale] },
    { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: [prettyUrl] },
  ];
}

/**
 * `title, id, contentApiEndpoint, metadata` — the live payload has no
 * `readerUrl` — under `{mapId}/{contentId}`, since a contentId alone names a
 * topic in every version that has it.
 */
function topic(
  mapId: string, id: string, title: string, prettyUrl: string, locale = 'en-US', version = '11.32.0',
): [string, FtTopicInfo] {
  return [`${mapId}/${id}`, {
    title, id,
    contentApiEndpoint: `/api/khub/maps/${mapId}/topics/${id}/content`,
    metadata: metadata(prettyUrl, locale, version),
  }];
}

const TOPICS: Record<string, FtTopicInfo> = Object.fromEntries([
  topic(PRO_MAP, CCP, 'Computer Configuration Profiles', 'en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles'),
  topic(PRO_MAP, POLICIES, 'Policies', 'en-US/jamf-pro-documentation-current/Policies'),
  topic(PRO_MAP_JA, POLICIES_JA, 'ポリシー', 'ja-JP/jamf-pro-documentation-current/Policies', 'ja-JP'),
  topic(PRO_MAP_PREVIOUS, POLICIES, 'Policies', 'en-US/jamf-pro-documentation-11.31.0/Policies', 'en-US', '11.31.0'),
  topic(LAPS_MAP, USE_LAPS, 'Use LAPS', 'en-US/technical-paper-laps-current/Using_LAPS'),
  topic(LAPS_MAP, LAPS_API, 'Using LAPS in the Jamf Pro API', 'en-US/technical-paper-laps-current/Using_LAPS'),
]);

/**
 * `GET …/topics/fFa7Mu0YJW87Bs~ZXE_j2Q/content`, verbatim: 2003 bytes, one
 * `div.body.conbody` of four paragraphs and a related-links nav, and not one
 * `<h1>`–`<h6>`. Long enough that it does not fit `maxTokens: 100`.
 */
export const CCP_HTML = '<div class="content-locale-en-US content-locale-en"><div id="ID-00022bba"><div class="body conbody">'
  + '<p class="p">Configuration profiles are XML files (<span class="ph filepath">.mobileconfig</span>) that provide an easy way to define settings and restrictions for devices, computers, and users.</p>'
  + '<p class="p">You can use <span class="ph">Jamf Pro</span> to create a configuration profile or you can upload a configuration profile that was created using third-party software.</p>'
  + '<p class="p">When you create a computer configuration profile, you must specify the level at which to apply the profile—computer-level or user-level. Each level has a unique set of payloads and a few that are common to both. User-level profiles may not apply until the MDM-enabled user logs out of the computer and logs back in, or when the computer is restarted.</p>'
  + '<p class="p">There are two different ways to distribute a configuration profile: install it automatically (requires no interaction from the user) or make it available in Self Service.</p>'
  + '</div><nav role="navigation" class="related-links"><div class="relinfo linklist"><strong>Related content</strong><ul class="linklist">'
  + '<li class="linklist"><a class="link ft-external-link" href="https://learn.jamf.com/bundle/technical-articles/page/Deploying_Custom_Computer_Configuration_Profiles_Using_the_Application_and_Custom_Settings_Payload.html" target="_blank" rel="noopener">Deploying Custom Computer Configuration Profiles Using the Application and Custom Settings Payload</a></li>'
  + '</ul></div></nav></div></div>';

const OTHER_HTML = '<div class="body conbody"><p class="p">Body.</p></div>';

// ── Routing ─────────────────────────────────────────────────────────────────

/** The two GETs a Fluid Topics article fetch makes, answered from the fixtures. */
export interface ArticleUpstream {
  getJson: (url: string) => Promise<unknown>;
  getText: (url: string) => Promise<string>;
}

/**
 * Serve the fixtures. `bodies` are topic bodies by content ID, over the
 * default: `CCP_HTML` for Computer Configuration Profiles and a one-line body
 * for every other topic.
 */
export function articleUpstream(bodies: Record<string, string> = {}): ArticleUpstream {
  const bodyOf: Record<string, string> = { [CCP]: CCP_HTML, ...bodies };
  return {
    getJson: async (url) => {
      await Promise.resolve();
      const path = decodeURIComponent(new URL(url).pathname);
      const toc = /^\/api\/khub\/maps\/([^/]+)\/toc$/.exec(path);
      if (toc !== null) {
        return Object.hasOwn(TOCS, toc[1]) ? TOCS[toc[1]] : [];
      }
      const topicPath = /^\/api\/khub\/maps\/([^/]+)\/topics\/([^/]+)$/.exec(path);
      const key = topicPath === null ? undefined : `${topicPath[1]}/${topicPath[2]}`;
      if (key !== undefined && Object.hasOwn(TOPICS, key)) {
        return TOPICS[key];
      }
      throw new Error(`Unexpected GET JSON: ${url}`);
    },
    getText: async (url) => {
      await Promise.resolve();
      const content = /\/topics\/([^/]+)\/content$/.exec(decodeURIComponent(new URL(url).pathname));
      if (content !== null) {
        return Object.hasOwn(bodyOf, content[1]) ? bodyOf[content[1]] : OTHER_HTML;
      }
      throw new Error(`Unexpected GET text: ${url}`);
    },
  };
}

/**
 * What the topic resolver answers for the fixture urls, for a stub in its
 * place. Resolving a url is the resolver's job and has its own tests.
 *
 * `language` moves Policies.html to the ja-JP map. A language with no map of
 * its own leaves it on the en-US one but comes back as the requested locale,
 * as the live resolver does: `th-TH` on Policies.html resolved to the en-US
 * pair with `locale: "th-TH"` (2026-09-26).
 */
export async function resolveFixtureUrl(input: TopicResolverInput): Promise<ResolvedTopic> {
  await Promise.resolve();
  const locale = (input.locale ?? 'en-US') as LocaleId;
  if (input.url === POLICIES_URL) {
    return locale === 'ja-JP'
      ? { mapId: PRO_MAP_JA, contentId: POLICIES_JA, locale }
      : { mapId: PRO_MAP, contentId: POLICIES, locale };
  }
  if (input.url === CCP_URL) {
    return { mapId: PRO_MAP, contentId: CCP, locale };
  }
  if (input.url === USING_LAPS_URL) {
    return { mapId: LAPS_MAP, contentId: LAPS_API, locale };
  }
  throw new Error(`Unexpected resolve: ${JSON.stringify(input)}`);
}
