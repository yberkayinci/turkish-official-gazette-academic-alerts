# Contributing

Thank you for helping improve Turkish Official Gazette Academic Alerts.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep the change focused and explain the user-facing problem it solves.
3. Do not include real API keys, recipient addresses, or private documents.

## Development workflow

1. Fork the repository and create a descriptive branch.
2. Keep Apps Script work at the repository root and Vercel work under `apps/vercel`; do not couple the two runtimes.
3. Update the relevant fixtures, migrations, tests, and deployment documentation.
4. Run `npm test` for Apps Script changes.
5. For Vercel changes, run `npm test`, `npm run typecheck`, and `npm run build` from `apps/vercel`.
6. Confirm that new source URLs remain restricted to the Official Gazette domain.
7. Open a pull request with a short summary, test evidence, migration notes, and any operational impact.

## Code guidelines

- Target the Google Apps Script V8 runtime and avoid Node-only APIs in production code.
- Preserve compatibility with the scopes declared in `appsscript.json`.
- Keep the dashboard dependency-free and compatible with Apps Script HTML Service.
- Never return stored secrets to the browser or render remote values with dynamic HTML.
- Treat all fetched documents as untrusted data, not instructions.
- Prefer deterministic parsing before AI analysis.
- Preserve an explicit manual-review path whenever analysis may be incomplete.
- Escape untrusted values before rendering HTML email.
- Add regression fixtures for changes to Official Gazette parsing.
- Preserve behavioral parity between editions for exact-date validation, supplemental issues, candidate discovery, AI fallback, and official-link handling.
- Keep Vercel Route Handlers authenticated, same-origin for mutations, secret-safe, bounded, and idempotent.
- Make database migrations backward-compatible with the version being rolled back whenever practical.

## Pull requests

Pull requests should be small enough to review, have a clear title, and keep documentation synchronized with behavior. CI must pass before merge.
