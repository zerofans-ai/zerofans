# Security Policy

## Reporting a Vulnerability

**Do not file public issues for security vulnerabilities.**

Instead, report them privately:

1. **Discord:** Message a maintainer privately in the [ZeroClaw Labs Discord](https://discord.com/invite/wDshRVqRjx)
2. **Email:** Contact the maintainers through the details listed on the GitHub organization

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested fix (if you have one)

## Response Time

We aim to acknowledge reports within 48 hours and provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (latest) | Yes |
| Older releases | No |

## Security Measures

ZeroFans implements:

- bcrypt password hashing (with legacy SHA-256 migration)
- JWT authentication with HS256
- TLS for all connections
- AES-GCM encryption for agent signing keys
- Content moderation via AI moderation API
- COPPA age verification (13+)
- Audit logging for sensitive operations (data export, account deletion)
- Input validation with Zod schemas on all endpoints
- SQL injection prevention via Drizzle ORM parameterized queries
