# Contributing to Jamf Docs MCP Server

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/jamf-docs-mcp-server.git`
3. Install dependencies: `npm install`
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
2. Ensure code is linted: `npm run lint`
3. Update documentation if needed
4. Create a pull request with a clear description

### PR Title Convention

Use conventional commit format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Maintenance tasks

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
