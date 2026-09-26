/**
 * The live glossary as Fluid Topics serves it, with a switch to make any
 * entry's definition fail the way `http-client` fails.
 *
 * For suites that mock `fetchMapToc` and `fetchTopicContent` in `ft-client`
 * and drive the real `lookupGlossaryTerm` behind them.
 */

import { HttpError } from '../../src/core/http-client.js';
import type { FtTocNode } from '../../src/core/types.js';
import { GLOSSARY_TITLES } from '../fixtures/glossary-titles.js';

/** The en-US glossary map. */
export const GLOSSARY_MAP_ID = 'GY9~75TOe8bNn9iDgvgqpA';

function idFor(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, '_');
}

const TITLE_BY_ID = new Map(GLOSSARY_TITLES.map(title => [idFor(title), title]));

/** A glossary TOC: one root whose children are the terms. */
export function glossaryToc(children: FtTocNode[]): FtTocNode[] {
  return [{
    tocId: 'toc-root',
    contentId: 'root',
    title: 'Jamf Platform Technical Glossary',
    prettyUrl: '/r/en-US/jamf-technical-glossary/root',
    children,
  }];
}

function termNode(title: string): FtTocNode {
  const id = idFor(title);
  return {
    tocId: `toc-${id}`,
    contentId: id,
    title,
    prettyUrl: `/r/en-US/jamf-technical-glossary/${id}`,
    children: [],
  };
}

/** The TOC of all 123 live terms. */
export const LIVE_GLOSSARY_TOC = glossaryToc(GLOSSARY_TITLES.map(termNode));

/** The display URL the lookup gives the entry `title`. */
export function glossaryEntryUrl(title: string): string {
  return `https://learn.jamf.com/r/en-US/jamf-technical-glossary/${idFor(title)}`;
}

/**
 * The definitions the failure suites turn on, verbatim from `/content` on
 * 2026-09-24. Real text matters for `device enrollment`: whether the ranker
 * lets it answer `Automated Device Enrollment` depends on its definition.
 * Every other entry gets a placeholder.
 */
const LIVE_DEFINITIONS: Record<string, string> = {
  'mobile device management (MDM)': "Apple's built-in framework that lets administrators remotely configure and monitor Apple devices, and allows software vendors like Jamf build comprehensive MDM solutions.",
  'User Approved MDM': 'A macOS security feature that requires explicit user consent before allowing a mobile device management (MDM) solution to manage certain system settings and configurations.',
  'Automated Device Enrollment': "Apple's program for zero touch deployment solution, allowing organizations to automatically enroll and configure Apple devices into a mobile device management (MDM) solution during setup.",
  'device enrollment': 'The process of adding a device to a Jamf management or security solution. A device is considered enrolled  when the device and the Jamf service, or server, are able to communicate with each other.',
};

/** A `/content` body in the live shape: the definition alone. */
function contentHtml(title: string): string {
  const definition = LIVE_DEFINITIONS[title] ?? `Definition of ${title}.`;
  return '<div class="content-locale-en-US content-locale-en"><div id="glossentry-1">' +
    `<div class="abstract glossdef"><p class="p">${definition}</p></div></div></div>`;
}

/** What `http-client` throws for a 503 from `url`. */
export function http503(url: string): HttpError {
  return new HttpError(503, 'Service Unavailable', url);
}

/**
 * A `fetchTopicContent` implementation over the live titles, answering 503
 * for every title in `failing` — read on each call, so a test can change it
 * between lookups.
 *
 * `bodies` replaces the served `/content` of the titles it names, for a suite
 * that needs an entry's own markup rather than its definition in a `<p>`.
 */
export function serveGlossaryContent(
  failing: () => ReadonlySet<string>,
  bodies: Readonly<Record<string, string>> = {},
): (http: unknown, mapId: string, contentId: string) => Promise<string> {
  return async (_http, mapId, contentId) => {
    await Promise.resolve();
    const title = TITLE_BY_ID.get(contentId) ?? contentId;
    if (failing().has(title)) {
      throw http503(`https://learn.jamf.com/api/khub/maps/${mapId}/topics/${contentId}/content`);
    }
    return bodies[title] ?? contentHtml(title);
  };
}
