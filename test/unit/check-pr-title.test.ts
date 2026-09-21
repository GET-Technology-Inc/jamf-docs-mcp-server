/**
 * Tests for the guard that stops a PR title from discarding a release.
 *
 * The incident it encodes: PR #296 carried sixteen commits including a `feat`,
 * was squash-merged under a title starting `chore:`, and semantic-release
 * reported "Analysis of 1 commits complete: no release". A squash keeps only
 * the title, so every typed message inside the PR was thrown away. Nothing was
 * published and CI was green throughout.
 */

import { describe, it, expect } from 'vitest';
import {
  LEVEL,
  levelOf,
  parseHeader,
  checkPrTitle,
  loadReleaseRules,
} from '../../scripts/check-pr-title.mjs';

const rules = loadReleaseRules();

describe('the rules come from .releaserc.json, not a second copy', () => {
  it('reads the types the release config actually declares', () => {
    // If these drift, the guard goes quietly permissive — the same class of
    // failure it exists to catch.
    expect(rules).toMatchObject({ feat: 'minor', fix: 'patch' });
  });

  it('does not invent a rule for chore, which is why #296 released nothing', () => {
    expect(rules.chore).toBeUndefined();
    expect(levelOf('chore: tidy up', rules)).toBe(LEVEL.none);
  });
});

describe('parseHeader', () => {
  it.each([
    ['feat: add a thing', 'feat', false],
    ['fix(url): name every host', 'fix', false],
    ['feat(api)!: drop a field', 'feat', true],
    ['refactor: move code', 'refactor', false],
  ])('parses %s', (header, type, breaking) => {
    expect(parseHeader(header)).toEqual({ type, breaking });
  });

  it.each([
    'no type here',
    'Feat: capitalised',
    'feat:missing space',
    '',
  ])('returns null for %p', header => {
    expect(parseHeader(header)).toBeNull();
  });
});

describe('levelOf', () => {
  it('maps each configured type to its release', () => {
    expect(levelOf('feat: x', rules)).toBe(LEVEL.minor);
    expect(levelOf('fix: x', rules)).toBe(LEVEL.patch);
    expect(levelOf('refactor: x', rules)).toBe(LEVEL.patch);
  });

  it('gives docs, test, ci and chore no release', () => {
    for (const type of ['docs', 'test', 'ci', 'chore']) {
      expect(levelOf(`${type}: x`, rules)).toBe(LEVEL.none);
    }
  });

  it('treats a ! marker as major whatever the type', () => {
    expect(levelOf('fix!: x', rules)).toBe(LEVEL.major);
    expect(levelOf('chore!: x', rules)).toBe(LEVEL.major);
  });

  it('treats a BREAKING CHANGE footer as major', () => {
    expect(levelOf('fix: x\n\nBREAKING CHANGE: gone', rules)).toBe(LEVEL.major);
    expect(levelOf('fix: x\n\nBREAKING-CHANGE: gone', rules)).toBe(LEVEL.major);
  });

  it('reads only the first line for the type', () => {
    // A body mentioning another type must not change the verdict.
    expect(levelOf('docs: x\n\nthis touches feat: things', rules)).toBe(LEVEL.none);
  });
});

describe('checkPrTitle', () => {
  it('reproduces #296: a feat inside, chore on the tin', () => {
    const result = checkPrTitle({
      title: 'chore: cruft audit cleanup, two CI/test defects, and the request settings made real',
      commits: [
        'fix(ci): close the paths-filter gap',
        'feat(config): make the five request settings real',
        'docs: reunite six JSDoc blocks',
      ],
      rules,
    });

    expect(result.ok).toBe(false);
    expect(result.commitLevel).toBe(LEVEL.minor);
    expect(result.titleLevel).toBe(LEVEL.none);
    expect(result.strongest).toBe('feat(config): make the five request settings real');
    expect(result.reason).toContain('would be lost silently');
  });

  it('passes when the title matches the strongest commit', () => {
    const result = checkPrTitle({
      title: 'feat(config): make the five request settings real',
      commits: ['fix: a', 'feat: b', 'docs: c'],
      rules,
    });
    expect(result.ok).toBe(true);
  });

  it('passes when the title is stronger than the commits', () => {
    // Over-titling loses nothing; it only releases more than strictly needed.
    const result = checkPrTitle({
      title: 'feat: a bigger claim',
      commits: ['fix: a'],
      rules,
    });
    expect(result.ok).toBe(true);
  });

  it('fails a patch title over a feat commit', () => {
    const result = checkPrTitle({
      title: 'fix: small',
      commits: ['feat: big'],
      rules,
    });
    expect(result.ok).toBe(false);
    expect(result.titleLevel).toBe(LEVEL.patch);
    expect(result.commitLevel).toBe(LEVEL.minor);
  });

  it('fails a non-breaking title over a breaking commit', () => {
    const result = checkPrTitle({
      title: 'feat: add',
      commits: ['feat!: remove an export'],
      rules,
    });
    expect(result.ok).toBe(false);
    expect(result.commitLevel).toBe(LEVEL.major);
  });

  it('allows a genuinely release-free PR', () => {
    // The rule is not "every PR must release" — a docs-only PR releasing
    // nothing is correct, and must not be made to lie about itself.
    const result = checkPrTitle({
      title: 'docs: fix a typo',
      commits: ['docs: fix a typo', 'chore: tidy'],
      rules,
    });
    expect(result.ok).toBe(true);
  });

  it('fails an untyped title over a releasable commit', () => {
    const result = checkPrTitle({
      title: 'Update the search service',
      commits: ['fix: something real'],
      rules,
    });
    expect(result.ok).toBe(false);
    expect(result.titleLevel).toBe(LEVEL.none);
  });

  it('names the offending commit so the message is actionable', () => {
    const result = checkPrTitle({
      title: 'chore: x',
      commits: ['feat(search): the one that matters'],
      rules,
    });
    expect(result.reason).toContain('feat(search): the one that matters');
    expect(result.reason).toContain('chore: x');
  });

  it('handles a PR with no commits', () => {
    expect(checkPrTitle({ title: 'chore: x', commits: [], rules }).ok).toBe(true);
  });
});
