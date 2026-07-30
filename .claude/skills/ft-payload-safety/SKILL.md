---
name: ft-payload-safety
description: Checks whether a field on a Fluid Topics payload type (FtTocNode, FtSearchTopic, FtSearchMap, FtMapInfo, FtTopicInfo) is safe to treat as present, and restores guards the compiler wrongly calls dead. Use this skill whenever you add, change, or read a field on any `Ft*` type in src/core/types.ts; whenever eslint or tsc reports no-unnecessary-condition, no-unnecessary-type-assertion, or "possibly undefined" on anything downstream of ft-client; whenever you are about to delete a null check, optional chain, or `&&` guard in src/core/services/; and whenever you are investigating a bug where a title, TOC entry, glossary term, or product name came out `undefined` or missing. Also use it when a lint sweep or refactor touches src/core/services/ broadly, since that is exactly how this class of bug shipped twice.
---

# Fluid Topics payload safety

## Why this exists

Every Fluid Topics shape enters through `httpGetJson<T>()` in
`src/core/services/ft-client.ts`, which is a bare cast over `response.json()`.
**No runtime validation runs on any of the four calls.** A field declared
`string` describes what Fluid Topics usually sends, not what it is obliged to
send.

That gap has produced a user-visible bug in two consecutive releases, both times
by the same mechanism: the type said a field was always present, so the compiler
called a guard against its absence dead code, and the guard was deleted.

- **4.0.0** — `FtTopicInfo.title` declared required. Guard deleted. Titleless
  payloads produced articles with `undefined` for a title.
- **4.0.1** — fixed that one, and in the same release deleted the equivalent
  guard on `FtTocNode.children`. Fluid Topics omits `children` on leaf nodes
  rather than sending `[]`, so one leaf node made *every* glossary lookup return
  zero results. Quietly, because `lookupGlossaryTerm` catches and returns an
  empty result.

The lesson is not "be careful with these files". It is that **a green compiler
proves nothing about a type that was asserted rather than checked.**

## When the linter says a guard is unnecessary

Work out where the type came from before believing it.

1. Trace the value back. Did it originate in `ft-client.ts`, or in something the
   cache round-tripped from there (`ctx.cache.get<FtTocNode[]>` counts)? If so,
   its declared shape is unverified.
2. Ask what the guard was protecting against. `if (node.children && ...)`
   protects against a key Fluid Topics genuinely omits. That is a fact about the
   API, not about the type.
3. If the guard is real, **the type is the bug.** Fix that.

Deleting the check to silence the rule is how both regressions shipped.

## Making a field honest

Mark it optional in `src/core/types.ts` and say why, pointing at the precedent:

```ts
export interface FtTocNode {
  /**
   * Optional for the same reason as {@link FtTopicInfo.title}: this shape is a
   * bare cast over `response.json()` with no runtime validation behind it.
   */
  title?: string;
  ...
}
```

Then run `npm run typecheck` and let the compiler enumerate every consumer. This
is the point of the exercise — it converts "somewhere in the codebase someone
trusts this field" into a finite list. When `metadata` was made optional it
surfaced five call sites, four of which were unguarded.

Handle each one. Do not reach for `!` or `?? {}` reflexively; decide what the
absence *means* at that site:

- **The value is the point of the record** → skip the record. A glossary term
  with no title is not a usable entry, so `fetchGlossaryToc` skips it. Skipping
  one entry beats throwing and losing the whole map.
- **There is a sensible display fallback** → use the one already in use
  elsewhere. Titleless search results and titleless TOC nodes both render as
  `'Untitled'`, so a missing field reads the same wherever it surfaces.
- **Absence is equivalent to empty** → normalise. A node with no `children` is a
  leaf, identical to one with `[]`.
- **Every read goes through a helper** → fix the helper instead of the callers.
  `getMetaValue` / `getMetaValues` in `src/core/utils/ft-metadata.ts` accept
  `undefined` and return their "key not found" defaults, which covers every
  metadata consumer in one place.

## Getting the emptiness check right

`exactOptionalPropertyTypes` and `strict-boolean-expressions` are both on, and
the interaction bites. The house pattern, set by the article path in
`article-service.ts`, is:

```ts
const title = (x !== undefined && x !== '') ? x : fallback;
```

Testing only `x !== ''` is the search-path bug: `undefined !== ''` is true, so
the fallback never fires and `undefined` flows onward into a field declared
`string`. Testing only `x !== undefined` silently accepts `''`.

Use the same shape on every path. Two rules for one missing field is how the
search path drifted from the article path for a whole release.

## Keeping a guard the compiler wants to delete

Sometimes the guard is right and the type genuinely cannot be loosened —
typically indexing an array whose length is not known statically. Prefer `.at()`:

```ts
const leaf = node.children.at(0);   // FtTocNode | undefined, whatever the flags say
if (leaf === undefined) { return; }
```

`.at()` yields `T | undefined` regardless of `noUncheckedIndexedAccess`, so the
guard stays alive and honest. `children?.[0]` does not, which is why a real
`if (!leaf)` check read as dead code in the integration tests.

## Prove it

A regression test that has never failed is not evidence. Revert the fix, run the
test, watch it go red, restore the fix:

```bash
npx vitest run test/unit/services/glossary-toc-guards.test.ts
```

Assert that the *other* records still resolve when one is malformed — that is
the behaviour these bugs destroyed. Asserting only "does not throw" would have
passed throughout the 4.0.1 regression, because the throw was already caught.

## Why not just validate with zod?

It was considered and rejected; the reasoning is recorded in the commit that
made `metadata` optional. Briefly: a naive `Schema.parse(json)` reintroduces the
exact failure this class of bug causes, because one malformed entry rejects the
whole response and loses the map. To be an improvement it has to be per-entry
and lenient — behaviourally what these guards already do — while adding
validation cost to a hot path (`/api/khub/maps` is ~2.7 MB).

If you revisit that decision, the bar is per-entry leniency, not `.parse()`.
