/**
 * Styles for the Jamf documentation MCP App.
 *
 * Kept as a TS string so the whole app bundles into one self-contained file —
 * the host renders `ui://` resources in a sandboxed iframe with a
 * deny-by-default CSP, so an external stylesheet would simply not load.
 *
 * Three rules hold this sheet together. They are what separate a panel that
 * reads as part of the conversation from one that reads as an embedded web
 * page, and every declaration below is downstream of them.
 *
 * 1. **The app paints no background.** `html`, `body` and every view container
 *    are transparent, so the panel sits on the host's own canvas. The only
 *    fills in the file are interaction tints, code, skeletons and in-prose
 *    callouts.
 *
 * 2. **The app owns no colour.** Every value comes from the host's design
 *    tokens. The `:root` block below is a *fallback* — `applyHostStyleVariables`
 *    writes the host's values as inline custom properties on `<html>`, which
 *    outrank a `:root` rule, so each fallback is replaced individually by
 *    whatever the host actually sends. Hosts may send any subset of the 76
 *    variables, which is why the fallbacks have to be a coherent palette on
 *    their own rather than a pile of per-token guesses.
 *
 * 3. **A border must earn its line.** There are four in the finished sheet:
 *    the rule above a separate result population, the filter field's baseline,
 *    the article's section rule, and table row separators. Everything else is
 *    separated by whitespace and ranked by weight.
 *
 * What this replaced: a seven-token palette of invented greys, a `#0b6bcb`
 * accent, and a `prefers-color-scheme` dark block. That media query reports the
 * *operating system*, not the host — so a user running Claude in dark mode on a
 * light OS got a white slab in a dark conversation, and no amount of tuning the
 * greys could fix it, because the app was answering a question nobody asked.
 */
