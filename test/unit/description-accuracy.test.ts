/**
 * Guard tests: every number and every ID list quoted in a description must
 * agree with the schema that description describes.
 *
 * Background (issue #199): the server instructions promised
 * "maxTokens ... max: 20000" while MaxTokensSchema accepted 50000, and named
 * four product IDs while `z.enum(PRODUCT_IDS)` accepted all twelve — so a
 * client reading the description never tried `jamf-routines` or `jamf-trust`
 * even though passing them works. `jamf_docs_list_products` repeated the same
 * 20000 claim.
 *
 * These tests read the descriptions the way a client does — off `tools/list`,
 * `prompts/list` and the `initialize` instructions — and compare the prose back
 * to the constants the schemas are built from, so the two cannot drift again
 * the next time a bound changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../src/core/create-server.js';
import { createMockContext } from '../helpers/mock-context.js';
import {
  PRODUCT_IDS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  CONTENT_LIMITS,
} from '../../src/core/constants.js';

// ---------------------------------------------------------------------------
// Corpus: every description string the server publishes
// ---------------------------------------------------------------------------

interface DescribedText {
  /** Human-readable origin, used in assertion messages */
  where: string;
  /** The schema field this text describes, when it describes one */
  param?: string;
  text: string;
}

const corpus: DescribedText[] = [];
let instructions = '';

interface JsonSchemaObject {
  properties?: Record<string, { description?: unknown } | undefined>;
}

beforeAll(async () => {
  const server = createMcpServer(createMockContext());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'description-accuracy-test', version: '0.0.1' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  instructions = client.getInstructions() ?? '';
  corpus.push({ where: 'server instructions', text: instructions });

  const { tools } = await client.listTools();
  for (const tool of tools) {
    if (typeof tool.description === 'string') {
      corpus.push({ where: `tool ${tool.name} description`, text: tool.description });
    }
    const properties = (tool.inputSchema as JsonSchemaObject).properties ?? {};
    for (const [param, schema] of Object.entries(properties)) {
      const description = schema?.description;
      if (typeof description === 'string') {
        corpus.push({ where: `tool ${tool.name} arg "${param}"`, param, text: description });
      }
    }
  }

  const { prompts } = await client.listPrompts();
  for (const prompt of prompts) {
    for (const argument of prompt.arguments ?? []) {
      if (typeof argument.description === 'string') {
        corpus.push({
          where: `prompt ${prompt.name} arg "${argument.name}"`,
          param: argument.name,
          text: argument.description,
        });
      }
    }
  }

  await client.close();
});

afterAll(() => {
  corpus.length = 0;
});

// ---------------------------------------------------------------------------
// Product ID lists
// ---------------------------------------------------------------------------

/**
 * Longest ID first: `jamf-pro` is a prefix of `jamf-protect`, and a plain
 * alternation would match the prefix and read the rest as trailing text.
 */
const PRODUCT_ALTERNATION = [...PRODUCT_IDS]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Two or more product IDs separated by commas — an enumeration, not an example. */
const PRODUCT_ID_RUN = new RegExp(
  `(?:${PRODUCT_ALTERNATION})(?![\\w-])(?:,\\s*(?:${PRODUCT_ALTERNATION})(?![\\w-]))+`
);

function mentionsProduct(text: string, id: string): boolean {
  return new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text);
}

describe('description accuracy: product lists', () => {
  it('at least one description enumerates product IDs', () => {
    // Without this the enumeration test below would pass vacuously if the
    // lists were dropped from the descriptions altogether.
    const enumerating = corpus.filter(entry => PRODUCT_ID_RUN.test(entry.text));
    expect(enumerating.length).toBeGreaterThan(0);
  });

  it('every description that enumerates product IDs names the whole enum', () => {
    for (const entry of corpus) {
      if (!PRODUCT_ID_RUN.test(entry.text)) {
        continue;
      }
      for (const id of PRODUCT_IDS) {
        expect(
          mentionsProduct(entry.text, id),
          `${entry.where} enumerates product IDs but omits "${id}", which z.enum(PRODUCT_IDS) accepts`
        ).toBe(true);
      }
    }
  });
});

// The mirror-image drift — prose naming an ID the enum no longer has — is
// covered for the search tool by search-examples.test.ts and for topics by
// constants/topics.test.ts. It is not repeated here: product IDs also appear
// inside bundle IDs in example URLs (`jamf-pro-documentation`), so scanning
// free prose for them produces false positives.

