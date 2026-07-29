/**
 * Styles for the Jamf documentation MCP App.
 *
 * Kept as a TS string so the whole app bundles into one self-contained file —
 * the host renders `ui://` resources in a sandboxed iframe with a
 * deny-by-default CSP, so an external stylesheet would simply not load.
 *
 * Colours are expressed against `prefers-color-scheme` because the app has no
 * way to read the host's theme; both schemes have to look deliberate.
 */
export const CSS = `
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #5f6b7a;
  --line: #e3e7ec;
  --accent: #0b6bcb;
  --surface: #f7f9fb;
  --code-bg: #f2f4f7;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16191d;
    --fg: #e8eaed;
    --muted: #9aa4b2;
    --line: #2a2f36;
    --accent: #6fb3ff;
    --surface: #1d2126;
    --code-bg: #22272e;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 16px;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
}

[aria-busy="true"] { opacity: 0.55; }

h1 { font-size: 1.35rem; margin: 0 0 4px; line-height: 1.3; }
h2 { font-size: 1.05rem; margin: 1.2em 0 0.4em; }
h3 { font-size: 0.98rem; margin: 1em 0 0.3em; }

p { margin: 0.5em 0; }

header { margin-bottom: 14px; }

.muted { color: var(--muted); font-size: 0.87rem; margin: 0; }
.note { margin-top: 14px; font-style: italic; }

.crumbs { color: var(--muted); font-size: 0.78rem; margin-bottom: 4px; }

.chip {
  display: inline-block;
  padding: 1px 7px;
  margin-right: 5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 0.75rem;
  color: var(--muted);
  white-space: nowrap;
}

.cards, .rows { list-style: none; margin: 0; padding: 0; }

.card {
  padding: 11px 13px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  cursor: pointer;
}
.card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
.card h2 { margin: 0 0 4px; font-size: 0.98rem; }
.card .snippet { color: var(--muted); font-size: 0.85rem; margin: 0 0 6px; }
.card .meta { font-size: 0.75rem; }

.row {
  padding: 8px 11px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.row:hover, .row:focus-visible { background: var(--surface); outline: none; }

button {
  font: inherit;
  cursor: pointer;
  color: inherit;
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  font-size: inherit;
}

a { color: var(--accent); }

.back, .more {
  margin: 10px 0;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
}
.back:hover, .more:hover { border-color: var(--accent); }

.sections {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 9px 11px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  font-size: 0.85rem;
}

article { max-width: 74ch; }

article pre {
  padding: 10px 12px;
  border-radius: 7px;
  background: var(--code-bg);
  overflow-x: auto;
}

code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--code-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}

pre code { padding: 0; background: none; }

article ul, article ol { padding-left: 1.35em; }

table { border-collapse: collapse; }
td, th { border: 1px solid var(--line); padding: 4px 8px; }
`;
