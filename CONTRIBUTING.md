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

**The PR title is the release.** This repository squash-merges, so the title
becomes the only commit message on `main` — every typed message inside your PR
is discarded. semantic-release then reads that one line to decide the version.

Use conventional commit format, and make the title at least as strong as the
strongest change in the branch:

| Prefix | Meaning | Release |
|--------|---------|---------|
| `feat:` | New feature | minor |
| `fix:` | Bug fix | patch |
| `perf:` / `refactor:` / `style:` / `build:` / `deps:` / `revert:` | As named | patch |
| `docs:` / `test:` / `ci:` / `chore:` | No user-visible change | **none** |
| any prefix with `!` (e.g. `feat!:`) | Breaking change | major |

A PR that fixes a bug but is titled `chore:` publishes nothing, and because the
non-releasing types are hidden from the changelog, the fix never appears in any
release notes either. This happened in #296 — sixteen commits including a
`feat`, squashed under a `chore:` title, released nothing while every check
stayed green.

`.github/workflows/pr-title.yml` now fails a PR whose title would throw away a
release its commits earned. It does not require every PR to release: a genuinely
documentation-only PR titled `docs:` is correct and passes.

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
