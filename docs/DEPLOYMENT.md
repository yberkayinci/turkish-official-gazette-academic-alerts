# Private production deployment

This guide deploys Official Gazette Monitor as a private, single-user Google Apps Script web app.

## Security model

Use one Apps Script project per customer or Google account:

- **Execute as:** Me
- **Who has access:** Only myself

The project owner supplies the recipient list, optional Gemini key, MailApp quota, and installable trigger. Do not use the current Script Properties architecture for a shared or anonymous deployment.

## Install the files

### Apps Script editor

1. Create a project at [script.google.com](https://script.google.com/).
2. Replace the default script with `Code.gs`.
3. Add a script file named `WebApp` and paste `WebApp.gs`.
4. Add an HTML file named `Index` and paste `Index.html`.
5. Open **Project Settings** and select `Europe/Istanbul`.

The Apps Script editor can infer required scopes. If you manage the project with `clasp`, use the repository's `appsscript.json` manifest.

### Optional `clasp` workflow

Do not commit `.clasp.json`; it contains the Apps Script project identifier.

1. Install and authenticate the official `clasp` command-line tool.
2. Clone or create the Apps Script project in a private working copy.
3. Copy `Code.gs`, `WebApp.gs`, `Index.html`, and `appsscript.json` into that working copy.
4. Push the files to Apps Script.

Consult the official [`clasp` documentation](https://github.com/google/clasp) for authentication and project linking.

## Authorize and deploy

1. In the Apps Script editor, select `getDashboardState` and run it once.
2. Review the requested permissions:

   - Connect to external services.
   - Send email as the project owner.
   - Manage installable triggers.

3. If Google shows an unverified-app warning for a script project you created yourself, continue only after confirming the displayed project name and URL belong to your project.
4. Select **Deploy → New deployment**.
5. Choose **Web app**.
6. Enter a version description such as `Official Gazette Monitor 2.0.0`.
7. Set **Execute as** to **Me**.
8. Set **Who has access** to **Only myself**.
9. Deploy and save the `/exec` URL privately.

Never publish the deployment URL in the repository, screenshots, support tickets, or public documentation.

## Complete onboarding

Open the private deployment URL and:

1. Add a primary recipient and optional additional recipients.
2. Choose a monitoring interval and active window.
3. Choose Full AI, Summary only, or Keyword mode.
4. When AI is enabled, paste a dedicated Gemini Developer API key.
5. Save the dashboard. A new key is verified before it is stored.
6. Send a test email.
7. Test the Gemini connection when AI is enabled.
8. Run **Check now**.

The first save creates exactly one hourly installable trigger. The handler enforces the selected interval and active hours before doing network work.

## Upgrade an existing deployment

1. Replace `Code.gs` and add `WebApp.gs` and `Index.html`.
2. Create a new deployment version; do not rely only on the editor's latest code.
3. Open the existing `/exec` URL or the new deployment URL.
4. Review imported settings and save once.

The migration preserves the primary recipient, Gemini key, processed issues, and analysis cache. Saving replaces the previous fixed trigger set with one hourly scheduler.

## Production checks

- Dashboard status is **Monitoring active**.
- Scheduler health reports one trigger.
- The test email arrives at every saved recipient.
- Gemini verification succeeds when AI is enabled.
- **Check now** records a successful activity event.
- The remaining email quota is adequate for the recipient count.
- The Apps Script project has no untrusted editors.
- The deployment is not anonymous or shared broadly.

## Troubleshooting

### Setup required remains visible

Enter a valid primary recipient. If AI is enabled, save a valid Gemini Developer API key. Keyword mode requires no key.

### Scheduler needs attention

Open **Advanced maintenance** and select **Repair monitoring schedule**. Ownership changes do not transfer installable triggers; the new owner must repair them.

### No email arrives

Use **Send test email**, check spam, and review the remaining recipient quota. MailApp cannot confirm delivery or detect bounces.

### Gemini verification fails

Confirm that the key belongs to a project with the Gemini API available, is restricted appropriately, and has remaining quota. AI Pro subscription status does not replace Developer API access.

### A publication was not emailed

Review the delivery policy and filters. **Only confirmed matches or notices requiring review** intentionally suppresses unrelated publications. Keyword mode can miss titles that do not identify an academic institution clearly.

### Settings saved but the schedule did not update

Settings remain stored. Use **Repair monitoring schedule** and inspect Apps Script **Executions** for authorization or trigger errors.

## Rollback

Apps Script deployments are versioned. Select a previous deployment version to roll back application code. Settings and runtime properties are not versioned with deployments; export or record important preferences before a major migration.
