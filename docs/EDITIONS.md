# Product editions

The repository contains two independently deployable editions. They share the same monitoring goal, but they have different operational and security boundaries.

## Comparison

| Capability | Apps Script Edition | Vercel Private Edition |
| --- | --- | --- |
| Intended owner | One Google account | One authenticated administrator |
| Hosting | Google Apps Script | Vercel |
| Email delivery | Google `MailApp` | Resend |
| Durable state | Script Properties | Neon Postgres |
| Scheduler | Apps Script installable trigger | Vercel Cron |
| Dashboard access | Google account; deploy as **Only myself** | Password-protected application session |
| AI | Optional Gemini BYOK | Optional Gemini BYOK or server fallback key |
| Lowest-cost schedule | Approximately hourly scheduler with runtime gating | Once daily on Vercel Hobby |
| Sub-daily schedules | Supported within Apps Script quotas | Vercel Pro required for native hourly Cron |
| Recommended use | Personal/private monitoring with minimal infrastructure | Private hosted deployment and commercial single-customer installations |

## Apps Script Edition

The Apps Script Edition remains at the repository root:

- `Code.gs`
- `WebApp.gs`
- `Index.html`
- `appsscript.json`

It must be deployed with **Execute as me** and **Only myself**. Each customer must own a separate project and Google authorization. It is the easiest edition for a personal Gmail workflow because it does not require a separate database or mail provider.

See [Apps Script deployment](DEPLOYMENT.md).

## Vercel Private Edition

The Vercel application lives under `apps/vercel`. Configure that directory as the Vercel project's **Root Directory**.

It is a single-owner hosted application, not an unrestricted public SaaS. It adds:

- A password-protected management dashboard.
- Neon Postgres for settings, activity, leases, processed publications, delivery records, and encrypted credentials.
- Resend for transactional email and delivery idempotency.
- Vercel Cron with database locking and duplicate-delivery protection.
- Optional Gemini analysis with encrypted bring-your-own-key storage.
- Independent preview and production deployments.

See [Vercel deployment](VERCEL_DEPLOYMENT.md).

## Important operating rule

Do not leave both editions actively emailing the same recipients unless duplicate alerts are intentional. Their state stores are independent, so one edition cannot see that the other already sent a report. Keep monitoring enabled in only one edition during normal operation.

## What does not migrate automatically

The following data is deliberately isolated and is not copied between editions:

- Recipient addresses and delivery preferences.
- Gemini and email-provider credentials.
- Processed-publication history.
- Analysis cache.
- Activity and delivery history.

Re-enter settings in the destination edition and send a test email before enabling its scheduler.

## Multi-user SaaS boundary

Neither edition should be exposed as an open multi-user service. A centralized SaaS requires verified user identity, tenant-level database isolation, recipient verification, subscription enforcement, abuse controls, bounce and complaint handling, deletion/export workflows, and operational monitoring. See [Commercial architecture](COMMERCIALIZATION.md).
