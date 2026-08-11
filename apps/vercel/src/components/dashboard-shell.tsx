"use client";

import { useEffect, useMemo, useState } from "react";

import { ActivityPanel } from "./activity-panel";
import {
  DashboardApiError,
  requestJson,
  type DashboardData,
  type DashboardMutationResult,
  type DashboardSettings,
  type SaveSettingsRequest,
  type SecretMutation,
  type SessionData,
  type SessionMutationResult,
} from "./dashboard-contract";
import { OverviewPanel } from "./overview-panel";
import { SettingsPanel, validateSettings, type SettingsErrors } from "./settings-panel";
import { BrandMark, Button, Icon, LoadingScreen, StatusPill, type IconName } from "./ui";

type View = "overview" | "settings" | "activity";
type PendingAction = "run" | "email" | "ai" | "save" | "logout" | null;

const navigation: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "activity", label: "Activity", icon: "activity" },
];

function copySettings(settings: DashboardSettings): DashboardSettings {
  return JSON.parse(JSON.stringify(settings)) as DashboardSettings;
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof DashboardApiError) return error.message;
  return fallback;
}

function secretMutation(value: string, remove: boolean): SecretMutation {
  if (remove) return { action: "remove" };
  if (value.trim()) return { action: "replace", value: value.trim() };
  return { action: "preserve" };
}

function settingsErrorsFromApi(fieldErrors?: Record<string, string>): SettingsErrors {
  if (!fieldErrors) return {};
  const mapped: SettingsErrors = {};
  const fieldMap: Record<string, keyof SettingsErrors> = {
    "settings.primaryRecipient": "primaryRecipient",
    "settings.additionalRecipients": "additionalRecipients",
    "settings.senderName": "senderName",
    "settings.senderEmail": "senderEmail",
    "settings.checkIntervalHours": "checkIntervalHours",
    "settings.activeStartHour": "activeHours",
    "settings.activeEndHour": "activeHours",
    "settings.customModel": "customModel",
    "geminiApiKey.value": "geminiKey",
    "resendApiKey.value": "resendKey",
  };
  Object.entries(fieldErrors).forEach(([path, message]) => {
    const direct = fieldMap[path];
    const nested = Object.entries(fieldMap).find(([prefix]) => path.startsWith(`${prefix}.`))?.[1];
    if (direct || nested) mapped[direct || nested!] = message;
  });
  return mapped;
}

