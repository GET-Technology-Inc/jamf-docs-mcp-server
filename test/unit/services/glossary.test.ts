/**
 * Unit tests for glossary service: parseGlossaryEntries and searchGlossaryEntries
 */

import { describe, it, expect } from 'vitest';
import { parseGlossaryEntries, searchGlossaryEntries } from '../../../src/core/services/glossary.js';

// ============================================================================
// parseGlossaryEntries
// ============================================================================

describe('parseGlossaryEntries', () => {
  const sourceUrl = 'https://learn.jamf.com/en-US/bundle/jamf-technical-glossary/page/Glossary.html';
  const product = 'jamf-pro';

  describe('DITA glossentry format', () => {
    it('should parse h1.glossterm + .glossdef', () => {
      const html = `
        <html><body>
          <main role="main">
            <article class="dita" role="article">
              <h1 class="title glossterm topictitle1">
                <span class="ph">User Approved MDM</span>
              </h1>
              <div class="abstract glossdef">
                <p class="p">A macOS security feature that requires explicit user consent before allowing an MDM solution to manage certain system settings.</p>
              </div>
            </article>
          </main>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('User Approved MDM');
      expect(entries[0].definition).toContain('macOS security feature');
      expect(entries[0].definition).toContain('user consent');
      expect(entries[0].url).toBe(sourceUrl);
      expect(entries[0].product).toBe(product);
    });

    it('should handle glossterm without .glossdef by using article body', () => {
      const html = `
        <html><body>
          <article>
            <h1 class="glossterm">Smart Group</h1>
            <p>A dynamic group based on criteria.</p>
          </article>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('Smart Group');
      expect(entries[0].definition).toContain('dynamic group');
    });
  });

  describe('the shape Jamf\'s /content serves', () => {
    it('returns nothing, leaving the lookup to name the entry from its TOC title', () => {
      // All 123 live topics, 2026-09-24: the definition alone, with no
      // glossterm heading, no h1 and no article. None of the formats above
      // applies, and a parser that did answer here would have to invent the
      // term's name.
      const html = '<div class="content-locale-en-US content-locale-en"><div id="glossentry-6081">' +
        '<div class="abstract glossdef"><p class="p">A security framework that dynamically creates ' +
        'secure, isolated connections.</p></div></div></div>';

      expect(parseGlossaryEntries(html, sourceUrl)).toEqual([]);
    });
  });

  describe('dl/dt/dd format', () => {
    it('should parse basic definition list', () => {
      const html = `
        <html><body>
          <dl>
            <dt>MDM</dt>
            <dd>Mobile Device Management is a protocol for managing Apple devices.</dd>
            <dt>DEP</dt>
            <dd>Device Enrollment Program allows zero-touch deployment.</dd>
          </dl>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(2);
      expect(entries[0].term).toBe('MDM');
      expect(entries[0].definition).toContain('Mobile Device Management');
      expect(entries[1].term).toBe('DEP');
      expect(entries[1].definition).toContain('Device Enrollment Program');
    });

    it('should handle multiple dd elements per dt', () => {
      const html = `
        <html><body>
          <dl>
            <dt>Configuration Profile</dt>
            <dd>An XML file that defines device settings.</dd>
            <dd>Can be deployed via MDM or manually installed.</dd>
          </dl>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('Configuration Profile');
      expect(entries[0].definition).toContain('XML file');
      expect(entries[0].definition).toContain('deployed via MDM');
    });

    it('should skip empty dt elements', () => {
      const html = `
        <html><body>
          <dl>
            <dt></dt>
            <dd>Should be skipped</dd>
            <dt>Valid Term</dt>
            <dd>Valid definition</dd>
          </dl>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('Valid Term');
    });
  });

  describe('heading + paragraph format', () => {
    it('should parse h2 headings with following paragraphs', () => {
      const html = `
        <html><body>
          <article>
            <h2>Smart Group</h2>
            <p>A dynamic group of devices that meet specified criteria.</p>
            <h2>Static Group</h2>
            <p>A manually curated list of devices.</p>
          </article>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(2);
      expect(entries[0].term).toBe('Smart Group');
      expect(entries[0].definition).toContain('dynamic group');
      expect(entries[1].term).toBe('Static Group');
      expect(entries[1].definition).toContain('manually curated');
    });
  });

  describe('fallback format', () => {
    it('should use h1 as term name when no glossterm/dl/headings found', () => {
      const html = `
        <html><body>
          <h1>Automated Device Enrollment</h1>
          <article>
            <p>This feature allows organizations to automatically enroll devices.</p>
          </article>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl, product);

      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('Automated Device Enrollment');
      expect(entries[0].definition).toContain('automatically enroll');
    });

    it('should return empty array when no content at all', () => {
      const html = '<html><body></body></html>';

      const entries = parseGlossaryEntries(html, sourceUrl);

      expect(entries).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should strip script and style elements', () => {
      const html = `
        <html><body>
          <script>alert('xss')</script>
          <style>.hidden { display: none; }</style>
          <dl>
            <dt>Clean Term</dt>
            <dd>Clean definition</dd>
          </dl>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl);

      expect(entries).toHaveLength(1);
      expect(entries[0].definition).not.toContain('alert');
    });

    it('should work without product parameter', () => {
      const html = `
        <html><body>
          <article>
            <h1 class="glossterm">Test Term</h1>
            <div class="glossdef"><p>Test definition</p></div>
          </article>
        </body></html>
      `;

      const entries = parseGlossaryEntries(html, sourceUrl);

      expect(entries[0].product).toBeUndefined();
    });
  });
});

