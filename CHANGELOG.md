# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-11

### Added

- Private responsive Apps Script web dashboard.
- Versioned settings with optimistic revision checks and legacy migration.
- Full AI, Summary-only, and no-AI Keyword analysis modes.
- Configurable recipients, sender name, delivery policy, interval, active hours, and source controls.
- Keyword, institution, correction, cancellation, uncertainty, and headline filters.
- Scheduler health, remaining email quota, last-run status, and safe activity history.
- Email and Gemini tests plus scheduler, cache, history, and key maintenance actions.
- Private deployment and commercial-architecture documentation.

### Changed

- Replaced seven fixed daily triggers with one hourly scheduler and runtime interval gating.
- Made Gemini optional and corrected email language for non-AI and incomplete-analysis results.
- Included model, mode, and prompt version in analysis-cache keys.
- Expanded automated tests for dashboard settings, migration, optional AI, and client safety.

## [1.0.0] - 2026-08-11

### Added

- Daily and supplemental Official Gazette issue discovery.
- Exact date and PDF validation for safe publication matching.
- Gemini-powered structured analysis of academic recruitment notices.
- Research-assistant vacancy extraction and manual-review fallback.
- Responsive HTML and plain-text email reports.
- Scheduled retries, deduplication, caching, and run-time safeguards.
- Parser and integration tests with GitHub Actions CI.
