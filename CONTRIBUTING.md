# Contributing to Jamf Docs MCP Server

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/jamf-docs-mcp-server.git`

   (Upstream repository: `https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git`)
3. Install dependencies with Node.js 24 or newer (the `engines` floor, and the oldest version CI tests): `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development

```bash
# Build the project
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Type check
npm run typecheck

# Test with MCP Inspector
npm run test:inspector
```

## Code Style

- Use TypeScript strict mode
- Follow ESLint rules (run `npm run lint`)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure type checking passes: `npm run typecheck`
3. Ensure code is linted: `npm run lint`
4. Update documentation if needed
5. Create a pull request with a clear description

### PR Title Convention

**The PR title decides what your merge earns.** This repository squash-merges,
so the title becomes the only commit message on `main` — every typed message
inside your PR is discarded. When semantic-release next runs (see
[Releases](#releases)), that one line is all it reads of your PR to decide the
version.

Use conventional commit format, and make the title at least as strong as the
strongest change in the branch:

| Prefix | Meaning | Release |
|--------|---------|---------|
| `feat:` | New feature | minor |
| `fix:` | Bug fix | patch |
| `perf:` / `refactor:` / `style:` / `build:` / `deps:` / `revert:` | As named | patch |
| `docs:` / `test:` / `ci:` / `chore:` | No user-visible change | **none** |
| any prefix with `!` (e.g. `feat!:`) | Breaking change | major |

A PR that fixes a bug but is titled `chore:` earns no release, and because the
non-releasing types are hidden from the changelog, the fix never appears in any
release notes either. This happened in #296 — sixteen commits including a
`feat`, squashed under a `chore:` title, released nothing while every check
stayed green.

`.github/workflows/pr-title.yml` now fails a PR whose title would throw away a
release its commits earned. It does not require every PR to release: a genuinely
documentation-only PR titled `docs:` is correct and passes.

### Releases

Merging does not publish. `.github/workflows/release.yml` releases `main` once a
day, at 02:23 UTC (10:23 Taipei), and publishes only when all of these hold:

- something has merged since the last release;
- the `Test (Node …)` checks on the newest commit of `main` passed;
- the package it would publish differs from the last one on npm. `README.md`
  does not count, and neither do the parts of `package.json` a consumer's
  install never reads (`version`, `devDependencies`, `overrides`, and scripts
  other than the install hooks).

So a `deps:` bump of a devDependency, a lockfile-only bump or a `fix(ci):`
waits, and goes out in the notes of the next release that ships something.
Nothing is dropped: semantic-release reads every commit since the last tag, and
the titles of all of them decide the version. A day with a `feat:` and three
`fix:` merges publishes one minor release.

A merge that changes `package.json` starts a release straight away, so an
unattended Dependabot security update that raises a runtime range is published
without waiting for the next day.

To release now:

```bash
gh workflow run release.yml
```

or Actions › Release › Run workflow. `-f skip_content_gate=true` publishes even
if the package would be identical (to ship a README change on its own, say), and
`-f skip_ci_check=true` publishes without waiting for the Test checks. Neither
forces a version: if nothing merged since the last release earns one, nothing is
published. A run that holds a release says why in its job summary.

GitHub disables a scheduled workflow after 60 days with no activity in the
repository, and that disables all of Release, manual runs included. Nothing
publishes until someone re-enables it:

```bash
gh workflow enable release.yml
```

(or Actions › Release › Enable workflow). The header of `release.yml` also says
how to recover a version that was tagged but never reached npm.

## Adding New MCP Tools

When adding a new tool:

1. Create the tool file in `src/tools/`
2. Define Zod schema in `src/schemas/`
3. Register the tool in `src/tools/index.ts`
4. Add tests in `test/`
5. Update README.md with usage examples

## Reporting Issues

- Use the issue templates provided
- Include reproduction steps
- Include environment details (OS, Node.js version, etc.)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
