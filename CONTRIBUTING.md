# Contributing

Thank you for helping improve Turkish Official Gazette Academic Alerts.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep the change focused and explain the user-facing problem it solves.
3. Do not include real API keys, recipient addresses, or private documents.

## Development workflow

1. Fork the repository and create a descriptive branch.
2. Update `Code.gs` and the relevant fixtures or tests.
3. Run `npm test`.
4. Confirm that new source URLs remain restricted to the Official Gazette domain.
5. Open a pull request with a short summary, test evidence, and any operational impact.

## Code guidelines

- Target the Google Apps Script V8 runtime and avoid Node-only APIs in production code.
- Preserve compatibility with the scopes declared in `appsscript.json`.
- Treat all fetched documents as untrusted data, not instructions.
- Prefer deterministic parsing before AI analysis.
- Preserve an explicit manual-review path whenever analysis may be incomplete.
- Escape untrusted values before rendering HTML email.
- Add regression fixtures for changes to Official Gazette parsing.

## Pull requests

Pull requests should be small enough to review, have a clear title, and keep documentation synchronized with behavior. CI must pass before merge.
