# Turkish Official Gazette Academic Alerts

[![Tests](https://github.com/yberkayinci/turkish-official-gazette-academic-alerts/actions/workflows/test.yml/badge.svg)](https://github.com/yberkayinci/turkish-official-gazette-academic-alerts/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-V8-4285F4)](https://script.google.com/)
[![Vercel](https://img.shields.io/badge/Vercel-Private%20Edition-000000)](https://vercel.com/)

A professional monitoring application for academic recruitment notices in Türkiye's Official Gazette. It discovers regular and supplemental issues, optionally uses Gemini to extract research-assistant vacancies, and sends configurable email alerts.

The repository keeps two independently deployable products: a minimal-infrastructure **Apps Script Edition** and a hosted **Vercel Private Edition**. Both provide a polished dashboard, optional AI, flexible preferences, multiple recipients, relevance filters, and operational history.
<img width="2493" height="1234" alt="image" src="https://github.com/user-attachments/assets/5e42408d-dc5b-42b4-95c1-c0c687177c38" />

<img width="2526" height="1229" alt="image" src="https://github.com/user-attachments/assets/a112024c-e217-4d82-b90a-81e6ccea0856" />

<img width="2061" height="780" alt="image" src="https://github.com/user-attachments/assets/b89eb51d-bf07-4757-9c9c-210d1874d41a" />


## Choose an edition

| | Apps Script Edition | Vercel Private Edition |
| --- | --- | --- |
| Best for | The easiest private Gmail workflow | A hosted, extensible private installation |
| Location | Repository root | `apps/vercel` |
| Email | Google MailApp | Resend |
| State | Script Properties | Neon Postgres |
| Authentication | Google account; `Only myself` | Single-owner secure session |
| Scheduling | Apps Script trigger | Daily on Hobby; hourly gate on Pro |
| Infrastructure | Google account only | Vercel, Neon, and Resend |

Read the full [edition comparison](docs/EDITIONS.md).

### Security boundary

Both editions are **single-tenant**. Each installation has one owner and its own settings, secrets, scheduler, and provider quotas.

The Apps Script Edition must be deployed with:

- **Execute as:** Me
- **Who has access:** Only myself

The Vercel Private Edition must retain application authentication, protected Cron requests, encrypted credentials, and a private administrator password. Do not turn either edition into an anonymous or shared multi-user application. A centralized commercial SaaS requires tenant isolation, recipient verification, billing, abuse controls, and lifecycle operations. See [Commercial architecture](docs/COMMERCIALIZATION.md).

## Dashboard capabilities

- Private, responsive setup and operations dashboard.
- Primary recipient plus two optional additional recipients, delivered privately by BCC in Apps Script or as separate messages in Vercel.
- Custom sender name and delivery policy.
- Monitoring every 1, 2, 3, 4, 6, 8, 12, or 24 hours.
- Configurable active-hours window in `Europe/Istanbul`.
- Pause/resume monitoring without deleting configuration.
- Previous-day backfill and supplemental-issue controls.
- Three analysis modes:

  | Mode | Gemini key | Headline summary | PDF vacancy extraction |
  | --- | --- | --- | --- |
  | Full AI | Required | Optional | Yes |
  | Summary only | Required | Yes | No; candidate links require review |
  | Keyword mode | Not required | Deterministic | No; likely academic links require review |

- Required/excluded keyword and preferred-institution filters.
- Correction, cancellation, uncertainty, and headline preferences.
- Test email and Gemini connection actions.
- Remaining email quota, scheduler health, last-run summary, and recent activity.
- Explicit Apps Script controls for cache, processed history, scheduler repair, and API-key removal.

## Monitoring capabilities

- Verifies the requested date and exact PDF filename to reject the Official Gazette website's silent date fallback.
- Discovers the regular issue and every supplemental issue listed on the official daily page.
- Prioritizes the **Miscellaneous Notices** index before applying the headline limit.
- Reviews all linked notice PDFs in Full AI mode instead of relying only on link-title keywords.
- Uses Gemini structured output to extract institution, unit, department, count, grade, ALES, language requirement, special conditions, deadline, method, evidence, and source page.
- Preserves official source links and never trusts AI-generated URLs.
- Degrades to manual-review links when AI, parsing, quota, document-size, or execution-time limits prevent a reliable result.
- Deduplicates processed issues and checks the previous day for late publications; the Apps Script Edition also caches document analysis.

## Apps Script architecture

```mermaid
flowchart LR
    A["Private Apps Script dashboard"] --> B["Versioned settings"]
    B --> C["Single hourly scheduler"]
    C --> D["Interval and active-hours gate"]
    D --> E["Official Gazette daily page"]
    E --> F["Regular and supplemental issues"]
    F --> G["Headlines and official PDF"]
    F --> H["Miscellaneous Notices PDFs"]
    H --> I{"Analysis mode"}
    I -->|"Full AI"| J["Gemini structured extraction"]
    I -->|"Summary only / Off"| K["Keyword and manual-review links"]
    G --> L["HTML and plain-text report"]
    J --> L
    K --> L
    L --> M["Saved recipients via MailApp"]
```

Secrets remain separate from non-secret preferences:

- `GEMINI_API_KEY`: stored separately and never returned to the browser.
- `RECIPIENT_EMAIL`: legacy-compatible primary recipient property.
- `RG_SETTINGS_V2`: versioned non-secret preferences.
- Runtime state, activity, processed publications, and analysis cache use independent properties.

## Apps Script requirements

- A Google account.
- A private Google Apps Script project.
- A Gemini Developer API key only for **Full AI** or **Summary only** mode.

> Google AI Pro and the Gemini Developer API are separate products. An AI Pro subscription does not remove the need for a Developer API key. API usage follows the associated project's free or paid quota. See [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing).

## Apps Script quick start

1. Open [Google Apps Script](https://script.google.com/) and create a new project.
2. Add the repository files to the project:

   - `Code.gs`
   - `WebApp.gs`
   - `Index.html` as an HTML file named `Index`
   - `appsscript.json` when using `clasp`

3. Set the project time zone to **(GMT+03:00) Europe/Istanbul**.
4. Choose **Deploy → New deployment → Web app**.
5. Select **Execute as me** and **Only myself**, authorize the requested scopes, and deploy.
6. Open the deployment URL, complete the dashboard, and save.
7. Use **Send test email**, **Test AI connection** when applicable, and **Check now**.

The dashboard creates exactly one hourly scheduler and enforces the chosen interval and active window in code. Apps Script trigger times are approximate.

For a complete production checklist, upgrades, and troubleshooting, read [Deployment guide](docs/DEPLOYMENT.md).

## Vercel Private Edition

The hosted edition lives in [`apps/vercel`](apps/vercel) and keeps the Apps Script files unchanged. It provides:

- A responsive, password-protected dashboard.
- Neon Postgres state with job leases and delivery idempotency.
- Encrypted dashboard-managed Gemini credentials with environment-variable fallbacks.
- Resend transactional email from a verified domain.
- A Hobby-safe daily Cron profile and a Pro hourly profile with runtime interval gating.
- Server-side Official Gazette allowlisting, redirect validation, size limits, and manual-review fallback.

### Vercel quick start

1. Import this repository into Vercel.
2. Set **Root Directory** to `apps/vercel`.
3. Connect a Neon Postgres database and Resend account through the Vercel Marketplace.
4. Add the required environment variables from [`apps/vercel/.env.example`](apps/vercel/.env.example).
5. Install dependencies and run `npm run db:migrate` from `apps/vercel`.
6. Deploy, sign in, complete the dashboard, send a test email, and run the first check in Keyword mode.
7. Enable monitoring after storage, email, and Cron health are ready.

Vercel Hobby supports native Cron only once per day, so the committed `vercel.json` is deliberately Hobby-safe. On Vercel Pro, run `npm run cron:pro`, set `VERCEL_CRON_PROFILE=pro`, commit the resulting static configuration, and redeploy to enable sub-daily monitoring. A verified Resend domain is required for production recipients. Follow the complete [Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md).

> Do not enable both editions for the same recipients unless duplicate alerts are intentional. Their processed-publication state does not synchronize.

## Backward compatibility

Existing version 1 installations continue to work:

- A stored `RECIPIENT_EMAIL` is imported as the primary recipient.
- A stored `GEMINI_API_KEY` selects Full AI mode; the dashboard verifies it on the first AI-enabled save before marking setup complete.
- Processed-publication state and the existing analysis cache are retained.
- Saving the dashboard replaces the former fixed trigger set with one hourly scheduler.

The legacy `setup()` function remains available, but new installations should use the dashboard.

## Public Apps Script functions

| Function | Purpose |
| --- | --- |
| `doGet` | Serves the private dashboard |
| `getDashboardState` | Returns sanitized settings, health, quota, and activity |
| `saveDashboardSettings` | Validates and saves preferences, optionally verifies a new AI key, and reconciles the scheduler |
| `testRecipientEmail` | Sends a test only to saved recipients |
| `testAiConnection` | Verifies the stored Gemini key |
| `runCheckNow` | Runs an immediate check from the dashboard |
| `repairScheduler` | Reconciles missing or duplicate scheduler triggers |
| `clearProcessedHistory` | Clears deduplication history after explicit confirmation |
| `clearAnalysisCache` | Clears cached AI analyses after explicit confirmation |
| `clearAiKey` | Removes the AI key only while AI is disabled |
| `setup` | Backward-compatible initializer for editor-based installations |
| `scheduledCheck` | Installable-trigger entry point |
| `checkTodayNow` | Editor-based immediate check |
| `resendToday` | Reanalyzes and resends today's issue |
| `showStatus` | Logs a secret-safe operational summary |

## Security and privacy

- Never commit a Gemini key, recipient address, deployment URL, or `.clasp.json`.
- Never deploy this single-tenant version to anonymous or broad access.
- Keep the Apps Script project private and limit editor access. Script Properties are configuration storage, not a dedicated secrets vault; project editors can read them.
- The API key is sent in the `x-goog-api-key` header and is never returned by dashboard endpoints.
- Dashboard values are rendered with safe text operations, not dynamic HTML.
- Server endpoints validate full payloads, reject unknown settings, cap list sizes, and use optimistic revisions to prevent two tabs from silently overwriting each other.
- Email tests can target only saved recipients, preventing the endpoint from becoming an arbitrary mail relay.
- Only `https://www.resmigazete.gov.tr` source links are rendered in reports.
- Official Gazette documents are public. Do not add CVs or personal profiles without reviewing the selected Gemini tier's data-use terms.
- In the Vercel Edition, keep database, session, encryption, Cron, Resend, and fallback Gemini secrets in server-only environment variables. Dashboard-managed provider keys are encrypted before storage and are never returned to the browser.
- Vercel Cron may overlap or be delivered more than once; database leases, unique delivery records, and provider idempotency keys are required controls, not optional optimizations.

Read [SECURITY.md](SECURITY.md) before deployment.

## Reliability and quota behavior

- One hourly trigger remains well below the Apps Script per-user trigger limit.
- Interval gating avoids running the full monitor every hour when a longer interval is selected.
- A global deadline prevents new network calls near the Apps Script execution limit.
- Email quota is checked against the number of recipients, not only the number of messages.
- Full AI mode permits up to 30 candidate documents plus one optional headline-summary request per new issue.
- AI failure creates manual-review entries instead of claiming that no vacancy exists.
- Analysis cache keys include the model and prompt version so incompatible results are not silently reused.

Always confirm current limits in the official [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) and Gemini project **Rate Limits** pages.

Relevant documentation:

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [HTML Service communication](https://developers.google.com/apps-script/guides/html/communication)
- [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Properties Service](https://developers.google.com/apps-script/reference/properties)
- [Gemini document processing](https://ai.google.dev/gemini-api/docs/document-processing)
- [Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)

## Development

The Apps Script production runtime uses no package dependency or third-party UI CDN. Node.js is required for local tests:

```bash
npm test
```

The Vercel Edition is an independent Next.js workspace:

```bash
cd apps/vercel
npm ci
npm test
npm run typecheck
npm run build
```

The test suite covers:

- Official Gazette parsing and exact-date safety.
- Supplemental-issue discovery.
- Full AI integration, request shape, email output, and deduplication.
- Version 1 migration and versioned dashboard settings.
- Optional-AI keyword mode and secret non-disclosure.
- Recipient restrictions and scheduler reconciliation.
- Dashboard client syntax, required controls, accessibility markers, and unsafe-rendering regressions.

## Disclaimer

This project is an independent alerting aid, not a legal source, official government service, or employment decision system. AI and keyword results can be incomplete or incorrect. Always open the linked official notice and verify requirements, dates, corrections, cancellations, and application instructions before acting.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), update tests and documentation, and open a focused pull request.

## License

Licensed under the [MIT License](LICENSE).
