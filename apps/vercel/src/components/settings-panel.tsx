"use client";

import { useState } from "react";

import type {
  AnalysisMode,
  DashboardData,
  DashboardSettings,
  DeploymentPlan,
} from "./dashboard-contract";
import { TagInput } from "./tag-input";
import { Button, Field, Icon, SectionHeading, StatusPill, Switch, TextInput } from "./ui";

type Action = "run" | "email" | "ai";
type PendingAction = Action | "save" | "logout" | null;

export type SettingsErrors = Partial<
  Record<
    | "primaryRecipient"
    | "additionalRecipients"
    | "senderName"
    | "senderEmail"
    | "checkIntervalHours"
    | "activeHours"
    | "customModel"
    | "geminiKey"
    | "resendKey",
    string
  >
>;

const allIntervals = [1, 2, 3, 4, 6, 8, 12, 24];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSettings(
  settings: DashboardSettings,
  plan?: DeploymentPlan,
  removeGeminiKey = false,
  hasEffectiveGeminiKey = true,
  removeResendKey = false,
  hasEffectiveResendKey = true,
  geminiReplacementKey = "",
  resendReplacementKey = "",
): SettingsErrors {
  const errors: SettingsErrors = {};
  if (!emailPattern.test(settings.primaryRecipient.trim())) {
    errors.primaryRecipient = "Enter a valid primary recipient email address.";
  }
  if (
    settings.additionalRecipients.length > 2 ||
    settings.additionalRecipients.some((recipient) => !emailPattern.test(recipient.trim()))
  ) {
    errors.additionalRecipients = "Add up to two valid email addresses.";
  }
  if (
    settings.additionalRecipients.some(
      (recipient) =>
        recipient.trim().toLocaleLowerCase("en-US") ===
        settings.primaryRecipient.trim().toLocaleLowerCase("en-US"),
    )
  ) {
    errors.additionalRecipients = "Do not repeat the primary recipient.";
  }
  if (settings.senderName.trim().length < 1 || settings.senderName.trim().length > 70) {
    errors.senderName = "Sender name must be between 1 and 70 characters.";
  }
  if (!emailPattern.test(settings.senderEmail.trim())) {
    errors.senderEmail = "Enter the verified sender address configured with your email provider.";
  }
  if (plan && !plan.allowedIntervals.includes(settings.checkIntervalHours)) {
    errors.checkIntervalHours = `${plan.label} does not support this monitoring interval.`;
  }
  if (settings.activeEndHour < settings.activeStartHour) {
    errors.activeHours = "End hour must not be earlier than the start hour.";
  }
  const model = settings.customModel.trim();
  if (model.length > 100 || (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model))) {
    errors.customModel = "Use up to 100 letters, numbers, dots, underscores, or hyphens.";
  }
  if (settings.aiMode !== "off" && (removeGeminiKey || !hasEffectiveGeminiKey)) {
    errors.geminiKey = "An active Gemini API key is required for this analysis mode.";
  }
  const normalizedGeminiKey = geminiReplacementKey.trim();
  if (
    normalizedGeminiKey &&
    (normalizedGeminiKey.length < 20 ||
      normalizedGeminiKey.length > 256 ||
      /[\s\u0000-\u001f\u007f]/.test(normalizedGeminiKey))
  ) {
    errors.geminiKey = "Enter a valid Gemini Developer API key.";
  }
  if (settings.monitoringEnabled && (removeResendKey || !hasEffectiveResendKey)) {
    errors.resendKey = "Pause monitoring or configure an active Resend API key.";
  }
  const normalizedResendKey = resendReplacementKey.trim();
  if (normalizedResendKey && !/^re_[A-Za-z0-9_-]{12,}$/.test(normalizedResendKey)) {
    errors.resendKey = "Enter a valid Resend API key beginning with re_.";
  }
  return errors;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function modeCopy(mode: AnalysisMode) {
  if (mode === "full") {
    return {
      title: "Full AI analysis",
      badge: "Most capable",
      description: "Summarize headlines and inspect candidate notice PDFs for structured vacancies.",
      detail: "Best when finding research-assistant roles is the priority.",
      icon: "spark" as const,
    };
  }
  if (mode === "summary") {
    return {
      title: "AI summary only",
      badge: "Lower usage",
      description: "Use Gemini for a concise issue overview without vacancy extraction from PDFs.",
      detail: "Candidate links are kept for manual review.",
      icon: "overview" as const,
    };
  }
  return {
    title: "Keyword mode",
    badge: "No AI key",
    description: "Use deterministic filters and source links without sending documents to an AI provider.",
    detail: "Fast and private, with manual review for potential matches.",
    icon: "settings" as const,
  };
}

