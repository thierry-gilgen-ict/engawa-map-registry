-- Engawa Distribution Map registry — initial schema (DM2A)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  packages JSONB NOT NULL,
  hints JSONB,
  state TEXT NOT NULL,
  token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listed_at TIMESTAMPTZ,
  delisted_at TIMESTAMPTZ,
  CONSTRAINT sites_state_check CHECK (state IN ('PENDING', 'LISTED', 'DELISTED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sites_canonical_url_active_idx
  ON sites (canonical_url)
  WHERE state <> 'DELISTED';

CREATE INDEX IF NOT EXISTS sites_listed_public_idx
  ON sites (listed_at ASC, id ASC)
  WHERE state = 'LISTED';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
  ON idempotency_keys (expires_at);
