# Security Policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature if it is available for this repository. Include:

- A concise description of the issue and its impact.
- Reproduction steps or a minimal proof of concept.
- The affected file or function.
- Any suggested mitigation.

Do not open a public issue that contains API keys, email addresses, access tokens, or other sensitive information. If private reporting is unavailable, open a public issue containing no sensitive details and ask the maintainer for a private contact channel.

## Secret handling

This repository must never contain real Gemini API keys or recipient addresses. Runtime configuration belongs in the user's private Apps Script **Script Properties**. If a secret is accidentally committed, revoke or rotate it immediately; removing it from the latest commit is not sufficient.
