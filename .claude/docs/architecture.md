# Architecture

## The dual-runtime constraint

`src/core/` is compiled for **both** Node and Cloudflare Workers. Everything else
follows from that:

- **No filesystem.** Workers has none. `fs` appears only under
  `src/platforms/node/`.
- **No assumed `node:crypto`.** Anything needing a hash computes it at build
  time — see how `APP_HTML_HASH` is emitted by `scripts/build-app-ui.mjs`
  rather than derived at runtime.
- **No `process.env` reads in core.** Configuration arrives through
  `ServerContext`, built by whichever platform is starting the server.

If a change to `src/core/` needs a Node API, that is the signal to put it behind
an interface instead.

## Module map

```
src/
  index.ts                 Node entry point — builds a ServerContext, picks a transport
  core/
    create-server.ts       registers tools/resources/prompts onto an McpServer
    types.ts               shared types, including every Fluid Topics payload shape
    types/context.ts       ServerContext — the dependency-injection seam
    http-client.ts         httpGetJson / httpGetText / httpPostJson, plus HttpError
    services/
      ft-client.ts         the ONLY place that talks to Fluid Topics
      search-service.ts    search + filter relaxation + pagination + token budget
      article-service.ts   resolve a URL to mapId/contentId, fetch, parse
      toc-service.ts       table of contents
      glossary.ts          glossary term lookup (fuzzy, via fuse.js)
      metadata.ts          product/version metadata, with a static fallback
      maps-registry.ts     the map catalogue, cached
      topic-resolver.ts    URL -> mapId/contentId resolution
      interfaces/          provider seams (cache, search, article, glossary, toc)
    tools/                 one file per MCP tool
    resources/             jamf:// resources
    apps/                  MCP Apps extension — the ui:// viewer resource
    apps/generated/        build output, committed (see conventions.md)
  platforms/node/          FileCache, NodeLoggerFactory, the HTTP server
  transport/               stdio and streamable-HTTP transports, CLI arg parsing
```

## ServerContext and provider injection

Every service takes `ctx: ServerContext` as its first argument. It carries the
cache, a logger factory, config, the maps registry and the topic resolver — and
optionally a set of **providers**:

```ts
searchProvider?  articleProvider?  glossaryProvider?  tocProvider?
```

When a provider is present the service asks it first and falls back to the
Fluid Topics path if it returns `null`. This is how the Cloudflare Worker
deployment serves search and glossary results out of D1 without forking any
logic: same core, different providers.

Two consequences worth remembering:

- A bug in a shared service reaches both deployments. The glossary regression
  hit Workers too, because `D1GlossaryProvider` falls through to
  `lookupGlossaryTerm` on a cache miss.
- Tests can inject providers instead of mocking modules. `createMockContext()`
  in `test/helpers/mock-context.ts` is the usual entry point.

## Where external data enters

Exactly one file: `src/core/services/ft-client.ts`. Four calls, all bare casts:

```ts
httpGetJson<FtMapInfo[]>(url)              // fetchMaps
httpGetJson<FtTocNode | FtTocNode[]>(url)  // fetchMapToc
httpGetJson<FtTopicInfo[]>(url)            // fetchMapTopics
httpGetJson<FtTopicInfo>(url)              // fetchTopicMetadata
```

No schema validation runs on any of them. That is a deliberate, documented
position rather than an oversight — see the reasoning recorded against the
`metadata` fix — but it means the payload types describe convention, not
guarantee. `../skills/ft-payload-safety/` is the working procedure.

Metadata reads all funnel through `getMetaValue` / `getMetaValues` in
`src/core/utils/ft-metadata.ts`, which tolerate an absent array. Prefer them
over reaching into `metadata` directly; that is what makes a missing key and a
missing array behave the same.
