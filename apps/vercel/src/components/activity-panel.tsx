import type { ActivityItem, DashboardData } from "./dashboard-contract";
import { Icon, SectionHeading, StatusPill } from "./ui";

function formatTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function tone(status: ActivityItem["status"]) {
  if (status === "success") return "success" as const;
  if (status === "warning") return "warning" as const;
  if (status === "error") return "danger" as const;
  return "neutral" as const;
}

function titleForType(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ActivityPanel({ dashboard }: { dashboard: DashboardData }) {
  const errors = dashboard.activity.filter((item) => item.status === "error").length;
  const warnings = dashboard.activity.filter((item) => item.status === "warning").length;

  return (
    <div className="page-stack activity-page">
      <SectionHeading
        eyebrow="Operations log"
        title="Activity and audit history"
        description="A secret-safe record of checks, deliveries, configuration changes, and recoverable problems."
        action={<StatusPill tone={errors ? "danger" : warnings ? "warning" : "success"}>{errors ? `${errors} error${errors === 1 ? "" : "s"}` : warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "No active errors"}</StatusPill>}
      />

      <section className="activity-summary" aria-label="Activity summary">
        <div><small>Events shown</small><strong>{dashboard.activity.length}</strong></div>
        <div><small>Scheduler</small><strong>{dashboard.status.scheduler}</strong></div>
        <div><small>Time zone</small><strong>{dashboard.app.timeZone}</strong></div>
        <div><small>Retention</small><strong>Recent events</strong></div>
      </section>

      <section className="card activity-card" aria-labelledby="activity-log-title">
        <div className="card__header">
          <div><span className="eyebrow">Newest first</span><h2 id="activity-log-title">Operational events</h2></div>
          <p>Secrets and full recipient addresses are never written to this view.</p>
        </div>
        {dashboard.activity.length ? (
          <ol className="timeline">
            {dashboard.activity.map((item) => (
              <li key={item.id} className={`timeline__item timeline__item--${item.status}`}>
                <span className="timeline__marker" aria-hidden="true">
                  <Icon name={item.status === "success" ? "check" : item.status === "info" ? "activity" : "warning"} />
                </span>
                <div className="timeline__body">
                  <div>
                    <strong>{titleForType(item.type)}</strong>
                    <StatusPill tone={tone(item.status)}>{item.status}</StatusPill>
                  </div>
                  <p>{item.message}</p>
                  <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt, dashboard.app.timeZone)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state empty-state--large">
            <span><Icon name="activity" /></span>
            <strong>Your audit trail is ready</strong>
            <p>Events will appear after you save settings, run a check, or test a connection.</p>
          </div>
        )}
      </section>

      <aside className="retention-note">
        <Icon name="warning" />
        <p><strong>Need deeper diagnostics?</strong> This screen is intentionally concise. Deployment owners can use Vercel runtime logs and provider dashboards for infrastructure-level troubleshooting.</p>
      </aside>
    </div>
  );
}
