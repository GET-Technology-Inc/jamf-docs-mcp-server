/**
 * Five learn.jamf.com publications as Fluid Topics served them on
 * 2026-09-28, cut to the entries whose urls `jamf_docs_get_toc` hands out and
 * `jamf_docs_get_article` has to open again: each map as the maps list gives
 * it (the metadata the registry reads), those entries of its TOC, and the
 * topics its `/topics` list gives for them, in the order it gives them. The
 * TOC entries are listed flat, in the order the live TOC gives them when
 * flattened, which is the order of the `/topics` list.
 *
 * A topic in the `/topics` list carries `readerUrl`, the page's address on
 * the site, and a TOC entry's `prettyUrl` is that same address: for all 2,742
 * TOC entries of the five en-US publications `jamf_docs_get_toc` was measured
 * on, the 428 of Jamf School in ja-JP and the 317 of Technical Articles in
 * ja-JP. What else a topic carries varies:
 *
 * - Jamf Pro: "Configuring the Branding Settings" and "Purchasing Category"
 *   have no `legacy_topicname`, and are published at a hyphenated address.
 *   The live TOC lists each twice, under two parents.
 *   "And/Or Groupings" has none either, is listed four times, and is
 *   published at `And/Or-Groupings`, a page with a `/` in it. The TOC and the
 *   `/topics` list give these entries in the same order, as they give all
 *   794 of theirs.
 * - Jamf Connect: "General Requirements" is the title of both the topic at
 *   `General_Requirements` and the one at `General-Requirements`, two
 *   different topics. And `Troubleshooting` is the address of two topics, one
 *   with that `legacy_topicname` and one with none.
 * - Technical Articles: `Obtaining-the-Management-ID` is the address of two
 *   topics, neither with a `legacy_topicname`, and both are titled "Obtaining
 *   the Management ID". "Setting the --log-bin Option…" has the
 *   `legacy_topicname` `Setting_the_--log-bin_…` and is published at
 *   `Setting_the_-log-bin_…`.
 * - Technical Articles, ja-JP: five topics are titled 追加情報. The first
 *   four are published at `Additional_Information`, each with that
 *   `legacy_topicname`; the fifth, with none, at `追加情報`, which is the
 *   first one's title key too. The TOC lists the fifth four times.
 * - Jamf School, ja-JP: "Jamf School から管理者データを削除する" is published
 *   at `Jamf-School-から管理者テータを削除する` (テータ, not データ), raw, not
 *   percent-encoded.
 */

import type { FtMapInfo, FtMetadataEntry, FtTocNode, FtTopicInfo } from '../../src/core/types.js';

const meta = (key: string, ...values: string[]): FtMetadataEntry => ({ key, label: key, values });

export interface TocUrlPublication {
  /** The `jamf_docs_get_toc` arguments that list it. */
  tocArgs: Record<string, string>;
  map: FtMapInfo;
  toc: FtTocNode[];
  topics: FtTopicInfo[];
}

/** `[tocId, contentId, title, page]`, the page being what follows `/r/{locale}/{bundle}/` in `prettyUrl`. */
type TocRow = [string, string, string, string];
/** `[id, title, page, legacy_topicname?]`, the page being what follows `/r/{locale}/{bundle}/` in `readerUrl`. */
type TopicRow = [string, string, string, string?];

function publication(
  tocArgs: Record<string, string>,
  map: FtMapInfo,
  address: string,
  tocRows: TocRow[],
  topicRows: TopicRow[],
): TocUrlPublication {
  return {
    tocArgs,
    map,
    toc: tocRows.map(([tocId, contentId, title, page]) => ({
      tocId, contentId, title, prettyUrl: `/r/${address}/${page}`,
    })),
    topics: topicRows.map(([id, title, page, legacyName]) => ({
      title, id,
      contentApiEndpoint: `/api/khub/maps/${map.id}/topics/${id}/content`,
      readerUrl: `/r/${address}/${page}`,
      metadata: legacyName !== undefined ? [meta('legacy_topicname', legacyName)] : [],
    })),
  };
}

/** "And/Or Groupings", published at a page with a `/` in it. */
export const AND_OR_GROUPINGS = 'EbCwT5BD63Mu7WIrAMquaw';