export function DashboardShell() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [baseline, setBaseline] = useState<DashboardSettings | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [removeGeminiKey, setRemoveGeminiKey] = useState(false);
  const [resendKey, setResendKey] = useState("");
  const [removeResendKey, setRemoveResendKey] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [toast, setToast] = useState<{ tone: "success" | "danger"; message: string } | null>(
    null,
  );

  const dirty = useMemo(() => {
    if (!settings || !baseline) return false;
    return (
      JSON.stringify(settings) !== JSON.stringify(baseline) ||
      Boolean(geminiKey.trim()) ||
      removeGeminiKey ||
      Boolean(resendKey.trim()) ||
      removeResendKey
    );
  }, [settings, baseline, geminiKey, removeGeminiKey, resendKey, removeResendKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");

    Promise.all([
      requestJson<SessionData>("/api/session", {}, controller.signal),
      requestJson<DashboardData>("/api/dashboard", {}, controller.signal),
    ])
      .then(([session, loadedDashboard]) => {
        if (!session.authenticated) {
          window.location.replace("/login");
          return;
        }
        setDashboard(loadedDashboard);
        setSettings(copySettings(loadedDashboard.settings));
        setBaseline(copySettings(loadedDashboard.settings));
        if (loadedDashboard.status.state === "setup") setView("settings");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DashboardApiError && error.status === 401) {
          window.location.replace("/login");
          return;
        }
        setLoadError(readableError(error, "Your workspace could not be loaded."));
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    function confirmNavigation(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", confirmNavigation);
    return () => window.removeEventListener("beforeunload", confirmNavigation);
  }, [dirty]);

  function updateSettings(next: DashboardSettings) {
    setSettings(next);
    if (Object.keys(errors).length) {
      setErrors(
        validateSettings(
          next,
          dashboard?.plan,
          removeGeminiKey,
          Boolean(geminiKey.trim()) || Boolean(dashboard?.secrets.geminiApiKey.configured),
          removeResendKey,
          Boolean(resendKey.trim()) || Boolean(dashboard?.secrets.resendApiKey.configured),
          geminiKey,
          resendKey,
        ),
      );
    }
  }

  function applyServerDashboard(next: DashboardData, preserveDraft: boolean) {
    setDashboard(next);
    if (!preserveDraft) {
      const nextSettings = copySettings(next.settings);
      setSettings(nextSettings);
      setBaseline(copySettings(nextSettings));
      setGeminiKey("");
      setRemoveGeminiKey(false);
      setResendKey("");
      setRemoveResendKey(false);
      setErrors({});
    }
  }

  async function saveSettings() {
    if (!dashboard || !settings) return;
    const nextErrors = validateSettings(
      settings,
      dashboard.plan,
      removeGeminiKey,
      Boolean(geminiKey.trim()) || dashboard.secrets.geminiApiKey.configured,
      removeResendKey,
      Boolean(resendKey.trim()) || dashboard.secrets.resendApiKey.configured,
      geminiKey,
      resendKey,
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setView("settings");
      setToast({ tone: "danger", message: "Review the highlighted settings before saving." });
      return;
    }

    setPending("save");
    try {
      const payload: SaveSettingsRequest = {
        expectedRevision: dashboard.revision,
        settings,
        geminiApiKey: secretMutation(geminiKey, removeGeminiKey),
        resendApiKey: secretMutation(resendKey, removeResendKey),
      };
      const result = await requestJson<DashboardMutationResult>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      applyServerDashboard(result.dashboard, false);
      setToast({ tone: "success", message: result.detail || "Settings saved successfully." });
    } catch (error) {
      if (error instanceof DashboardApiError && error.code === "REVISION_CONFLICT") {
        setToast({
          tone: "danger",
          message: "Settings changed elsewhere. Refresh the page before saving again.",
        });
      } else {
        if (error instanceof DashboardApiError) {
          const apiErrors = settingsErrorsFromApi(error.fieldErrors);
          if (error.code === "GEMINI_TEST_FAILED") {
            apiErrors.geminiKey = error.message;
          }
          if (error.code === "RESEND_TEST_FAILED") {
            apiErrors.resendKey = error.message;
          }
          if (Object.keys(apiErrors).length) {
            setErrors(apiErrors);
            setView("settings");
          }
        }
        setToast({ tone: "danger", message: readableError(error, "Settings could not be saved.") });
      }
    } finally {
      setPending(null);
    }
  }

  function discardChanges() {
    if (!baseline) return;
    setSettings(copySettings(baseline));
    setGeminiKey("");
    setRemoveGeminiKey(false);
    setResendKey("");
    setRemoveResendKey(false);
    setErrors({});
    setToast({ tone: "success", message: "Unsaved changes were discarded." });
  }

  async function runAction(action: Exclude<PendingAction, "save" | "logout" | null>) {
    if (!dashboard) return;
    const paths = {
      run: "/api/actions/run-now",
      email: "/api/actions/test-email",
      ai: "/api/actions/test-ai",
    } as const;
    setPending(action);
    try {
      const body =
        action === "run"
          ? { force: false }
          : action === "ai" && geminiKey.trim()
            ? { replacementKey: geminiKey.trim() }
            : {};
      const result = await requestJson<DashboardMutationResult>(paths[action], {
        method: "POST",
        body: JSON.stringify(body),
      });
      applyServerDashboard(result.dashboard, dirty);
      const defaults = {
        run: "The Official Gazette check completed.",
        email: "Test email sent successfully.",
        ai: "Gemini connection verified.",
      };
      setToast({ tone: "success", message: result.detail || defaults[action] });
    } catch (error) {
      setToast({
        tone: "danger",
        message: readableError(error, "The requested action could not be completed."),
      });
    } finally {
      setPending(null);
    }
  }

  async function signOut() {
    if (dirty && !window.confirm("Discard your unsaved changes and sign out?")) return;
    setPending("logout");
    try {
      await requestJson<SessionMutationResult>("/api/session", {
        method: "POST",
        body: JSON.stringify({ action: "sign_out" }),
      });
      window.location.replace("/login");
    } catch (error) {
      setToast({ tone: "danger", message: readableError(error, "You could not be signed out.") });
      setPending(null);
    }
  }

  if (loading) return <LoadingScreen />;

  if (loadError || !dashboard || !settings || !baseline) {
    return (
      <main id="main-content" className="fatal-state">
        <BrandMark />
        <span className="fatal-state__icon"><Icon name="warning" /></span>
        <h1>We could not open your workspace.</h1>
        <p>{loadError || "The dashboard returned incomplete data."}</p>
        <Button tone="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </main>
    );
  }

  const ownerInitial = (dashboard.owner.name || dashboard.owner.email || "Private owner").trim().charAt(0);
  const stateTone =
    dashboard.status.state === "healthy"
      ? "success"
      : dashboard.status.state === "attention" || dashboard.status.state === "setup"
        ? "warning"
        : "neutral";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand"><BrandMark /></div>
        <nav className="sidebar__nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? "is-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "settings" && dirty ? <i aria-label="Unsaved settings" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar__source">
          <span className="sidebar__source-mark">RG</span>
          <div><strong>Official source</strong><small>resmigazete.gov.tr</small></div>
          <a
            href={dashboard.app.officialSource}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the Official Gazette website in a new tab"
          ><Icon name="external" /></a>
        </div>
        <div className="sidebar__owner">
          <span className="avatar" aria-hidden="true">{ownerInitial.toUpperCase()}</span>
          <div><strong>{dashboard.owner.name || "Private owner"}</strong><small>{dashboard.owner.email || "Single-owner deployment"}</small></div>
          <button type="button" onClick={signOut} aria-label="Sign out" disabled={pending === "logout"}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand"><BrandMark compact /></div>
          <div className="topbar__title">
            <span className="eyebrow">Private Vercel edition</span>
            <h1>{navigation.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="topbar__actions">
            <StatusPill tone={stateTone}>{dashboard.status.label}</StatusPill>
            <Button
              tone="primary"
              busy={pending === "run"}
              onClick={() => runAction("run")}
              disabled={pending !== null || dirty}
              title={dirty ? "Save or discard changes before running a check" : undefined}
            >
              <Icon name="run" /> Run now
            </Button>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? "is-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "settings" && dirty ? <i aria-hidden="true" /> : null}
            </button>
          ))}
        </nav>

        <main id="main-content" className="workspace__main">
          <aside className="independent-banner">
            <span><Icon name="warning" /></span>
            <p>
              <strong>This cloud edition has independent settings and history.</strong>
              Changes here do not affect a Google Apps Script installation, and its triggers do not
              control this deployment.
            </p>
          </aside>

          {view === "overview" ? (
            <OverviewPanel
              dashboard={dashboard}
              pending={pending}
              dirty={dirty}
              onNavigate={setView}
              onAction={runAction}
            />
          ) : null}
          {view === "settings" ? (
            <SettingsPanel
              dashboard={dashboard}
              settings={settings}
              errors={errors}
              geminiKey={geminiKey}
              removeGeminiKey={removeGeminiKey}
              resendKey={resendKey}
              removeResendKey={removeResendKey}
              pending={pending}
              onSettingsChange={updateSettings}
              onGeminiKeyChange={(value) => {
                setGeminiKey(value);
                if (value) setRemoveGeminiKey(false);
                if (errors.geminiKey) setErrors((current) => ({ ...current, geminiKey: undefined }));
              }}
              onRemoveGeminiKeyChange={(value) => {
                setRemoveGeminiKey(value);
                if (value) setGeminiKey("");
              }}
              onResendKeyChange={(value) => {
                setResendKey(value);
                if (value) setRemoveResendKey(false);
                if (errors.resendKey) setErrors((current) => ({ ...current, resendKey: undefined }));
              }}
              onRemoveResendKeyChange={(value) => {
                setRemoveResendKey(value);
                if (value) setResendKey("");
              }}
              onAction={runAction}
            />
          ) : null}
          {view === "activity" ? <ActivityPanel dashboard={dashboard} /> : null}
        </main>
      </div>

      {dirty ? (
        <div className="save-dock" role="region" aria-label="Unsaved changes">
          <div><span aria-hidden="true" /><p><strong>Unsaved changes</strong><small>Review and publish your new configuration.</small></p></div>
          <div>
            <Button tone="quiet" onClick={discardChanges} disabled={pending !== null}>Discard</Button>
            <Button tone="primary" onClick={saveSettings} busy={pending === "save"} disabled={pending !== null && pending !== "save"}>
              Save settings
            </Button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className={`toast toast--${toast.tone}`} role={toast.tone === "danger" ? "alert" : "status"}>
          <span><Icon name={toast.tone === "success" ? "check" : "warning"} /></span>
          <p>{toast.message}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">{"\u00d7"}</button>
        </div>
      ) : null}
    </div>
  );
}