export function SettingsPanel({
  dashboard,
  settings,
  errors,
  geminiKey,
  removeGeminiKey,
  resendKey,
  removeResendKey,
  pending,
  onSettingsChange,
  onGeminiKeyChange,
  onRemoveGeminiKeyChange,
  onResendKeyChange,
  onRemoveResendKeyChange,
  onAction,
}: {
  dashboard: DashboardData;
  settings: DashboardSettings;
  errors: SettingsErrors;
  geminiKey: string;
  removeGeminiKey: boolean;
  resendKey: string;
  removeResendKey: boolean;
  pending: PendingAction;
  onSettingsChange: (settings: DashboardSettings) => void;
  onGeminiKeyChange: (key: string) => void;
  onRemoveGeminiKeyChange: (remove: boolean) => void;
  onResendKeyChange: (key: string) => void;
  onRemoveResendKeyChange: (remove: boolean) => void;
  onAction: (action: Action) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [showResendKey, setShowResendKey] = useState(false);
  const patch = (next: Partial<DashboardSettings>) => onSettingsChange({ ...settings, ...next });
  const keyUsable =
    settings.aiMode !== "off" &&
    !removeGeminiKey &&
    (Boolean(geminiKey.trim()) || dashboard.secrets.geminiApiKey.configured);

  return (
    <div className="page-stack settings-page">
      <SectionHeading
        eyebrow="Configuration"
        title="Monitoring settings"
        description="Control what is checked, how results are analyzed, and when your report is delivered."
        action={<StatusPill tone={settings.monitoringEnabled ? "success" : "neutral"}>{settings.monitoringEnabled ? "Monitoring enabled" : "Monitoring paused"}</StatusPill>}
      />

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">
          <a href="#email-settings"><Icon name="mail" /><span>Email delivery</span></a>
          <a href="#schedule-settings"><Icon name="activity" /><span>Schedule</span></a>
          <a href="#analysis-settings"><Icon name="spark" /><span>AI & analysis</span></a>
          <a href="#filter-settings"><Icon name="settings" /><span>Relevance filters</span></a>
          <a href="#content-settings"><Icon name="overview" /><span>Report content</span></a>
          <div className="settings-index__edition">
            <strong>{dashboard.plan.label}</strong>
            <small>{dashboard.plan.schedulePrecision}</small>
          </div>
        </nav>

        <div className="settings-sections">
          <section className="card settings-card" id="email-settings" aria-labelledby="email-settings-title">
            <div className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--mail"><Icon name="mail" /></span>
              <div><h2 id="email-settings-title">Email delivery</h2><p>Choose who receives alerts and how messages identify themselves.</p></div>
            </div>
            <div className="form-grid form-grid--two">
              <Field label="Primary recipient" error={errors.primaryRecipient} hint="The main address shown in the To field.">
                <TextInput type="email" value={settings.primaryRecipient} onChange={(event) => patch({ primaryRecipient: event.target.value })} placeholder="you@example.com" autoComplete="email" maxLength={254} />
              </Field>
              <Field label="Sender name" error={errors.senderName} hint="Displayed beside the sender address in the inbox.">
                <TextInput value={settings.senderName} onChange={(event) => patch({ senderName: event.target.value })} placeholder="Official Gazette Monitor" maxLength={70} />
              </Field>
              <TagInput
                label="Additional recipients"
                hint="Optional. Add up to two addresses; each receives a separate private copy."
                placeholder="colleague@example.com"
                values={settings.additionalRecipients}
                onChange={(values) => patch({ additionalRecipients: values })}
                maxItems={2}
                maxItemLength={254}
                inputMode="email"
                error={errors.additionalRecipients}
              />
              <Field label="Verified sender email" error={errors.senderEmail} hint="Must use a domain verified by the configured Resend account.">
                <TextInput type="email" value={settings.senderEmail} onChange={(event) => patch({ senderEmail: event.target.value })} placeholder="alerts@updates.example.com" autoComplete="email" maxLength={254} />
              </Field>
            </div>
            <div className={`secret-box secret-box--email ${removeResendKey ? "secret-box--remove" : ""}`.trim()}>
              <div className="secret-box__status">
                <span className={dashboard.secrets.resendApiKey.configured && !removeResendKey ? "is-ready" : ""}><Icon name={dashboard.secrets.resendApiKey.configured && !removeResendKey ? "check" : "warning"} /></span>
                <div>
                  <strong>Resend API key</strong>
                  <p>{removeResendKey ? "The database-stored key will be removed when you save." : dashboard.secrets.resendApiKey.configured ? `A key is configured from the ${dashboard.secrets.resendApiKey.source}. Its value is never returned to this page.` : "No Resend API key is configured for email delivery."}</p>
                </div>
                {dashboard.secrets.resendApiKey.source === "database" ? (
                  <Button tone={removeResendKey ? "quiet" : "danger"} type="button" onClick={() => onRemoveResendKeyChange(!removeResendKey)}>{removeResendKey ? "Keep key" : "Remove on save"}</Button>
                ) : null}
              </div>
              <Field label={dashboard.secrets.resendApiKey.configured ? "Replace API key" : "Add API key"} optional error={errors.resendKey} hint={dashboard.secrets.resendApiKey.source === "environment" ? "A replacement saved here overrides the environment-managed key." : "Use a send-only key restricted to your verified domain whenever possible."}>
                <div className="secret-input">
                  <TextInput type={showResendKey ? "text" : "password"} value={resendKey} onChange={(event) => onResendKeyChange(event.target.value)} placeholder={dashboard.secrets.resendApiKey.configured ? "Paste a replacement Resend key" : "re_..."} autoComplete="new-password" spellCheck={false} disabled={removeResendKey} />
                  <button type="button" onClick={() => setShowResendKey((value) => !value)} aria-label={showResendKey ? "Hide Resend API key" : "Show Resend API key"} disabled={removeResendKey}><Icon name="eye" /></button>
                </div>
              </Field>
            </div>
            <fieldset className="choice-fieldset">
              <legend>Delivery policy</legend>
              <div className="segmented-options segmented-options--two">
                <label className={settings.deliveryPolicy === "matches_only" ? "is-selected" : ""}>
                  <input type="radio" name="deliveryPolicy" value="matches_only" checked={settings.deliveryPolicy === "matches_only"} onChange={() => patch({ deliveryPolicy: "matches_only" })} />
                  <span><strong>Relevant matches only</strong><small>Reduce inbox noise; problems can still trigger alerts.</small></span>
                </label>
                <label className={settings.deliveryPolicy === "all_issues" ? "is-selected" : ""}>
                  <input type="radio" name="deliveryPolicy" value="all_issues" checked={settings.deliveryPolicy === "all_issues"} onChange={() => patch({ deliveryPolicy: "all_issues" })} />
                  <span><strong>Every published issue</strong><small>Receive a report even when no relevant item is found.</small></span>
                </label>
              </div>
            </fieldset>
            <div className="switch-grid">
              <Switch checked={settings.notifyErrors} onChange={(value) => patch({ notifyErrors: value })} label="Operational error alerts" description="Notify the saved recipients when monitoring needs attention." />
              <Switch checked={settings.notifyNoPublication} onChange={(value) => patch({ notifyNoPublication: value })} label="No-publication notices" description="Send a notice after the final eligible check finds no issue (daily Hobby check or end-of-window Pro check)." />
            </div>
            <div className="settings-card__footer">
              <p>Tests always use your currently saved recipients to prevent arbitrary email delivery.</p>
              <Button
                tone="secondary"
                busy={pending === "email"}
                disabled={pending !== null || !dashboard.secrets.resendApiKey.configured}
                title={dashboard.secrets.resendApiKey.configured ? undefined : "Save and verify a Resend API key first"}
                onClick={() => onAction("email")}
              ><Icon name="mail" /> Send test email</Button>
            </div>
          </section>

          <section className="card settings-card" id="schedule-settings" aria-labelledby="schedule-settings-title">
            <div className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--schedule"><Icon name="activity" /></span>
              <div><h2 id="schedule-settings-title">Monitoring schedule</h2><p>Set the check cadence and the hours in which scheduled work may start.</p></div>
            </div>
            <Switch checked={settings.monitoringEnabled} onChange={(value) => patch({ monitoringEnabled: value })} label="Scheduled monitoring" description="Pause safely without deleting recipients, filters, or processed history." />
            {!dashboard.plan.commercialUse || dashboard.plan.allowedIntervals.length === 1 ? (
              <aside className="plan-callout">
                <Icon name="warning" />
                <p><strong>{dashboard.plan.label} schedule limits apply.</strong> This deployment supports {dashboard.plan.allowedIntervals.map((value) => `${value}-hour`).join(", ")} monitoring. Vercel Pro is required for frequent native cron schedules and commercial use.</p>
              </aside>
            ) : null}
            <div className="form-grid form-grid--three">
              <Field label="Check frequency" error={errors.checkIntervalHours} hint={dashboard.plan.schedulePrecision}>
                <select className="select" value={settings.checkIntervalHours} onChange={(event) => patch({ checkIntervalHours: Number(event.target.value) })}>
                  {allIntervals.map((hours) => (
                    <option key={hours} value={hours} disabled={!dashboard.plan.allowedIntervals.includes(hours)}>
                      Every {hours} hour{hours === 1 ? "" : "s"}{!dashboard.plan.allowedIntervals.includes(hours) ? " - Pro required" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Active window starts" error={errors.activeHours} hint="Interpreted in Europe/Istanbul.">
                <select className="select" value={settings.activeStartHour} onChange={(event) => patch({ activeStartHour: Number(event.target.value) })}>
                  {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                </select>
              </Field>
              <Field label="Active window ends" error={errors.activeHours} hint="Must be the same as or later than the start hour.">
                <select className="select" value={settings.activeEndHour} onChange={(event) => patch({ activeEndHour: Number(event.target.value) })}>
                  {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                </select>
              </Field>
            </div>
            <div className="switch-grid">
              <Switch checked={settings.includeYesterday} onChange={(value) => patch({ includeYesterday: value })} label="Previous-day backfill" description="Recheck yesterday for late or missed publication discovery." />
              <Switch checked={settings.includeSupplements} onChange={(value) => patch({ includeSupplements: value })} label="Supplemental issues" description="Discover and process every listed supplemental publication." />
            </div>
          </section>

          <section className="card settings-card" id="analysis-settings" aria-labelledby="analysis-settings-title">
            <div className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--ai"><Icon name="spark" /></span>
              <div><h2 id="analysis-settings-title">AI and analysis</h2><p>AI is optional. Source links and manual-review fallbacks remain available in every mode.</p></div>
            </div>
            <fieldset className="choice-fieldset">
              <legend>Analysis mode</legend>
              <div className="mode-options">
                {(["full", "summary", "off"] as AnalysisMode[]).map((mode) => {
                  const copy = modeCopy(mode);
                  return (
                    <label key={mode} className={settings.aiMode === mode ? "is-selected" : ""}>
                      <input type="radio" name="aiMode" value={mode} checked={settings.aiMode === mode} onChange={() => patch({ aiMode: mode })} />
                      <span className="mode-options__radio" aria-hidden="true" />
                      <span className="mode-options__icon"><Icon name={copy.icon} /></span>
                      <span className="mode-options__copy"><span><strong>{copy.title}</strong><i>{copy.badge}</i></span><p>{copy.description}</p><small>{copy.detail}</small></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className={`secret-box ${removeGeminiKey ? "secret-box--remove" : ""}`.trim()}>
              <div className="secret-box__status">
                <span className={dashboard.secrets.geminiApiKey.configured && !removeGeminiKey ? "is-ready" : ""}><Icon name={dashboard.secrets.geminiApiKey.configured && !removeGeminiKey ? "check" : "warning"} /></span>
                <div>
                  <strong>Gemini API key</strong>
                  <p>
                    {removeGeminiKey
                      ? "The stored key will be removed when you save."
                      : dashboard.secrets.geminiApiKey.configured
                        ? `A key is configured from the ${dashboard.secrets.geminiApiKey.source}. Its value is never returned to this page.`
                        : "No Gemini key is stored for this deployment."}
                  </p>
                </div>
                {dashboard.secrets.geminiApiKey.source === "database" ? (
                  <Button tone={removeGeminiKey ? "quiet" : "danger"} type="button" onClick={() => onRemoveGeminiKeyChange(!removeGeminiKey)}>
                    {removeGeminiKey ? "Keep key" : "Remove on save"}
                  </Button>
                ) : null}
              </div>
              <Field label={dashboard.secrets.geminiApiKey.configured ? "Replace API key" : "Add API key"} optional error={errors.geminiKey} hint={dashboard.secrets.geminiApiKey.source === "environment" ? "A replacement saved here overrides the environment-managed key." : "The value is sent only to the server for verification and encrypted storage; it is never returned to the browser."}>
                <div className="secret-input">
                  <TextInput type={showKey ? "text" : "password"} value={geminiKey} onChange={(event) => onGeminiKeyChange(event.target.value)} placeholder={dashboard.secrets.geminiApiKey.configured ? "Paste a new key to replace the stored key" : "Paste your Gemini Developer API key"} autoComplete="new-password" spellCheck={false} disabled={removeGeminiKey} />
                  <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Hide API key" : "Show API key"} disabled={removeGeminiKey}><Icon name="eye" /></button>
                </div>
              </Field>
              <div className="secret-box__actions">
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a Gemini Developer API key <Icon name="external" /></a>
                <Button tone="secondary" busy={pending === "ai"} disabled={pending !== null || !keyUsable} onClick={() => onAction("ai")}><Icon name="spark" /> Test connection</Button>
              </div>
            </div>
            <aside className="privacy-note"><Icon name="warning" /><p><strong>Google AI Pro is not an API subscription.</strong> AI modes require a separate Gemini Developer API key and consume that API project&apos;s quota. Keyword mode needs no key.</p></aside>
            <div className="form-grid form-grid--two form-grid--advanced">
              <Field label="Model override" optional error={errors.customModel} hint="Leave empty to use the stable model selected by this release.">
                <TextInput value={settings.customModel} onChange={(event) => patch({ customModel: event.target.value })} placeholder="Default stable model" autoComplete="off" disabled={settings.aiMode === "off"} maxLength={100} />
              </Field>
              <div className="inline-switch"><Switch checked={settings.summarizeHeadlines} onChange={(value) => patch({ summarizeHeadlines: value })} label="AI headline summary" description="Generate concise highlights before detailed results." disabled={settings.aiMode === "off"} /></div>
            </div>
          </section>

          <section className="card settings-card" id="filter-settings" aria-labelledby="filter-settings-title">
            <div className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--filter"><Icon name="settings" /></span>
              <div><h2 id="filter-settings-title">Relevance filters</h2><p>Guide prioritization without hiding the official source links needed for verification.</p></div>
            </div>
            <div className="tag-field-stack">
              <TagInput label="Required keywords" hint="At least one of these terms should appear in a candidate item. Press Enter or comma to add." placeholder={"research assistant, ara\u015ft\u0131rma g\u00f6revlisi..."} values={settings.requiredKeywords} onChange={(values) => patch({ requiredKeywords: values })} />
              <TagInput label="Preferred institutions" hint="Matches are promoted in reports; this does not replace required-keyword rules." placeholder={"Ankara University, T\u00dcB\u0130TAK..."} values={settings.preferredInstitutions} onChange={(values) => patch({ preferredInstitutions: values })} />
              <TagInput label="Excluded keywords" hint="Use carefully. Corrections or cancellations may still be retained when their options are enabled." placeholder="professor, tender..." values={settings.excludedKeywords} onChange={(values) => patch({ excludedKeywords: values })} />
            </div>
          </section>

          <section className="card settings-card" id="content-settings" aria-labelledby="content-settings-title">
            <div className="settings-card__header">
              <span className="settings-card__icon settings-card__icon--content"><Icon name="overview" /></span>
              <div><h2 id="content-settings-title">Report content</h2><p>Decide which context and uncertain items remain visible in each email.</p></div>
            </div>
            <div className="switch-grid switch-grid--content">
              <Switch checked={settings.includeHeadlines} onChange={(value) => patch({ includeHeadlines: value })} label="Published headlines" description="Include the issue index before matched notices." />
              <Switch checked={settings.includeCorrections} onChange={(value) => patch({ includeCorrections: value })} label="Corrections" description="Keep notices that may change an earlier vacancy." />
              <Switch checked={settings.includeCancellations} onChange={(value) => patch({ includeCancellations: value })} label="Cancellations" description="Keep cancellation notices for positions you may follow." />
              <Switch checked={settings.includeUncertain} onChange={(value) => patch({ includeUncertain: value })} label="Uncertain candidates" description="Include manual-review links when analysis cannot conclude safely." />
            </div>
          </section>

          <aside className="settings-boundary">
            <div><Icon name="warning" /></div>
            <p><strong>Independent edition boundary</strong>This Vercel deployment uses its own database, scheduler, email provider, and encrypted secrets. To avoid duplicate email, pause one edition if both monitor the same recipients.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