export const PRO = publication(
  { product: 'jamf-pro' },
  {
    id: 'A4LI4vM0BILraYeOD89WGg', title: 'Jamf Pro Documentation 11.32.0',
    mapApiEndpoint: '/api/khub/maps/A4LI4vM0BILraYeOD89WGg',
    metadata: [
      meta('ft:locale', 'en-US'), meta('bundle', 'jamf-pro-documentation-current', 'jamf-pro-documentation-11.32.0'),
      meta('version_bundle_stem', 'jamf-pro-documentation'), meta('version', '11.32.0'), meta('latestVersion', 'yes'),
      meta('jamf:portal', 'Jamf Pro'), meta('jamf:app'), meta('jamf:utility'),
    ],
  },
  'en-US/jamf-pro-documentation-current',
  [
    ['NW9ICWJYXJEtRtVj2iWk2A', 'A2urIBkYSSXsgJui8Xu0CQ', 'Self Service for macOS Branding Settings', 'Jamf_Self_Service_for_macOS_Branding_Settings'],
    ['wRliaXIf2896sWevjHu4gQ', '0nogkohSmN7SEAGQHhFTbw', 'Configuring the Branding Settings', 'Configuring-the-Branding-Settings'],
    ['Gp91UeXUfeNIQJNqVbW0Kw', '0nogkohSmN7SEAGQHhFTbw', 'Configuring the Branding Settings', 'Configuring-the-Branding-Settings'],
    ['QDcm1_LfXTtdloo~5TTSwg', 'TepakeNUd9K8VKlVHxsgTQ', 'Purchasing Category', 'Purchasing-Category'],
    ['PzGrlpbY90RqCbxaTEBjEQ', AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    ['OaFYzkcztrx0VwcHY9RHJg', 'TepakeNUd9K8VKlVHxsgTQ', 'Purchasing Category', 'Purchasing-Category'],
    ['axvZEaM8y8hgsz1yiCSEfw', AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    ['C47FaBU9tamYk8SiYXd2Gg', AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    ['F_x9yK8vddIim3PPQIAQOg', AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
  ],
  [
    ['A2urIBkYSSXsgJui8Xu0CQ', 'Self Service for macOS Branding Settings', 'Jamf_Self_Service_for_macOS_Branding_Settings', 'Jamf_Self_Service_for_macOS_Branding_Settings'],
    ['0nogkohSmN7SEAGQHhFTbw', 'Configuring the Branding Settings', 'Configuring-the-Branding-Settings'],
    ['0nogkohSmN7SEAGQHhFTbw', 'Configuring the Branding Settings', 'Configuring-the-Branding-Settings'],
    ['TepakeNUd9K8VKlVHxsgTQ', 'Purchasing Category', 'Purchasing-Category'],
    [AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    ['TepakeNUd9K8VKlVHxsgTQ', 'Purchasing Category', 'Purchasing-Category'],
    [AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    [AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
    [AND_OR_GROUPINGS, 'And/Or Groupings', 'And/Or-Groupings'],
  ],
);

/** The topic at `General_Requirements` and the one at `General-Requirements`. */
export const CONNECT_GENERAL_REQUIREMENTS = 'WAN90oOfsGFGXn~xAIqWpg';
export const CONNECT_GENERAL_REQUIREMENTS_HYPHENATED = 'NMAuPbiWjDpOkr52PFoL3Q';
/** The two topics at `Troubleshooting`: the one with that `legacy_topicname`, and the one with none. */
export const CONNECT_TROUBLESHOOTING_LEGACY = 'xghkqojIx5SYlRJMEbfd1Q';
export const CONNECT_TROUBLESHOOTING_OTHER = 'hlywiFIPczeaQLWU70FPHA';

export const CONNECT = publication(
  { product: 'jamf-connect' },
  {
    id: 'bjs61pwUXJK9FzeINitaJA', title: 'Jamf Connect Documentation',
    mapApiEndpoint: '/api/khub/maps/bjs61pwUXJK9FzeINitaJA',
    metadata: [
      meta('ft:locale', 'en-US'), meta('bundle', 'jamf-connect-documentation-current'),
      meta('jamf:portal'), meta('jamf:app', 'Jamf Connect'), meta('jamf:utility'),
    ],
  },
  'en-US/jamf-connect-documentation-current',
  [
    ['b5kt1WSxlYlXuLpuxgIk8g', 'OBw7onvwMST3UmyynYjl~A', 'Getting Started', 'Getting-Started'],
    ['CXZ4UOo_ucqTvdHSGIcPVQ', CONNECT_GENERAL_REQUIREMENTS, 'General Requirements', 'General_Requirements'],
    ['K2dvQ1E7KwSBGokdpCSyhg', CONNECT_TROUBLESHOOTING_LEGACY, 'Troubleshooting', 'Troubleshooting'],
    ['X6PEfSlx1ybFnr4gYuwODA', CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    ['cr_DgCFiqu8B6AMetfOQXA', CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    ['5KKpkEQlW5K5vOsU1kHHNw', CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    ['8XfnAG1DZD4C14vETIrU~A', CONNECT_TROUBLESHOOTING_OTHER, 'Troubleshooting', 'Troubleshooting'],
    ['7gKfn6QkHpZSJGXU9tpBeg', CONNECT_TROUBLESHOOTING_OTHER, 'Troubleshooting', 'Troubleshooting'],
  ],
  [
    ['OBw7onvwMST3UmyynYjl~A', 'Getting Started', 'Getting-Started'],
    [CONNECT_GENERAL_REQUIREMENTS, 'General Requirements', 'General_Requirements', 'General_Requirements'],
    [CONNECT_TROUBLESHOOTING_LEGACY, 'Troubleshooting', 'Troubleshooting', 'Troubleshooting'],
    [CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    [CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    [CONNECT_GENERAL_REQUIREMENTS_HYPHENATED, 'General Requirements', 'General-Requirements'],
    [CONNECT_TROUBLESHOOTING_OTHER, 'Troubleshooting', 'Troubleshooting'],
    [CONNECT_TROUBLESHOOTING_OTHER, 'Troubleshooting', 'Troubleshooting'],
  ],
);

/** "Setting the --log-bin Option…", whose legacy_topicname is not its address. */
export const LOG_BIN = 'Wyd_~GndRsnnGrao0VgN3g';
export const LOG_BIN_LEGACY_NAME = 'Setting_the_--log-bin_Option_for_Replication_or_Point-in-Time_Recovery';
/** The two topics at `Obtaining-the-Management-ID`, in the order of the `/topics` list. */
export const MANAGEMENT_ID_TOPICS = ['xg9vvm4~aCf3tgwg1sHyuA', 'qmxhdlXikJVI4b_ycKQaGg'] as const;

export const TECHNICAL_ARTICLES = publication(
  { publication: 'technical-articles' },
  {
    id: 'ZlB_0jgM2084m7JxZgV1KQ', title: 'Technical Articles',
    mapApiEndpoint: '/api/khub/maps/ZlB_0jgM2084m7JxZgV1KQ',
    metadata: [
      meta('ft:locale', 'en-US'), meta('bundle', 'technical-articles'),
      meta('jamf:portal'), meta('jamf:app'), meta('jamf:utility'),
    ],
  },
  'en-US/technical-articles',
  [
    ['VW7SDhy6GZeOB6X5PmZ0Ww', 'xg9vvm4~aCf3tgwg1sHyuA', 'Obtaining the Management ID', 'Obtaining-the-Management-ID'],
    ['cWt7ll9Liw8ys6DtovGDfg', 'qmxhdlXikJVI4b_ycKQaGg', 'Obtaining the Management ID', 'Obtaining-the-Management-ID'],
    ['zzb0AjBNsamC7h9M0ANDjA', LOG_BIN, 'Setting the --log-bin Option for Replication or Point-in-Time Recovery', 'Setting_the_-log-bin_Option_for_Replication_or_Point-in-Time_Recovery'],
  ],
  [
    ['xg9vvm4~aCf3tgwg1sHyuA', 'Obtaining the Management ID', 'Obtaining-the-Management-ID'],
    ['qmxhdlXikJVI4b_ycKQaGg', 'Obtaining the Management ID', 'Obtaining-the-Management-ID'],
    [LOG_BIN, 'Setting the --log-bin Option for Replication or Point-in-Time Recovery', 'Setting_the_-log-bin_Option_for_Replication_or_Point-in-Time_Recovery', LOG_BIN_LEGACY_NAME],
  ],
);

/**
 * The four topics titled 追加情報 at `Additional_Information`, each with that
 * `legacy_topicname`, in the order of the `/topics` list.
 */
export const TA_JA_ADDITIONAL_INFORMATION = [
  'Do33vZ41~CoWPRujNywU6w', 'fhS0RD5nFDf_gNZVyJYMWQ', 'rzDxh1_aV92~BMihJlEXpA', 'Cgczsz~XB~7Ko1CEAupCPA',
] as const;
/** The topic titled 追加情報 at `追加情報`, with no `legacy_topicname`. */
export const TA_JA_TSUIKA_JOHO = 'tY0oTORkrBlHYM~Zs6vczw';

const [INFO_1, INFO_2, INFO_3, INFO_4] = TA_JA_ADDITIONAL_INFORMATION;

export const TECHNICAL_ARTICLES_JA = publication(
  { publication: 'technical-articles', language: 'ja-JP' },
  {
    id: '4prlDqjYgcDbrTpLTJ15tg', title: '技術に関する記事',
    mapApiEndpoint: '/api/khub/maps/4prlDqjYgcDbrTpLTJ15tg',
    metadata: [
      meta('ft:locale', 'ja-JP'), meta('bundle', 'technical-articles'),
      meta('jamf:portal'), meta('jamf:app'), meta('jamf:utility'),
    ],
  },
  'ja-JP/technical-articles',
  [
    ['JBAQWX2_MA7cTXQuf5hZSA', INFO_1, '追加情報', 'Additional_Information'],
    ['q3Mwi3BevJ~qGDwLL1PO3g', INFO_2, '追加情報', 'Additional_Information'],
    ['xEyJVo3SH7pRfgbaZ22G5Q', INFO_3, '追加情報', 'Additional_Information'],
    ['JAnieJcbL2OvEO7soYsaqw', INFO_4, '追加情報', 'Additional_Information'],
    ['ISxqf36AzIjIKV~UmzjmjQ', TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    ['AD7AoA4WwPcxCkxOroroxw', TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    ['IoMZau4MwOwjm9k3mMoixg', TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    ['zBzEGlG71bu9Kn2mDIQeEg', TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
  ],
  [
    [INFO_1, '追加情報', 'Additional_Information', 'Additional_Information'],
    [INFO_2, '追加情報', 'Additional_Information', 'Additional_Information'],
    [INFO_3, '追加情報', 'Additional_Information', 'Additional_Information'],
    [INFO_4, '追加情報', 'Additional_Information', 'Additional_Information'],
    [TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    [TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    [TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
    [TA_JA_TSUIKA_JOHO, '追加情報', '追加情報'],
  ],
);

export const SCHOOL_JA = publication(
  { product: 'jamf-school', language: 'ja-JP' },
  {
    id: 'BeZ5J_jzw71FCVw~Tf3DXQ', title: 'Jamf School ドキュメント',
    mapApiEndpoint: '/api/khub/maps/BeZ5J_jzw71FCVw~Tf3DXQ',
    metadata: [
      meta('ft:locale', 'ja-JP'), meta('bundle', 'jamf-school-documentation'),
      meta('jamf:portal', 'Jamf School'), meta('jamf:app'), meta('jamf:utility'),
    ],
  },
  'ja-JP/jamf-school-documentation',
  [
    ['zAmgoV0N__QHuSSkOyRZqQ', 'wfhuJq~E9k8sGEHc07BgnA', 'はじめに', 'Before_You_Begin'],
    ['b7fTQ3FBdyfOFqxsA2xPTQ', 'dm9T07Iv_tPq_rjTO~C80A', 'Jamf School から管理者データを削除する', 'Jamf-School-から管理者テータを削除する'],
    ['yIcAfx1dq3rWOWD~Y3IFOQ', 'dm9T07Iv_tPq_rjTO~C80A', 'Jamf School から管理者データを削除する', 'Jamf-School-から管理者テータを削除する'],
  ],
  [
    ['wfhuJq~E9k8sGEHc07BgnA', 'はじめに', 'Before_You_Begin', 'Before_You_Begin'],
    ['dm9T07Iv_tPq_rjTO~C80A', 'Jamf School から管理者データを削除する', 'Jamf-School-から管理者テータを削除する'],
    ['dm9T07Iv_tPq_rjTO~C80A', 'Jamf School から管理者データを削除する', 'Jamf-School-から管理者テータを削除する'],
  ],
);

export const TOC_URL_PUBLICATIONS: Record<string, TocUrlPublication> = {
  'Jamf Pro': PRO,
  'Jamf Connect': CONNECT,
  'Technical Articles': TECHNICAL_ARTICLES,
  'Technical Articles (ja-JP)': TECHNICAL_ARTICLES_JA,
  'Jamf School (ja-JP)': SCHOOL_JA,
};
