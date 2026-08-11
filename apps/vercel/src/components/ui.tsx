import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "quiet" | "danger";
  busy?: boolean;
};

export function Button({
  tone = "secondary",
  busy = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${tone} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <span className="button__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`.trim()}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M8.4 5.5h10.8l4.4 4.4v16.6H8.4z" />
          <path d="M19.2 5.5v4.8h4.4M12 14h8M12 18h8M12 22h5" />
        </svg>
      </span>
      <span className="brand__copy">
        <strong>Gazette Monitor</strong>
        <small>Academic alerts</small>
      </span>
    </span>
  );
}

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </>
    ),
    activity: (
      <>
        <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
        <path d="M4 4v4.6h4.6M12 8v4l3 2" />
      </>
    ),
    run: <path d="m8 5 11 7-11 7z" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9z" />
        <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
      </>
    ),
    external: (
      <>
        <path d="M13 5h6v6M19 5l-9 9" />
        <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
        <path d="m15 8 4 4-4 4M19 12H9" />
      </>
    ),
    check: <path d="m5 12 4 4L19 7" />,
    warning: (
      <>
        <path d="M12 3 2.8 20h18.4z" />
        <path d="M12 9v5M12 17.3v.2" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export type IconName =
  | "overview"
  | "settings"
  | "activity"
  | "run"
  | "mail"
  | "spark"
  | "external"
  | "logout"
  | "check"
  | "warning"
  | "eye";

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch-row ${disabled ? "is-disabled" : ""}`.trim()}>
      <span className="switch-row__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </span>
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  optional = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? "field--error" : ""}`.trim()}>
      <span className="field__label">
        {label}
        {optional ? <small>Optional</small> : null}
      </span>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "neutral" | "brand";
  children: ReactNode;
}) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <BrandMark />
      <span className="loading-screen__bar" aria-hidden="true">
        <span />
      </span>
      <p>Preparing your private workspace...</p>
    </div>
  );
}
