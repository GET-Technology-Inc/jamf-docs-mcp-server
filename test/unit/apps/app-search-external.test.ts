/**
 * A search result `jamf_docs_get_article` cannot read opens in a browser from
 * the MCP App, not through the tool.
 *
 * Since 2026-09-28 the search returns the Jamf Training Catalog courses that
 * Jamf's search ranks among the documentation, marked `external`. The App
 * opened every result with `jamf_docs_get_article`, which rejects a course's
 * url (trainingcatalog.jamf.com is not a host it reads), so a click on one
 * would have ended on an error. A course is now a link the host opens, as the
 * other-source matches are, and names its site where an article shows its
 * breadcrumb.
 *
 * Asserted against `opensOutside` and `renderExternalHit` themselves, which
 * live in `app-ui/search.ts` because importing app.ts throws outside a
 * browser, and then against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';

import { hitIdAttributes, opensOutside, renderExternalHit } from '../../../app-ui/search.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

/** A live course, as the search returns it (en-US "FileVault", 2026-09-28). */
const COURSE = {
  title: 'Administer FileVault with Jamf Pro',
  url: 'https://trainingcatalog.jamf.com/administer-filevault-with-jamf-pro',
  snippet: 'Enforce disk encryption and manage recovery keys with FileVault and Jamf Pro.',
  product: 'Jamf Pro',
  external: true,
};

describe('which results open outside', () => {
  it('a result marked external, and no other', () => {
    expect(opensOutside(COURSE)).toBe(true);
    // The payload is cast, not validated: see classify in app.ts.
    for (const hit of [{}, { external: false }, { external: 'true' }, { external: 1 }]) {
      expect(opensOutside(hit)).toBe(false);
    }
  });
});

describe('a result that opens outside, as the list shows it', () => {
  const html = renderExternalHit(COURSE, ['Jamf Pro']);

  it('is a link the host opens, not one the panel asks the tool for', () => {
    expect(html).toContain(`<a class="hit" href="${COURSE.url}" data-external>`);
    expect(html).not.toContain('data-url');
    expect(html).not.toContain('data-map-id');
  });

  it('with its title, snippet, and the site it goes to beside the meta', () => {
    expect(html).toContain(`<span class="hit-title">${COURSE.title}</span>`);
    expect(html).toContain(`<span class="hit-snippet">${COURSE.snippet}</span>`);
    expect(html).toContain('<span class="hit-meta">Jamf Pro · trainingcatalog.jamf.com ↗</span>');
  });

  it('escaped, whatever the payload holds', () => {
    const hostile = renderExternalHit({ title: '<b>x</b>', url: 'https://trainingcatalog.jamf.com/"><x', snippet: '<i>' }, []);

    expect(hostile).not.toContain('<b>');
    expect(hostile).not.toContain('"><x');
    expect(hostile).not.toContain('<i>');
    // Not a url, so no site is named.
    expect(renderExternalHit({ title: 't', url: 'not a url', snippet: 7 }, [])).not.toContain('hit-meta');
  });

  it('carries no pair, which an article result carries', () => {
    expect(hitIdAttributes({ mapId: 'a', contentId: 'b' })).not.toBe('');
    expect(html).not.toContain(hitIdAttributes({ mapId: 'a', contentId: 'b' }));
  });
});

/** An identifier from the bundle, escaped for a RegExp. */
function literal(identifier: string): string {
  return identifier.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

describe('the built bundle', () => {
  it('renders a result that opens outside with renderExternalHit, and any other as before', () => {
    // esbuild renames identifiers but keeps property names and string
    // literals, so both are recognisable in the compiled output.
    const branch = /return ([\w$]+)\(([\w$]+)\)\?([\w$]+)\(\2,[\w$]+\):`\s*<li><a class="hit" href="\$\{[\w$]+\(\2\.url\)\}" data-url=/
      .exec(APP_HTML);
    expect(branch).not.toBeNull();
    expect(APP_HTML).toMatch(new RegExp(`function ${literal(branch?.[1] ?? '')}\\(([\\w$]+)\\)\\{return \\1\\.external===!0\\}`));
    expect(APP_HTML).toMatch(new RegExp(
      `function ${literal(branch?.[3] ?? '')}\\(([\\w$]+),[\\w$]+\\)\\{let [^;]*;` +
      'return`\\s*<li><a class="hit" href="\\$\\{[\\w$]+\\(\\1\\.url\\)\\}" data-external>',
    ));
  });
});
