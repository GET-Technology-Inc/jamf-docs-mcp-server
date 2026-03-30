/**
 * Fixture capture script — fetches real Zoomin API responses and saves as JSON fixtures.
 *
 * Usage: node --experimental-strip-types test/fixtures/capture.ts
 */

import { httpGetJson, httpGetText, HttpError } from '../../src/core/http-client.js';
import * as fs from 'fs';
import * as path from 'path';

const DOCS_API_URL = 'https://learn-be.jamf.com';
const FIXTURES_DIR = path.dirname(new URL(import.meta.url).pathname);

interface CapturedFixture {
  name: string;
  path: string;
  size: number;
}

interface ZoominResult {
  leading_result?: {
    title: string;
    url: string;
    snippet: string;
    bundle_id: string;
    page_id: string;
    publication_title: string;
    score?: number;
    labels?: { key: string; navtitle: string }[];
  } | null;
}

interface ZoominResponse {
  status: string;
  Results: ZoominResult[];
}

async function writeFixture(name: string, data: unknown): Promise<CapturedFixture> {
  const filePath = path.join(FIXTURES_DIR, name);
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, json, 'utf-8');
  const size = Buffer.byteLength(json, 'utf-8');
  return { name, path: filePath, size };
}

async function captureSearchResponse(): Promise<{ fixture: CapturedFixture; data: ZoominResponse }> {
  console.error('[capture] Fetching search response for "jamf pro"...');
  const url = `${DOCS_API_URL}/api/search?q=jamf+pro&rpp=50`;
  const data = await httpGetJson<ZoominResponse>(url, {
    timeout: 30000,
    headers: { Accept: 'application/json' },
  });
  const fixture = await writeFixture('search-response.json', data);
  return { fixture, data };
}

async function captureArticleHtml(searchData: ZoominResponse): Promise<CapturedFixture> {
  // Discover a valid article URL from search results (pick a documentation article, not release notes)
  const docResult = searchData.Results.find(
    (r) => r.leading_result && r.leading_result.bundle_id.includes('-documentation')
  );
  const articleUrl = docResult?.leading_result?.url ?? searchData.Results[0]?.leading_result?.url;

  if (!articleUrl) {
    throw new Error('No valid article URL found in search results');
  }

  console.error(`[capture] Fetching article HTML from ${articleUrl}...`);
  const html = await httpGetText(articleUrl, {
    timeout: 30000,
    headers: { Accept: 'text/html' },
  });
  return writeFixture('article-html.json', {
    url: articleUrl,
    html,
  });
}

async function captureTocResponse(searchData: ZoominResponse): Promise<CapturedFixture[]> {
  const fixtures: CapturedFixture[] = [];

  // Discover the actual versioned bundle ID from search results
  const docResult = searchData.Results.find(
    (r) => r.leading_result && r.leading_result.bundle_id.startsWith('jamf-pro-documentation')
  );
  const proBundleId = docResult?.leading_result?.bundle_id ?? 'jamf-pro-documentation';

  // Products to capture: one with content, one likely empty
  const bundles = [proBundleId, 'jamf-routines-documentation'];

  for (const bundleId of bundles) {
    const tocUrl = `${DOCS_API_URL}/bundle/${bundleId}/toc`;
    console.error(`[capture] Fetching TOC for ${bundleId}...`);
    try {
      const data = await httpGetJson(tocUrl, {
        timeout: 30000,
        headers: { Accept: 'application/json' },
      });
      const fixture = await writeFixture(`toc-${bundleId}.json`, data);
      fixtures.push(fixture);
    } catch (error) {
      if (error instanceof HttpError) {
        console.error(`[capture] TOC fetch failed for ${bundleId}: ${error.message}`);
        const fixture = await writeFixture(`toc-${bundleId}.json`, {
          error: true,
          status: error.status,
          message: error.message,
        });
        fixtures.push(fixture);
      }
    }
  }

  return fixtures;
}

async function main(): Promise<void> {
  console.error('=== Fixture Capture Script ===\n');

  const captured: CapturedFixture[] = [];

  try {
    const { fixture: searchFixture, data: searchData } = await captureSearchResponse();
    captured.push(searchFixture);

    const article = await captureArticleHtml(searchData);
    captured.push(article);

    const toc = await captureTocResponse(searchData);
    captured.push(...toc);
  } catch (error) {
    console.error('[capture] Fatal error:', error);
    process.exit(1);
  }

  console.error('\n=== Captured Fixtures ===');
  for (const fixture of captured) {
    const sizeKb = (fixture.size / 1024).toFixed(1);
    console.error(`  ${fixture.name}: ${sizeKb} KB`);
  }
  console.error(`\nTotal: ${captured.length} fixture(s) captured.`);
}

main();
