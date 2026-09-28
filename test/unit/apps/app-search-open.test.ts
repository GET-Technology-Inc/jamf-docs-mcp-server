/**
 * A search result opens its own article in the MCP App, even where another
 * result shares its url.
 *
 * The App opened every result with `jamf_docs_get_article { url }`. Jamf
 * publishes some different topics at one url, and the url fetches only one of
 * them: live on 2026-09-28, `/r/en-US/technical-articles/Additional_Information`
 * opened the section of "Jamf Pro External Patch Source Endpoints" from any of
 * the 19 results there, and the LAPS paper's "Use LAPS" opened its child
 * "Using LAPS in the Jamf Pro API". Since the search returns every topic of a
 * cluster, there are more such results on screen. A result also carries its
 * `mapId` + `contentId` pair, which learn.jamf.com fetches by, and the App now
 * sends it, unless the host's language would have opened a translation by url.
 *
 * Asserted against `articleArgs` and `hitIdAttributes` themselves, which live
 * in `app-ui/search.ts` because importing app.ts throws outside a browser, and
 * then against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';

import { articleArgs, hitIdAttributes } from '../../../app-ui/search.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

/** Two live results at one url (2026-09-28): "Use LAPS" and its child. */
const USE_LAPS = {
  url: 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS',
  mapId: '1ZN5bkFvUa6baRoUXR6Zog',
  contentId: 'cS8N6f3zVb5pvf0xGCi_ug',
};
const USING_LAPS_IN_THE_API = { ...USE_LAPS, contentId: 'XD_dFGbPnBjOLmq~fF_mSw' };

describe('the arguments that open a search result', () => {
  it('are its url and its own pair, so two results at one url open two articles', () => {
    expect(articleArgs(USE_LAPS, undefined)).toEqual(USE_LAPS);
    expect(articleArgs(USING_LAPS_IN_THE_API, undefined)).toEqual(USING_LAPS_IN_THE_API);
  });

  it('keep the pair when the host asks in the result\'s own language', () => {
    expect(articleArgs(USE_LAPS, 'en-US')).toEqual(USE_LAPS);
    // A ja-JP result, with its url in the legacy `/{locale}/bundle/…` form.
    const criteriaOperators = {
      url: 'https://learn.jamf.com/ja-JP/bundle/jamf-pro-documentation-current/page/Criteria_Operators.html',
      mapId: 'GE9~jUeMhje7axrw1dW5VA',
      contentId: 'iiWir~uadvuuCsjbeuvdEA',
    };
    expect(articleArgs(criteriaOperators, 'ja-JP')).toEqual(criteriaOperators);
    expect(articleArgs(criteriaOperators, 'en-US')).toEqual({ url: criteriaOperators.url });
  });

  it('are the url alone when the host asks in another language, which a pair would ignore', () => {
    // The url with `language` opens the page in the host's language; a pair
    // names a topic of one map, in one language.
    expect(articleArgs(USE_LAPS, 'ja-JP')).toEqual({ url: USE_LAPS.url });
    // A url whose language cannot be read is not assumed to be the host's.
    expect(articleArgs({ ...USE_LAPS, url: 'https://learn.jamf.com/r/technical-paper-laps-current' }, 'en-US'))
      .toEqual({ url: 'https://learn.jamf.com/r/technical-paper-laps-current' });
  });

  it('are the url alone without a whole pair the tool accepts, as they always were', () => {
    const { url } = USE_LAPS;
    expect(articleArgs({ url }, undefined)).toEqual({ url });
    expect(articleArgs({ url, mapId: USE_LAPS.mapId }, undefined)).toEqual({ url });
    expect(articleArgs({ url, contentId: USE_LAPS.contentId }, undefined)).toEqual({ url });
    // What the input schema would reject fails the call, so it is not sent.
    for (const bad of ['', 'has space', 'a/b', 'x'.repeat(201)]) {
      expect(articleArgs({ url, mapId: bad, contentId: USE_LAPS.contentId }, undefined)).toEqual({ url });
      expect(articleArgs({ url, mapId: USE_LAPS.mapId, contentId: bad }, undefined)).toEqual({ url });
    }
  });
});

describe('the attributes that carry the pair to the click', () => {
  it('are both ids, as data attributes', () => {
    expect(hitIdAttributes(USE_LAPS)).toBe(
      ' data-map-id="1ZN5bkFvUa6baRoUXR6Zog" data-content-id="cS8N6f3zVb5pvf0xGCi_ug"',
    );
  });

  it('are nothing without a whole pair of well-formed ids, whatever the payload holds', () => {
    // The payload is cast, not validated: see classify in app.ts.
    for (const hit of [{}, { mapId: USE_LAPS.mapId }, { mapId: 7, contentId: null }, { mapId: '"><x', contentId: 'y' }]) {
      expect(hitIdAttributes(hit)).toBe('');
    }
  });
});

/** An identifier from the bundle, escaped for a RegExp. */
function literal(identifier: string): string {
  return identifier.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

describe('the built bundle', () => {
  it('puts the pair on each search result it renders', () => {
    // esbuild renames identifiers but keeps property names and string
    // literals, so both are recognisable in the compiled output.
    const hit = /data-url="\$\{[\w$]+\(([\w$]+)\.url\)\}"\$\{([\w$]+)\(\1\)\}>\s*\$\{[\w$]+\(\1\.breadcrumb,"hit-path"/
      .exec(APP_HTML);
    expect(hit).not.toBeNull();
    expect(APP_HTML).toMatch(new RegExp(
      `function ${literal(hit?.[2] ?? '')}\\(([\\w$]+)\\)\\{let\\{mapId:([\\w$]+),contentId:([\\w$]+)\\}=\\1;` +
      'return [\\w$]+\\(\\2\\)&&[\\w$]+\\(\\3\\)\\?` data-map-id="',
    ));
  });

  it('opens a result with the arguments articleArgs builds from what the click carries', () => {
    // Before 2026-09-28 this was `("jamf_docs_get_article",{url:r},!0,…)`.
    // The host's language follows them, which `call` used to add to every
    // call: see app-view-language.test.ts.
    const click = /let\{url:([\w$]+),mapId:([\w$]+),contentId:([\w$]+)\}=[\w$]+\.dataset;/.exec(APP_HTML);
    expect(click).not.toBeNull();
    const url = literal(click?.[1] ?? '');
    const mapId = literal(click?.[2] ?? '');
    const contentId = literal(click?.[3] ?? '');
    const call = new RegExp(
      `"jamf_docs_get_article",\\{\\.\\.\\.([\\w$]+)\\(\\{url:${url},mapId:${mapId},contentId:${contentId}\\},` +
      '([\\w$]+)\\.language\\),\\.\\.\\.\\2\\},!0,',
    ).exec(APP_HTML);
    expect(call).not.toBeNull();
    expect(APP_HTML).toMatch(new RegExp(
      `function ${literal(call?.[1] ?? '')}\\([\\w$]+,[\\w$]+\\)\\{let\\{url:([\\w$]+),mapId:([\\w$]+),contentId:([\\w$]+)\\}=[\\w$]+;` +
      'return.*?\\?\\{url:\\1\\}:\\{url:\\1,mapId:\\2,contentId:\\3\\}\\}',
    ));
    expect(APP_HTML).not.toMatch(/"jamf_docs_get_article",\{url:[\w$]+\}/);
  });
});