export const CSS = `
/* ── Layer 1: host token fallbacks ──────────────────────────────────────────
   Values are the host's own published palette, so a host that sends no tokens
   degrades to something deliberate rather than to a third design. */
:root {
  /* light-dark() needs this to resolve before the host connects.
     applyDocumentTheme() overwrites it inline once it does. */
  color-scheme: light dark;

  --color-text-primary:       light-dark(#141413, #faf9f5);
  --color-text-secondary:     light-dark(#3d3d3a, #c2c0b6);
  --color-text-tertiary:      light-dark(#73726c, #9c9a92);
  --color-text-info:          light-dark(#3266ad, #80aadd);
  --color-text-warning:       light-dark(#5a4815, #d1a041);
  --color-text-danger:        light-dark(#7f2c28, #ee8884);

  --color-border-tertiary:    light-dark(rgb(31 30 29 / .15), rgb(222 220 209 / .15));
  --color-border-secondary:   light-dark(rgb(31 30 29 / .30), rgb(222 220 209 / .30));
  --color-border-info:        light-dark(#4682d5, #4682d5);
  --color-border-warning:     light-dark(#805c1f, #a87829);
  --color-background-info:    light-dark(#d6e4f6, #253e5f);
  --color-background-warning: light-dark(#f6eedf, #483a0f);
  --color-ring-primary:       light-dark(rgb(20 20 19 / .7), rgb(250 249 245 / .7));

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Values taken from Claude's published design-guidelines table, not guessed.
     Five of these were wrong before it was read: the sm/md line heights were
     1.45/1.5 against a documented 1.4, heading-md was 17px against 16px, and
     the two heading line heights were each off by 0.05. */
  --font-text-xs-size: 12px;       --font-text-xs-line-height: 1.4;
  --font-text-sm-size: 14px;       --font-text-sm-line-height: 1.4;
  --font-text-md-size: 16px;       --font-text-md-line-height: 1.4;
  --font-heading-md-size: 16px;    --font-heading-md-line-height: 1.4;
  --font-heading-lg-size: 20px;    --font-heading-lg-line-height: 1.25;

  --border-radius-sm: 6px;
  --border-radius-md: 8px;
  --border-radius-lg: 10px;
  /* Not 1px. A hairline is the difference between a native surface and a
     wireframe, and the host's own rules are sub-pixel. */
  --border-width-regular: 0.5px;
}

/* No --color-background-* fallbacks beyond the two callout tints. Not an
   oversight: rule 1 means the app has no background to paint, so it has no
   background token to guess at. */

/* ── Layer 2: app-owned ─────────────────────────────────────────────────────
   Every surface the app does paint is a tint of the host's own text colour, so
   a host that ships a partial token set cannot produce a clash — there is no
   invented grey left to clash with. */
:root {
  --tint-hover:    color-mix(in oklab, var(--color-text-primary)  6%, transparent);
  --tint-pressed:  color-mix(in oklab, var(--color-text-primary) 10%, transparent);
  --tint-code:     color-mix(in oklab, var(--color-text-primary)  5%, transparent);
  --tint-skeleton: color-mix(in oklab, var(--color-text-primary)  8%, transparent);

  /* One 4px scale for nine components. A padding value that is not on it —
     the \`11px 13px\` this replaced, for instance — is not a design decision. */
  --sp-0: 2px; --sp-1: 4px; --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;

  /* The one token the app knowingly overrides, and it still tracks the host:
     the host's line-height is tuned for chat bubbles, and technical prose with
     inline <code> in it wants more air. */
  --lh-prose: calc(var(--font-text-md-line-height) + 0.2);
}

/* ── Base ───────────────────────────────────────────────────────────────── */

/* min-width:0 so a flex or grid child may shrink — without it one long Jamf
   title forces horizontal overflow on a 320px panel. */
* { box-sizing: border-box; min-width: 0; }

html, body { background: transparent; }

body {
  margin: 0;
  padding: 0;
  color: var(--color-text-primary);
  /* Generics go after the var(), not inside the host's value: a host may send
     a single quoted family with no working fallback in it. */
  font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  font-size: var(--font-text-md-size);
  line-height: var(--font-text-md-line-height);
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;

  /* inline-size only. \`container-type: size\` contains block size too, which
     would freeze the height the SDK's ResizeObserver probes by setting
     documentElement.style.height = "max-content" — the iframe collapses to 0. */
  container: panel / inline-size;
}

/* The panel is NOT a scroll container.
 *
 * An earlier version capped #root at 640px with overflow-y:auto. Claude's
 * design guidelines name that as a pattern to avoid, and explain why it is
 * worse than the problem it solved: on a touch device the conversation view
 * owns vertical scrolling, so a vertical pan starting inside an inline app is
 * handed to the conversation rather than to the app. An internal scroll
 * container therefore does not scroll on mobile at all — everything past the
 * cap becomes unreachable rather than merely below the fold.
 *
 * The documented shape is the opposite: an inline app fits its content, and an
 * app that genuinely needs a scrollable viewport asks for fullscreen. So the
 * bound moved from the pixels to the *content* — renderSearch, renderToc and
 * renderArticle each render an inline-sized slice and offer fullscreen for the
 * rest (see the INLINE_* caps in app.ts).
 */
#root {
  --pad: var(--sp-4);
  --indent: 12px;
  /* Safe-area insets are honoured because the resource sets prefersBorder to
     false, and the guidelines are explicit that in borderless mode content
     runs edge-to-edge with no host padding — the bordered card's own padding
     would otherwise have absorbed them. */
  padding: calc(var(--pad) + var(--sa-top, 0px))    calc(var(--pad) + var(--sa-right, 0px))
           calc(var(--pad) + var(--sa-bottom, 0px)) calc(var(--pad) + var(--sa-left, 0px));
}
@container panel (width < 400px)  { #root { --pad: var(--sp-3); --indent: 8px;  } }
@container panel (width >= 700px) { #root { --pad: var(--sp-5); --indent: 16px; } }

/* One focus rule, applied once, never removed. Visually distinct from hover —
   the two \`outline: none\` declarations this replaced made keyboard focus and
   mouse hover identical across 25 indistinguishable rows. */
:where(a, button, input, [tabindex]):focus-visible {
  outline: 2px solid var(--color-ring-primary);
  outline-offset: 2px;
  border-radius: var(--border-radius-sm);
}

/* Hover is gated twice: on the media feature, which guesses, and on
   hostContext.deviceCapabilities.hover, which the host knows for certain and
   the app writes to :root as data-hover. */
@media (hover: hover) and (pointer: fine) {
  .hit:hover, .row:hover, .mini-item:hover { background: var(--tint-hover); }
  .hit:hover .hit-title { text-decoration: underline; text-underline-offset: 2px; }
}
:root[data-hover="0"] .hit:hover,
:root[data-hover="0"] .row:hover,
:root[data-hover="0"] .mini-item:hover { background: none; }
:root[data-hover="0"] .hit:hover .hit-title { text-decoration: none; }

.hit:active, .row:active { background: var(--tint-pressed); }
/* Optimistic "you clicked this", held for the whole round trip. Nothing dims;
   the row the user is waiting on is the one thing that must stay legible. */
.hit[aria-current="true"], .row[aria-current="true"] { background: var(--tint-pressed); }

/* ── Header ─────────────────────────────────────────────────────────────────
   Four levels, three sizes, two weights. The load-bearing decision is that an
   item title is *not* a size step: it is body size at medium weight. That is
   what turns a page of equal-weight boxes into a ranked list, and it is what
   the sheet this replaced could not do, having contained no font-weight at
   all. */
.head { margin-bottom: var(--sp-5); }
.head-path {
  display: block; margin: 0 0 var(--sp-0);
  font-size: var(--font-text-xs-size); line-height: var(--font-text-xs-line-height);
  color: var(--color-text-tertiary);
  /* The path is trimmed to its two deepest levels in app.ts, so it fits; this
     is the guard for the one Jamf title long enough that two of them do not. */
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.head-title {
  margin: 0;
  font-size: var(--font-heading-lg-size); line-height: var(--font-heading-lg-line-height);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}
.head-sub {
  margin: var(--sp-1) 0 0;
  font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height);
  color: var(--color-text-tertiary);
}
.head-sub a, .prose a { color: var(--color-text-info); text-decoration: underline; text-underline-offset: 2px; }

/* An advisory is a line of text. No box, no icon, no fill — that is what stops
   it becoming another card type. The filled treatment is reserved for in-prose
   callouts, which are content rather than chrome. */
.notice {
  margin: var(--sp-2) 0 0;
  font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height);
  color: var(--color-text-tertiary);
}
.notice[data-level="warning"] { color: var(--color-text-warning); }
.notice[data-level="error"]   { color: var(--color-text-danger); }

/* ── Text buttons ───────────────────────────────────────────────────────────
   Everything that was a bordered box — "Load more", "← Back" — is now text.
   A chunky bordered control in a chat panel reads as a form, and neither of
   these is one. */
.txt, .more {
  border: 0; background: none; padding: 0; font: inherit; cursor: pointer;
  font-size: var(--font-text-sm-size); font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}
.txt:hover { color: var(--color-text-primary); }
.more {
  display: block; width: 100%; text-align: start;
  margin-top: var(--sp-3); padding: var(--sp-2) 0;
  color: var(--color-text-info);
}
.bar {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--sp-3); margin-bottom: var(--sp-3);
}
/* Back and the parent link sit together at the start; whichever of them is
   present, Expand stays at the far end. */
.bar-start { display: flex; align-items: baseline; gap: var(--sp-3); min-width: 0; }
.bar-start .txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.txt { text-decoration: none; }
a.txt:hover { text-decoration: underline; text-underline-offset: 2px; }

/* ── Search results ─────────────────────────────────────────────────────────
   No border, no fill, no radius, no rule between rows. Whitespace separates,
   and order plus title weight ranks. The card this replaced spent about 26px
   of chrome per hit and gave all ten results identical visual weight. */
.list { list-style: none; margin: 0; padding: 0; }
.list-hits > li + li { margin-top: var(--sp-1); }

.hit {
  display: block; width: 100%;
  padding: var(--sp-2);
  /* Bleed the hit target past the text column so the pointer target is wider
     than the words without the text being inset. */
  margin-inline: calc(var(--sp-2) * -1);
  border: 0; background: none; border-radius: var(--border-radius-md);
  color: inherit; text-decoration: none; text-align: start;
  font: inherit; cursor: pointer;
}
.hit-path {
  display: block;
  font-size: var(--font-text-xs-size); line-height: var(--font-text-xs-line-height);
  color: var(--color-text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hit-title {
  display: block; margin-top: var(--sp-0);
  font-size: var(--font-text-md-size); line-height: var(--font-text-md-line-height);
  font-weight: var(--font-weight-medium); color: var(--color-text-primary);
  overflow-wrap: anywhere;
}
/* Two lines. The snippet is there to disambiguate two similar titles, not to
   be read — unclamped, six-line snippets put two results in a 640px panel. */
.hit-snippet {
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  margin-top: var(--sp-0);
  font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height);
  color: var(--color-text-secondary);
}
.hit-meta {
  display: block; margin-top: var(--sp-1);
  font-size: var(--font-text-xs-size); color: var(--color-text-tertiary);
}

/* The one rule in the search view. "Elsewhere" is a genuinely separate
   population that the server refuses to interleave because it has no score to
   interleave it on — which is exactly what a horizontal rule means. */
.group {
  margin-top: var(--sp-5); padding-top: var(--sp-4);
  border-top: var(--border-width-regular) solid var(--color-border-tertiary);
}
.group-title {
  margin: 0 0 var(--sp-2);
  font-size: var(--font-text-sm-size); font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

/* ── Table of contents ──────────────────────────────────────────────────────
   No hairline between rows. Twenty-five of them read as a spreadsheet and
   compete with the indent, which is already the structure; weight and hover
   carry the rest. */
.row {
  display: block;
  padding: var(--sp-1) var(--sp-2);
  padding-inline-start: calc(var(--sp-2) + min(var(--depth, 0), var(--cap, 4)) * var(--indent));
  margin-inline: calc(var(--sp-2) * -1);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height);
  color: var(--color-text-secondary); text-decoration: none;
  overflow-wrap: anywhere; cursor: pointer;
}
.row[data-top] { color: var(--color-text-primary); font-weight: var(--font-weight-medium); }

/* The hidden attribute has to be restated here. The user-agent rule that
   implements it sets display:none on [hidden], and a class selector setting
   display beats an attribute selector on specificity — so the .filter rule
   above un-hid the field the markup had explicitly hidden. */
.filter[hidden] { display: none; }

/* Zero resting pixels until a printable key opens it, and zero tokens ever: it
   filters entries already in memory and never calls a tool. A 792-entry TOC is
   otherwise 12,000px of scrolling in a panel the host clips at 640. */
.filter { display: flex; align-items: baseline; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.filter input {
  flex: 1 1 auto; min-width: 0;
  border: 0; border-bottom: var(--border-width-regular) solid var(--color-border-secondary);
  background: none; padding: var(--sp-1) 0;
  font: inherit; font-size: var(--font-text-sm-size); color: var(--color-text-primary);
}
.filter input::placeholder { color: var(--color-text-tertiary); }
/* A text field already says where focus is, with a caret. The full ring the
   rule above gives every other control draws a heavy box around a control whose
   only edge is an underline, so this one states its focus in the edge it has. */
.filter input:focus-visible {
  outline: none;
  border-bottom-color: var(--color-text-primary);
  border-bottom-width: 1.5px;
}
.filter .count {
  font-size: var(--font-text-xs-size); color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* ── Article ────────────────────────────────────────────────────────────── */

/* Rendered only when the article actually carries sections, which most Jamf
   pages do not — a nav built from an empty list is chrome announcing nothing. */
.mini {
  display: flex; flex-direction: column; gap: var(--sp-0);
  margin: 0 0 var(--sp-5); padding-inline-start: var(--sp-3);
  border-inline-start: var(--border-width-regular) solid var(--color-border-tertiary);
}
.mini-item {
  padding: var(--sp-0) var(--sp-1);
  padding-inline-start: calc(var(--sp-1) + var(--depth, 0) * var(--sp-3));
  border-radius: var(--border-radius-sm);
  font-size: var(--font-text-sm-size); color: var(--color-text-secondary);
  text-decoration: none; cursor: pointer;
}
.mini-item:hover { color: var(--color-text-primary); }

.prose { line-height: var(--lh-prose); }
.prose > :first-child { margin-top: 0; }
.prose h2, .prose h3, .prose h4 {
  font-weight: var(--font-weight-semibold);
  line-height: var(--font-heading-md-line-height);
  scroll-margin-top: var(--sp-5); overflow-wrap: anywhere;
}
/* A full-bleed hairline above each major section turns a wall of prose into a
   scannable document without spending a point of type size. The only
   horizontal line permitted inside content. */
.prose h2 {
  font-size: var(--font-heading-lg-size);
  margin: var(--sp-6) 0 var(--sp-3); padding-top: var(--sp-5);
  border-top: var(--border-width-regular) solid var(--color-border-tertiary);
}
.prose h3 { font-size: var(--font-heading-md-size); margin: var(--sp-5) 0 var(--sp-2); }
/* h4 is the deepest the parser emits, and it is separated from h3 by colour
   rather than size. Three sizes, not six — and no heading ever renders smaller
   than body text, which is what h5/h6 falling through to UA defaults did,
   inverting the hierarchy in the middle of an article. */
.prose h4 {
  font-size: var(--font-heading-md-size); color: var(--color-text-secondary);
  margin: var(--sp-4) 0 var(--sp-2);
}
.prose p, .prose ul, .prose ol { margin: var(--sp-3) 0; }
.prose ul, .prose ol { padding-inline-start: 1.4em; }
.prose li + li { margin-top: var(--sp-1); }
.prose li > ul, .prose li > ol { margin: var(--sp-1) 0; }
.prose hr {
  border: 0; margin: var(--sp-5) 0;
  border-top: var(--border-width-regular) solid var(--color-border-tertiary);
}
.prose img { max-width: 100%; height: auto; }
.prose blockquote {
  margin: var(--sp-3) 0; padding-inline-start: var(--sp-3);
  border-inline-start: 2px solid var(--color-border-tertiary);
  color: var(--color-text-secondary);
}

.prose code {
  font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .9em; padding: var(--sp-0) var(--sp-1);
  border-radius: var(--border-radius-sm); background: var(--tint-code);
  overflow-wrap: anywhere;
}
.pre-wrap { position: relative; margin: var(--sp-3) 0; }
.prose pre {
  margin: 0; padding: var(--sp-3);
  border-radius: var(--border-radius-md); background: var(--tint-code);
  overflow-x: auto; overscroll-behavior-x: contain;
  font-size: var(--font-text-sm-size); line-height: 1.5; tab-size: 2;
}
.prose pre code { padding: 0; background: none; font-size: inherit; white-space: pre; }
.copy {
  position: absolute; inset-block-start: var(--sp-1); inset-inline-end: var(--sp-1);
  border: 0; background: none; padding: var(--sp-1) var(--sp-2); font: inherit;
  font-size: var(--font-text-xs-size); color: var(--color-text-tertiary);
  cursor: pointer; opacity: 0;
}
.pre-wrap:hover .copy, .copy:focus-visible { opacity: 1; }
:root[data-hover="0"] .copy { opacity: 1; }

/* Jamf pages are full of Note:/Important:/Warning: paragraphs. This is the one
   place a fill is content rather than chrome. */
.callout {
  margin: var(--sp-3) 0; padding: var(--sp-3);
  border-inline-start: 2px solid var(--color-border-secondary);
  border-radius: 0 var(--border-radius-md) var(--border-radius-md) 0;
  background: var(--tint-code);
}
.callout > :first-child { margin-top: 0; }
.callout > :last-child { margin-bottom: 0; }
.callout-label {
  display: block; margin-bottom: var(--sp-1);
  font-size: var(--font-text-xs-size); font-weight: var(--font-weight-semibold);
  text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-tertiary);
}
.callout[data-kind="warning"] {
  border-inline-start-color: var(--color-border-warning);
  background: color-mix(in oklab, var(--color-background-warning) 55%, transparent);
}
.callout[data-kind="warning"] .callout-label { color: var(--color-text-warning); }
.callout[data-kind="info"] {
  border-inline-start-color: var(--color-border-info);
  background: color-mix(in oklab, var(--color-background-info) 55%, transparent);
}

/* Horizontal rules only. A full grid is a spreadsheet; a documentation table
   is a list of labelled facts. */
.table-wrap { overflow-x: auto; overscroll-behavior-x: contain; margin: var(--sp-3) 0; }
.prose table {
  border-collapse: collapse; width: 100%; min-width: 22rem;
  font-size: var(--font-text-sm-size); line-height: 1.45;
}
.prose th, .prose td {
  padding: var(--sp-2) var(--sp-3); text-align: start; vertical-align: top;
  border-bottom: var(--border-width-regular) solid var(--color-border-tertiary);
}
.prose th { font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); }
/* A code token in a cell is an identifier — a payload variable, a defaults
   key — and half of one is not a shorter version of it, it is a wrong one. The
   overflow-wrap:anywhere that keeps prose inside a 320px panel was breaking
   the variable $MANAGEMENTID across two lines. Here the token wins: the column
   grows to fit it and .table-wrap scrolls. */
.prose td code, .prose th code { white-space: nowrap; overflow-wrap: normal; }
.prose tbody tr:last-child td { border-bottom: 0; }

/* Fullscreen puts the section list beside the prose. Static, not sticky: with
   auto-resize the iframe is content-height and the *host* scrolls, so there is
   no scrollport for position:sticky to stick within. */
@container panel (width >= 900px) {
  :root[data-mode="fullscreen"] .article-body {
    display: grid; grid-template-columns: minmax(0, 1fr) 200px;
    gap: var(--sp-6); align-items: start;
  }
  :root[data-mode="fullscreen"] .mini {
    grid-column: 2; grid-row: 1; margin: 0;
    border-inline-start: 0; padding-inline-start: 0;
  }
  /* The only max-width in the sheet, and it is gated on a container that is
     actually this wide. The \`article { max-width: 74ch }\` it replaces was
     ~555px in a panel the file's own comments called "~320px", so it had never
     once taken effect. */
  :root[data-mode="fullscreen"] .prose { grid-column: 1; max-width: 72ch; }
}

/* ── Loading, empty, error ──────────────────────────────────────────────────
   \`[aria-busy] { opacity: .55 }\` is gone: dimming the text someone is reading —
   including the row they just clicked — for a whole Fluid Topics round trip
   reads as broken rather than as busy. */
.sk { display: block; }
.sk-line {
  display: block; width: var(--w, 100%); height: 1em; margin-top: var(--sp-2);
  border-radius: var(--border-radius-sm); background: var(--tint-skeleton);
}
.sk-line:first-child { margin-top: 0; height: .75em; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: sk-pulse 1.4s ease-in-out infinite; }
  @keyframes sk-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .5 } }
}
`;
