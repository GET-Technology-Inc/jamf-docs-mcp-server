/**
 * Types for release-content-gate.mjs, so the gate can be unit-tested.
 * check-pr-title.d.mts says why the scripts carry declarations rather than
 * test/tsconfig.json setting allowJs.
 */

export declare const CONSUMER_SCRIPTS: Set<string>;

export declare function isIgnored(file: string): boolean;

export declare function consumerManifest(
  pkg: Record<string, unknown>,
): Record<string, unknown>;

export declare function manifestChanges(
  head: Record<string, unknown>,
  previous: Record<string, unknown>,
): string[];

export interface PackageDiff {
  counted: string[];
  ignored: string[];
  previousVersion: string;
}

export declare function diffPackages(head: string, previous: string): PackageDiff;

export declare function summarize(diff: PackageDiff, limit?: number): string;