// ---------------------------------------------------------------------------
// Numeric bounds
// ---------------------------------------------------------------------------

interface NumericClaim {
  /** The range the schema enforces, formatted the way descriptions write it */
  range: string;
  default: number;
}

const NUMERIC_CLAIMS: Record<string, NumericClaim | undefined> = {
  maxTokens: {
    range: `${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}`,
    default: TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
  },
  page: {
    range: `1-${PAGINATION_CONFIG.MAX_PAGE}`,
    default: PAGINATION_CONFIG.DEFAULT_PAGE,
  },
  limit: {
    range: `1-${CONTENT_LIMITS.MAX_SEARCH_RESULTS}`,
    default: CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS,
  },
};

/** Counts every claim actually checked, so the tests cannot pass vacuously. */
let claimsChecked = 0;

function checkNumericClaims(where: string, param: string, text: string): void {
  const claim = NUMERIC_CLAIMS[param];
  if (claim === undefined) {
    return;
  }
  for (const match of text.matchAll(/\d+-\d+/g)) {
    claimsChecked += 1;
    expect(
      match[0],
      `${where} quotes the range "${match[0]}"; the schema enforces ${claim.range}`
    ).toBe(claim.range);
  }
  for (const match of text.matchAll(/default:\s*(\d+)/g)) {
    claimsChecked += 1;
    expect(
      Number(match[1]),
      `${where} quotes a default of ${match[1]}; the schema defaults to ${claim.default}`
    ).toBe(claim.default);
  }
}

/**
 * Tool descriptions document their arguments as an "Args:" list of
 * `  - name (type, optional): prose` bullets. Matching on the declaration
 * rather than on a bare mention of the name keeps `limit` off the line that
 * reads "Maximum results per page", which mentions `page` too.
 */
const ARG_BULLET = /^\s*-\s*(\w+)\s*\(/;

describe('description accuracy: numeric bounds', () => {
  it('every range and default quoted for an argument matches its schema', () => {
    for (const entry of corpus) {
      if (entry.param !== undefined) {
        // A schema `.describe()` string: the whole text is about that param.
        checkNumericClaims(entry.where, entry.param, entry.text);
        continue;
      }
      for (const line of entry.text.split('\n')) {
        const declared = ARG_BULLET.exec(line);
        if (declared === null) {
          continue;
        }
        checkNumericClaims(`${entry.where} line "${line.trim()}"`, declared[1], line);
      }
    }
    expect(claimsChecked, 'no numeric claims were found to check').toBeGreaterThan(0);
  });

  it('the server instructions quote the real maxTokens bounds', () => {
    // The instructions are prose, not an argument list, so they are matched by
    // the parameter they name rather than by a bullet declaration.
    const lines = instructions.split('\n').filter(line => line.includes('maxTokens'));
    expect(lines.length, 'instructions should mention maxTokens').toBeGreaterThan(0);

    for (const line of lines) {
      for (const match of line.matchAll(/max:\s*(\d+)/g)) {
        expect(
          Number(match[1]),
          `instructions promise max: ${match[1]}; the schema allows ${TOKEN_CONFIG.MAX_TOKENS_LIMIT}`
        ).toBe(TOKEN_CONFIG.MAX_TOKENS_LIMIT);
      }
      for (const match of line.matchAll(/default:\s*(\d+)/g)) {
        expect(
          Number(match[1]),
          `instructions promise default: ${match[1]}; the schema defaults to ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS}`
        ).toBe(TOKEN_CONFIG.DEFAULT_MAX_TOKENS);
      }
    }
  });

  it('every maxTokens value used in an example is within the schema bounds', () => {
    for (const entry of corpus) {
      for (const match of entry.text.matchAll(/maxTokens\s*=\s*(\d+)/g)) {
        const value = Number(match[1]);
        expect(value, `${entry.where} uses maxTokens=${value}`).toBeGreaterThanOrEqual(
          TOKEN_CONFIG.MIN_TOKENS
        );
        expect(value, `${entry.where} uses maxTokens=${value}`).toBeLessThanOrEqual(
          TOKEN_CONFIG.MAX_TOKENS_LIMIT
        );
      }
    }
  });
});