// ============================================================================
// searchGlossaryEntries (fuse.js fuzzy matching)
// ============================================================================

describe('searchGlossaryEntries', () => {
  const entries = [
    { term: 'Mobile Device Management', definition: 'MDM protocol for managing devices.', url: 'https://example.com/mdm' },
    { term: 'Configuration Profile', definition: 'XML payload for device settings.', url: 'https://example.com/cp' },
    { term: 'Smart Group', definition: 'Dynamic group based on criteria.', url: 'https://example.com/sg' },
    { term: 'Static Group', definition: 'Manual group of devices.', url: 'https://example.com/stg' },
    { term: 'Device Enrollment Program', definition: 'Zero-touch deployment.', url: 'https://example.com/dep' },
  ];

  it('should return exact matches', () => {
    const results = searchGlossaryEntries(entries, 'Smart Group');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].term).toBe('Smart Group');
  });

  it('should return fuzzy matches for partial input', () => {
    const results = searchGlossaryEntries(entries, 'config prof');

    expect(results.length).toBeGreaterThan(0);
    const terms = results.map(r => r.term);
    expect(terms).toContain('Configuration Profile');
  });

  it('should return multiple matches for ambiguous term', () => {
    const results = searchGlossaryEntries(entries, 'Group');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const terms = results.map(r => r.term);
    expect(terms).toContain('Smart Group');
    expect(terms).toContain('Static Group');
  });

  it('should return nothing when fuse finds no match and no entry shares a word', () => {
    // Until 2026-09-24 this returned every entry, which the lookup reported as
    // matches: `group` answered with `property list (PLIST)` and `resource
    // owner password credentials (ROPC)`, which its own fuzzy pass rejected.
    const results = searchGlossaryEntries(entries, 'xyznonexistent');

    expect(results).toEqual([]);
  });

  it('should keep only entries sharing a word with the query when fuse finds no match', () => {
    // A whole word (`device`, `enrollment`), the start of one (`config`,
    // `prof`), or one swapped letter away (`deamon`). Fuse at 0.3 finds
    // nothing for any of these three queries, so each reaches the fallback.
    const candidates = [
      ...entries,
      { term: 'daemon', definition: 'A background process.', url: 'https://example.com/daemon' },
    ];

    expect(searchGlossaryEntries(candidates, 'automated device enrollment').map(r => r.term))
      .toEqual(['Mobile Device Management', 'Device Enrollment Program']);
    expect(searchGlossaryEntries(candidates, 'config prof').map(r => r.term))
      .toEqual(['Configuration Profile']);
    expect(searchGlossaryEntries(candidates, 'deamon').map(r => r.term))
      .toEqual(['daemon']);
  });

  it('should return empty array for empty entries', () => {
    const results = searchGlossaryEntries([], 'MDM');

    expect(results).toHaveLength(0);
  });

  it('should be case-insensitive', () => {
    const results = searchGlossaryEntries(entries, 'smart group');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].term).toBe('Smart Group');
  });

  it('should also match against definition text', () => {
    const results = searchGlossaryEntries(entries, 'zero-touch');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].term).toBe('Device Enrollment Program');
  });

  it('should not return loosely matching acronyms (MDM should not match DMG)', () => {
    const entriesWithDMG = [
      ...entries,
      {
        term: 'disk image (DMG)',
        definition: 'Apple disk image format.',
        url: 'https://example.com/dmg',
      },
    ];
    const results = searchGlossaryEntries(entriesWithDMG, 'MDM');

    const terms = results.map(r => r.term);
    expect(terms).not.toContain('disk image (DMG)');
  });

  it('should rank exact term match above partial matches', () => {
    const results = searchGlossaryEntries(entries, 'MDM');

    // "Mobile Device Management" contains MDM in definition and is the canonical match
    expect(results[0].term).toBe('Mobile Device Management');
  });
});
