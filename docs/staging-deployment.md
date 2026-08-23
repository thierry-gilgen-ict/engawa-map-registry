# Staging deployment runbook (DM2B)

Operator runbook for the Engawa Distribution Map registry staging environment.

```text
STAGING_HOSTNAME=staging-engawa-map.thierry-gilgen-ict.ch
DNS_CONTROL_AVAILABLE=NO
STAGING_HOST_AVAILABLE=NO
BLOCKER=No VM/DNS/SSH provisioning access from CI or this workspace. Artifacts only until an operator deploys manually.
```

## Overview

| Item       | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Hostname   | `staging-engawa-map.thierry-gilgen-ict.ch`                                   |
| Edge       | Traefik v3 (file provider, no Docker socket)                                 |
| App        | Node 24 Fastify registry (`registry` service)                                |
| Database   | PostgreSQL 18 (`postgres` service, backend network only)                     |
| Migrations | One-shot `migrate` service (`node dist/migrate.js`) — **not** on app startup |
| TLS        | Let's Encrypt HTTP-01 via Traefik                                            |

## Architecture

```text
Internet ──► Traefik (proxy:80/443) ──► registry:3000 (proxy + backend)
                                              │
                                              └──► postgres:5432 (backend only, internal network)
```

Networks:

- **proxy** — Traefik and registry (public edge to app)
- **backend** — registry, postgres, migrate (`internal: true`; no outbound internet)

No host ports are published for `registry` or `postgres`. Only Traefik exposes `80` and `443`.

## Host prerequisites

1. Linux VM with Docker Engine and Compose v2
2. DNS `A`/`AAAA` for `staging-engawa-map.thierry-gilgen-ict.ch` → VM public IP
3. Firewall: allow inbound `80/tcp`, `443/tcp` only; deny direct access to app/db ports
4. Clone this repository to e.g. `/opt/engawa-map-registry`
5. Checkout the release tag or `main` commit to deploy

## First-time deploy

```bash
cd /opt/engawa-map-registry/deploy/staging
cp .env.example .env
# Edit .env: strong POSTGRES_PASSWORD, real ACME_EMAIL, verify DATABASE_URL matches postgres creds
chmod 600 .env

docker compose build
docker compose up -d
```

Startup order:

1. `postgres` becomes healthy
2. `migrate` runs once and exits successfully
3. `registry` starts (depends on migrate success)
4. `traefik` routes HTTPS traffic

Verify:

```bash
curl -fsS https://staging-engawa-map.thierry-gilgen-ict.ch/healthz
curl -fsS https://staging-engawa-map.thierry-gilgen-ict.ch/readyz
```

Expected: `{"status":"ok"}` and `{"status":"ready"}`.

## Migrations

Migrations run **only** via the explicit migrate path:

- Local: `pnpm db:migrate` → `node dist/migrate.js`
- Staging: `migrate` Compose service

The registry app does **not** auto-migrate on startup (DM2B).

After pulling schema changes:

```bash
docker compose run --rm migrate
docker compose up -d registry
```

## TLS

Traefik obtains certificates via Let's Encrypt HTTP-01 on port 80 (redirects to HTTPS).

- ACME email: `ACME_EMAIL` in `.env`
- Storage: `traefik_acme` Docker volume (`acme.json`)
- HSTS: enabled for the staging hostname only (`includeSubDomains` and `preload` are **off**)

## Edge security (Traefik)

| Control          | Setting                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP → HTTPS     | Entrypoint redirect on `web`                                                                                                                    |
| Body limit       | 16 KiB (`buffering.maxRequestBodyBytes`)                                                                                                        |
| Rate limits      | Registration ~2/s burst 5; auth ~10/s burst 20; public ~30/s burst 60                                                                           |
| Security headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`, HSTS |
| CORS             | Not configured (no cross-origin allowance at edge)                                                                                              |
| Access log       | Disabled (`--accesslog=false`) — no raw client IP retention at edge                                                                             |

Application-layer rate limits still apply behind Traefik using `request.ip` with `TRUST_PROXY=true` (one hop).

## Application hardening

Registry container:

- `read_only: true`, `tmpfs: /tmp`
- `security_opt: no-new-privileges:true`
- `cap_drop: [ALL]`
- Non-root `app` user (UID 1001)
- No secrets baked into the image

## PostgreSQL pool timeouts

Applied on each new connection (`src/db/pool.ts`):

| Setting                               | Value | Purpose                     |
| ------------------------------------- | ----- | --------------------------- |
| `statement_timeout`                   | 30s   | Cap long queries            |
| `lock_timeout`                        | 5s    | Avoid indefinite lock waits |
| `idle_in_transaction_session_timeout` | 60s   | Reclaim idle transactions   |

Pool sizing: `max=10`, `connectionTimeoutMillis=5000`, `idleTimeoutMillis=30000`.

## Graceful shutdown

`registry` handles `SIGTERM` / `SIGINT`: closes Fastify, drains the pool, exits 0.

```bash
docker compose stop registry   # sends SIGTERM
```

## Backups

Script: `deploy/staging/backup.sh`

- Format: `pg_dump -Fc` (custom)
- Default directory: `/var/backups/engawa-map-registry`
- Retention: 7 days
- File mode: `600`, directory `700`

```bash
./deploy/staging/backup.sh
```

### systemd timer (daily)

```bash
sudo cp deploy/staging/systemd/engawa-map-registry-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now engawa-map-registry-backup.timer
```

Adjust `WorkingDirectory` in the service unit if the clone path differs.

## Restore test

`deploy/staging/restore-test.sh` restores the latest backup into a temporary database, verifies `schema_migrations` and `sites`, then drops the temp DB.

```bash
./deploy/staging/restore-test.sh
```

Run monthly or after backup changes.

## Rollback

1. Check out the previous known-good git tag/commit on the host
2. `docker compose build registry migrate`
3. `docker compose run --rm migrate` (if schema unchanged, migrate is a no-op)
4. `docker compose up -d registry`
5. If schema rollback is required, restore from backup (operator judgment — no automated down migrations)

## Incident shutdown

Immediate edge stop (keeps data):

```bash
docker compose stop traefik
```

Full stack stop:

```bash
docker compose down
```

Preserve volumes unless intentionally destroying staging data.

## Engawa CLI E2E (post-deploy)

From a machine with the sibling [Engawa](https://github.com/thierry-gilgen-ict/engawa) checkout:

```bash
cd /path/to/engawa
ENGAWA_MAP_REGISTRY_URL=https://staging-engawa-map.thierry-gilgen-ict.ch \
  pnpm exec engawa-map register --dry-run   # adjust per engawa-map CLI docs
```

Or from this repo:

```bash
ENGAWA_MAP_REGISTRY_URL=https://staging-engawa-map.thierry-gilgen-ict.ch \
  pnpm test:e2e:engawa-cli
```

**Report PASS only after a live staging deployment.** Until DNS and the VM are provisioned, treat E2E as `NOT_RUN`.

## CI scope

GitHub Actions CI validates build, lint, tests, and `docker compose config` — it does **not** deploy staging and has no deployment secrets.

## Docker log rotation

All services use `json-file` driver with `max-size: 10m`, `max-file: 3`.

## Local compose validation

```bash
docker compose -f deploy/staging/compose.yaml --env-file deploy/staging/.env.dummy config --quiet
```
