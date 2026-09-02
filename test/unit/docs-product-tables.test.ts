/**
 * Guard tests for the product tables in the READMEs.
 *
 * Both files list every product by ID, name and description, and nothing
 * checked them: they sat at 12 rows while the registry grew, and the only
 * signal would have been a reader noticing. Since `list_products` now answers
 * this at runtime, the tables are a convenience — but a wrong convenience is
 * worse than none, so they are pinned to the registry that generates them.
 *
 * The Chinese table intentionally checks IDs and names only. Its descriptions
 * are translations, not copies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JAMF_PRODUCTS, PRODUCT_IDS } from '../../src/core/constants/products.js';
import type { ProductId } from '../../src/core/constants/products.js';

const root = join(import.meta.dirname, '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf-8');
const readmeZh = readFileSync(join(root, 'docs', 'README.zh-TW.md'), 'utf-8');

/** Every `| \`id\` | Name | ... |` row of the first table after `heading`. */
function tableRows(markdown: string, heading: string): { id: string; name: string; rest: string }[] {
  const start = markdown.indexOf(heading);
  expect(start, `heading "${heading}" not found`).toBeGreaterThan(-1);
  // slice(start) begins AT the heading, so [0] is this section's own body.
  const section = markdown.slice(start).split('\n## ')[0];
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/gm)]
    .map(m => ({ id: m[1], name: m[2], rest: m[3] }));
}

describe('README.md product table', () => {
  const rows = tableRows(readme, '## Supported Products');

  it('lists every registered product exactly once, in registry order', () => {
    expect(rows.map(r => r.id)).toEqual([...PRODUCT_IDS]);
  });

  it('matches each product name and description', () => {
    for (const row of rows) {
      const product = JAMF_PRODUCTS[row.id as ProductId];
      expect(row.name, `name for ${row.id}`).toBe(product.name);
      expect(row.rest, `description for ${row.id}`).toBe(product.description);
    }
  });

  it('keeps the summary line in sync with the table', () => {
    const summary = /\*\*Supported Products\*\* \((\d+)\): (.+)/.exec(readme);
    expect(summary, 'the "Supported Products" summary line is missing').not.toBeNull();
    expect(Number(summary?.[1])).toBe(PRODUCT_IDS.length);
    expect(summary?.[2].split(', ')).toEqual(PRODUCT_IDS.map(id => JAMF_PRODUCTS[id as ProductId].name));
  });
});

describe('docs/README.zh-TW.md product table', () => {
  const rows = tableRows(readmeZh, '## 支援的產品');

  it('lists every registered product exactly once, in registry order', () => {
    expect(rows.map(r => r.id)).toEqual([...PRODUCT_IDS]);
  });

  // Names are proper nouns and stay untranslated; descriptions are translated
  // and so are not compared.
  it('matches each product name', () => {
    for (const row of rows) {
      expect(row.name, `name for ${row.id}`).toBe(JAMF_PRODUCTS[row.id as ProductId].name);
    }
  });
});
