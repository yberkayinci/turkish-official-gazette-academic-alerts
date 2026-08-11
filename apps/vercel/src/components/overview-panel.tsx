import type { DashboardData } from "./dashboard-contract";
import { Button, Icon, SectionHeading, StatusPill } from "./ui";

type Action = "run" | "email" | "ai";
type PendingAction = Action | "save" | "logout" | null;

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return "Not yet available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function relativeTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const delta = date.getTime() - Date.now();
  const absoluteMinutes = Math.abs(delta) / 60000;
  if (absoluteMinutes < 1) return "Just now";
  if (absoluteMinutes < 60) {
    const count = Math.round(absoluteMinutes);
    return delta < 0 ? `${count} min ago` : `in ${count} min`;
  }
  const absoluteHours = absoluteMinutes / 60;
  if (absoluteHours < 24) {
    const count = Math.round(absoluteHours);
    return delta < 0 ? `${count} hr ago` : `in ${count} hr`;
  }
  return formatDate(value, timeZone);
}

function activityTone(status: DashboardData["activity"][number]["status"]) {
  if (status === "success") return "success" as const;
  if (status === "warning") return "warning" as const;
  if (status === "error") return "danger" as const;
  return "neutral" as const;
}

export function OverviewPanel({
  dashboard,
  pending,
  dirty,
  onNavigate,
  onAction,
}: {
  dashboard: DashboardData;
  pending: PendingAction;
  dirty: boolean;
  onNavigate: (view: "overview" | "settings" | "activity") => void;
  onAction: (action: Action) => void;
}) {
  const { settings, status, plan, secrets } = dashboard;
  const setupItems = [
    {
      label: "Email delivery",
      complete:
        Boolean(settings.primaryRecipient) &&
        Boolean(settings.senderEmail) &&
        secrets.resendApiKey.configured,
      action: "Review email",
    },
    {
      label: "Monitoring schedule",
      complete: settings.monitoringEnabled && plan.allowedIntervals.includes(settings.checkIntervalHours),
      action: "Review schedule",
    },
    {
      label: settings.aiMode === "off" ? "Keyword analysis selected" : "Gemini connection",
      complete: settings.aiMode === "off" || secrets.geminiApiKey.configured,
      action: "Review analysis",
    },
  ];
  const completeCount = setupItems.filter((item) => item.complete).length;
  const setupPercent = Math.round((completeCount / setupItems.length) * 100);
  const analysisLabel =
    settings.aiMode === "full"
      ? "Full AI"
      : settings.aiMode === "summary"
        ? "AI summary"
        : "Keyword mode";

  return (
    <div className="page-stack overview-page">
      <SectionHeading
        eyebrow="Operations"
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}.`}
        description="Your monitor is watching the Official Gazette and will report according to the delivery rules below."
      />

      <section className="hero-status" aria-labelledby="monitor-health-title">
        <div className={`hero-status__signal hero-status__signal--${status.state}`} aria-hidden="true">
          <span /><i /><i />
        </div>
        <div className="hero-status__copy">
          <span className="eyebrow">Monitor health</span>
          <h2 id="monitor-health-title">{status.label}</h2>
          <p>{status.message}</p>
          <div className="hero-status__meta">
            <span><small>Next check</small><strong>{formatDate(status.nextRunAt, dashboard.app.timeZone)}</strong></span>
            <span><small>Schedule</small><strong>Every {settings.checkIntervalHours} hour{settings.checkIntervalHours === 1 ? "" : "s"}</strong></span>
            <span><small>Time zone</small><strong>{dashboard.app.timeZone}</strong></span>
          </div>
        </div>
        <div className="hero-status__action">
          <Button
            tone="primary"
            busy={pending === "run"}
            disabled={pending !== null || dirty}
            onClick={() => onAction("run")}
          ><Icon name="run" /> Check now</Button>
          <small>{dirty ? "Save or discard changes first" : "Safe deduplication remains active"}</small>
        </div>
      </section>

      <section className="metric-grid" aria-label="Monitoring summary">
        <article className="metric-card">
          <span className="metric-card__icon metric-card__icon--green"><Icon name="activity" /></span>
          <div><small>Last completed check</small><strong>{formatDate(status.lastRunAt, dashboard.app.timeZone)}</strong><p>{status.lastRunOutcome === "never" ? "Waiting for the first run" : status.lastRunOutcome}</p></div>
        </article>
        <article className="metric-card">
          <span className="metric-card__icon metric-card__icon--amber"><Icon name="overview" /></span>
          <div><small>Processed publications</small><strong>{status.processedPublicationCount.toLocaleString("en-US")}</strong><p>Deduplicated official issues</p></div>
        </article>
        <article className="metric-card">
          <span className="metric-card__icon metric-card__icon--blue"><Icon name="spark" /></span>
          <div><small>Analysis</small><strong>{analysisLabel}</strong><p>{settings.aiMode === "off" ? "No AI key required" : secrets.geminiApiKey.configured ? `Key from ${secrets.geminiApiKey.source}` : "Key required"}</p></div>
        </article>
        <article className="metric-card">
          <span className="metric-card__icon metric-card__icon--violet"><Icon name="mail" /></span>
          <div><small>Last confirmed matches</small><strong>{status.lastMatchCount}</strong><p>{settings.deliveryPolicy === "matches_only" ? "Email only when relevant" : "Every published issue"}</p></div>
        </article>
      </section>

      <div className="overview-columns">
        <section className="card setup-card" aria-labelledby="setup-title">
          <div className="card__header">
            <div><span className="eyebrow">Readiness</span><h2 id="setup-title">Deployment setup</h2></div>
            <span className="setup-card__score">{setupPercent}%</span>
          </div>
          <div className="progress" aria-label={`${setupPercent}% of setup complete`}>
            <span style={{ width: `${setupPercent}%` }} />
          </div>
          <ul className="checklist">
            {setupItems.map((item) => (
              <li key={item.label} className={item.complete ? "is-complete" : ""}>
                <span><Icon name={item.complete ? "check" : "warning"} /></span>
                <div><strong>{item.label}</strong><small>{item.complete ? "Ready" : "Needs attention"}</small></div>
                {!item.complete ? <button type="button" onClick={() => onNavigate("settings")}>{item.action}</button> : null}
              </li>
            ))}
          </ul>
          <Button tone="secondary" onClick={() => onNavigate("settings")}>Open all settings</Button>
        </section>

        <section className="card quick-card" aria-labelledby="quick-title">
          <div className="card__header"><div><span className="eyebrow">Diagnostics</span><h2 id="quick-title">Quick tests</h2></div></div>
          <div className="quick-actions">
            <button
              type="button"
              onClick={() => onAction("email")}
              disabled={pending !== null || dirty || !secrets.resendApiKey.configured}
            >
              <span className="quick-actions__icon quick-actions__icon--mail"><Icon name="mail" /></span>
              <span><strong>Send test email</strong><small>{secrets.resendApiKey.configured ? "Verify delivery to saved recipients" : "Add a Resend API key first"}</small></span>
              <i aria-hidden="true">{"\u2192"}</i>
            </button>
            <button
              type="button"
              onClick={() => onAction("ai")}
              disabled={pending !== null || dirty || settings.aiMode === "off" || !secrets.geminiApiKey.configured}
            >
              <span className="quick-actions__icon quick-actions__icon--ai"><Icon name="spark" /></span>
              <span><strong>Test Gemini</strong><small>{settings.aiMode === "off" ? "Enable an AI mode first" : secrets.geminiApiKey.configured ? "Confirm the configured API key" : "Add an API key first"}</small></span>
              <i aria-hidden="true">{"\u2192"}</i>
            </button>
          </div>
          <div className="plan-summary">
            <span><strong>{plan.label}</strong><small>Current Vercel plan</small></span>
            <p>{plan.commercialUse ? "Commercial deployment supported." : "Intended for personal, non-commercial use."}</p>
          </div>
        </section>
      </div>

      <section className="card recent-card" aria-labelledby="recent-title">
        <div className="card__header">
          <div><span className="eyebrow">Audit trail</span><h2 id="recent-title">Recent activity</h2></div>
          <button type="button" className="text-button" onClick={() => onNavigate("activity")}>View all <span aria-hidden="true">{"\u2192"}</span></button>
        </div>
        {dashboard.activity.length ? (
          <ul className="activity-list activity-list--compact">
            {dashboard.activity.slice(0, 5).map((item) => (
              <li key={item.id}>
                <span className={`activity-list__dot activity-list__dot--${item.status}`} aria-hidden="true" />
                <div><strong>{item.message}</strong><small>{item.type.replaceAll("_", " ")}</small></div>
                <StatusPill tone={activityTone(item.status)}>{relativeTime(item.occurredAt, dashboard.app.timeZone)}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state"><span><Icon name="activity" /></span><strong>No activity yet</strong><p>Your first check, test, or settings update will appear here.</p></div>
        )}
      </section>
    </div>
  );
}
