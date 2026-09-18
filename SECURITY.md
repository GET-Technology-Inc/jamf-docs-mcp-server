# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 5.x     | :white_check_mark: |
| < 5.0.0 | :x:                |

Releases are automated, so the supported line is whatever `npm view
@get-technology-inc/jamf-docs-mcp-server version` reports. This table said
`1.2.x` until 2026-09-18, four majors behind — which told anyone reporting a
vulnerability that the current release was unsupported and a long-retired one
was not.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include detailed information about the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Security Considerations

This MCP server:

- Only reads publicly available documentation from learn.jamf.com
- Does not store or transmit sensitive credentials
- Uses HTTPS for all external requests
- Implements request rate limiting to prevent abuse

## Dependencies

We use Dependabot to keep dependencies updated and address known vulnerabilities.
