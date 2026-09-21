/**
 * Types for check-pr-title.mjs, so the guard can be unit-tested.
 *
 * test/tsconfig.json does not set allowJs, and the CI scripts are plain .mjs
 * by convention here; this declaration is what lets test/**\/*.ts import the
 * pure functions without widening that setting for every script in the folder.
 */

export declare const LEVEL: {
  none: 0;
  patch: 1;
  minor: 2;
  major: 3;
};

export type ReleaseRules = Record<string, string>;

export declare function loadReleaseRules(root?: string): ReleaseRules;

export declare function parseHeader(
  header: string,
): { type: string; breaking: boolean } | null;

export declare function levelOf(message: string, rules: ReleaseRules): number;

export declare function checkPrTitle(input: {
  title: string;
  commits: string[];
  rules: ReleaseRules;
}): {
  ok: boolean;
  titleLevel: number;
  commitLevel: number;
  strongest: string | null;
  reason: string;
};
