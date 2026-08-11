CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY CHECK (id = 'default'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  config jsonb NOT NULL,
  gemini_api_key_encrypted text,
  resend_api_key_encrypted text,
  next_run_at timestamptz,
  last_scheduled_at timestamptz,
  last_run jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS processed_publications (
  publication_key text PRIMARY KEY,
  issue_date date NOT NULL,
  source_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'processed', 'sent', 'skipped', 'failed')),
  report jsonb,
  last_error text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS processed_publications_issue_date_idx
  ON processed_publications (issue_date DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS analysis_cache (
  cache_key text PRIMARY KEY,
  source_url text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS analysis_cache_expires_at_idx ON analysis_cache (expires_at);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'warning', 'error', 'info')),
  message text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS job_leases (
  lease_name text PRIMARY KEY,
  owner_token text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_key text PRIMARY KEY,
  publication_key text NOT NULL,
  recipient_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  sending_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS deliveries_publication_key_idx ON deliveries (publication_key);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS login_attempts (
  identifier_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
