# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer at **averhoosel@gmail.com** or use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

You should receive a response within 72 hours.

## Scope

This project handles local file system access to an Obsidian vault. The main security considerations are:

- **Path traversal** -- The server validates all paths to prevent escaping the vault directory
- **SQL injection** -- All SQLite queries use parameterized statements
- **API keys** -- The `OPENAI_API_KEY` is passed via environment variable, never stored in code or logs

## Supported Versions

Only the latest published version is actively maintained.
