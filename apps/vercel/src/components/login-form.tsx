"use client";

import { useEffect, useState } from "react";

import {
  DashboardApiError,
  requestJson,
  type SessionData,
  type SessionMutationResult,
} from "./dashboard-contract";
import { BrandMark, Button, Icon, TextInput } from "./ui";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    requestJson<SessionData>("/api/session", {}, controller.signal)
      .then((session) => {
        if (session.authenticated) {
          window.location.replace("/");
          return;
        }
        setChecking(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setChecking(false);
        if (requestError instanceof DashboardApiError && requestError.status >= 500) {
          setError("Secure sign-in is temporarily unavailable. Please try again shortly.");
        }
      });
    return () => controller.abort();
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await requestJson<SessionMutationResult>("/api/session", {
        method: "POST",
        body: JSON.stringify({ action: "sign_in", password }),
      });
      if (result.authenticated) {
        window.location.replace("/");
        return;
      }
      if (!result.authenticated) {
        setError("The password was not accepted.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof DashboardApiError
          ? requestError.message
          : "Sign-in could not be started. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="login-page">
      <section className="login-story" aria-label="Product introduction">
        <div className="login-story__inner">
          <BrandMark />
          <div className="login-story__copy">
            <span className="eyebrow eyebrow--light">Private cloud edition</span>
            <h1>Important notices,<br />without the daily search.</h1>
            <p>
              Monitor the Turkish Official Gazette, prioritize academic vacancies, and receive a
              concise, source-linked email report on your schedule.
            </p>
          </div>
          <div className="login-proof" aria-label="Product capabilities">
            <div>
              <span className="login-proof__icon"><Icon name="check" /></span>
              <span><strong>Official sources</strong><small>Regular and supplemental issues</small></span>
            </div>
            <div>
              <span className="login-proof__icon"><Icon name="spark" /></span>
              <span><strong>AI is optional</strong><small>Full, summary, or keyword analysis</small></span>
            </div>
            <div>
              <span className="login-proof__icon"><Icon name="mail" /></span>
              <span><strong>Actionable delivery</strong><small>Structured alerts with direct links</small></span>
            </div>
          </div>
          <p className="login-story__footnote">
            Independent monitoring tool - Always verify the official publication
          </p>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel__inner">
          <span className="login-panel__edition">Vercel edition</span>
          <h2 id="login-title">Welcome back</h2>
          <p>Enter the private owner password configured for this deployment.</p>

          <form className="login-form" onSubmit={signIn}>
            <label className="field">
              <span className="field__label">Owner password</span>
              <span className="secret-input">
                <TextInput
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your deployment password"
                  autoComplete="current-password"
                  required
                  minLength={12}
                  disabled={checking || busy}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={checking || busy}
                >
                  <Icon name="eye" />
                </button>
              </span>
            </label>
            {error ? (
              <p className="form-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" tone="primary" busy={busy} disabled={checking || password.length < 12}>
              {checking ? "Checking session..." : "Open private dashboard"}
            </Button>
            <p className="login-form__privacy">
              The password is verified server-side and is never stored in browser storage. The
              session uses a private, HTTP-only cookie.
            </p>
          </form>

          <aside className="edition-note">
            <Icon name="warning" />
            <p>
              <strong>Your two editions stay independent.</strong>
              Signing in here does not read or change settings in a Google Apps Script deployment.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
