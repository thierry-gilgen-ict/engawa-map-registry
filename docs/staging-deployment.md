# Staging deployment runbook (DM2B)

Operator runbook for the Engawa Distribution Map registry staging environment.

```text
STAGING_HOSTNAME=staging-engawa-map.thierry-gilgen-ict.ch
DNS_CONTROL_AVAILABLE=NO
STAGING_HOST_AVAILABLE=NO
LIVE_STAGING_STATUS=NOT_DEPLOYED
BLOCKER=No VM/DNS/SSH provisioning access from CI or this workspace. Artifacts only until an operator deploys manually.
```

## Overview

| Item       | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Hostname   | `staging-engawa-map.thierry-gilgen-ict.ch`                                   |
| Edge       | Traefik v3 (file provider, no Docker socket)                                 |
| App        | Node 24 Fastify registry (`registry` service)                                |
| Database   | PostgreSQL 18 (`postgres` service, backend network only)                     |
| PGDATA     | `/var/lib/postgresql/18/docker` (PG18 volume mount: `/var/lib/postgresql`)   |
| Migrations | One-shot `migrate` service (`node dist/migrate.js`) — **not** on app startup |
| TLS        | Let's Encrypt HTTP-01 via Traefik                                            |

## Architecture

```text
Internet ──► Traefik (edge:80/443) ──► registry:3000 (proxy + backend)
                                              │
                                              └──► postgres:5432 (backend only)
```

Networks:

- **edge** — Traefik only (host port binding)
- **proxy** — Traefik ↔ registry (`internal: true`)
- **backend** — registry, postgres, migrate (`internal: true`; no outbound internet)

No host ports are published for `registry` or `postgres`. Only Traefik exposes `80` and `443`.

## Host prerequisites

1. Linux VM with Docker Engine and Compose v2
2. DNS `A`/`AAAA` for `staging-engawa-map.thierry-gilgen-ict.ch` → VM public IP
3. Firewall: allow inbound `22/tcp` (SSH), `80/tcp`, and `443/tcp` only; deny direct access to app/db ports

   **SSH lockout warning:** Before tightening firewall rules, open a **second SSH session** and verify you can still connect after applying changes. Keep the first session open until the second succeeds.

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

| Control           | Setting                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP → HTTPS      | Entrypoint redirect on `web`                                                                                                                                            |
| Body limit        | 16 KiB (`buffering.maxRequestBodyBytes`)                                                                                                                                |
| Rate limits       | Registration ~2/s burst 5; auth ~10/s burst 20; public ~30/s burst 60                                                                                                   |
| Security headers  | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, HSTS |
| Forwarded headers | `forwardedHeaders.insecure=false` on `web` and `websecure` entrypoints                                                                                                  |
| TLS minimum       | TLS 1.2 (`VersionTLS12`) via `traefik/dynamic/tls.yaml`                                                                                                                 |
| CORS              | Not configured (no cross-origin allowance at edge)                                                                                                                      |
| Access log        | Disabled (`--accesslog=false`) — no raw client IP retention at edge                                                                                                     |

Application-layer rate limits still apply behind Traefik using `request.ip` with `TRUST_PROXY_HOPS=1` (one hop).

## Application hardening

Registry container:

- `read_only: true`, `tmpfs: /tmp`
- `security_opt: no-new-privileges:true`
- `cap_drop: [ALL]`
- Non-root `app` user (UID 1001)
- No secrets baked into the image

## PostgreSQL pool timeouts

Applied on each new connection via libpq `options` (`src/db/pool.ts`):

| Setting                               | Value | Purpose                     |
| ------------------------------------- | ----- | --------------------------- |
| `statement_timeout`                   | 30s   | Cap long queries            |
| `lock_timeout`                        | 5s    | Avoid indefinite lock waits |
| `idle_in_transaction_session_timeout` | 60s   | Reclaim idle transactions   |

Pool sizing: `max=10`, `connectionTimeoutMillis=5000`, `idleTimeoutMillis=30000`.

## PostgreSQL 18 data directory

PostgreSQL 18 images expect the data volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data`). The effective `PGDATA` is `/var/lib/postgresql/18/docker`.

Staging compose mounts `postgres_data:/var/lib/postgresql`. After first boot, verify:

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW data_directory"
# expected: /var/lib/postgresql/18/docker
```

## Graceful shutdown

`registry` handles `SIGTERM` / `SIGINT`: closes Fastify, drains the pool, exits 0.

```bash
docker compose stop registry   # sends SIGTERM
```

## Backups

Script: `deploy/staging/backup.sh`

- Format: `pg_dump -Fc` (custom)
- Atomic write: temp file in backup dir, verify non-empty, `chmod 600`, then `mv`
- `umask 077` for created files
- Retention runs only after a successful backup
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

`deploy/staging/restore-test.sh` restores the latest backup into a fixed temporary database (`engawa_registry_restore_test`), verifies `schema_migrations` and `sites`, then drops the temp DB on exit via `trap`.

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

## Acceptance test matrix

| Test                        | Scope                                                                        | Runs in CI | Staging evidence           |
| --------------------------- | ---------------------------------------------------------------------------- | ---------- | -------------------------- |
| `pnpm test:e2e:engawa-cli`  | **Local** registry E2E — starts a loopback Fastify registry on a random port | No         | No                         |
| `pnpm test:e2e:staging-cli` | **Remote** HTTPS staging acceptance via `ENGAWA_MAP_ENDPOINT`                | No         | Yes (when staging is live) |
| DM2B LIVE ACCEPTANCE        | Operator HTTPS checks on deployed staging hostname                           | No         | Yes (post-deploy)          |

```text
LOCAL_E2E_CLAIMED_AS_STAGING_EVIDENCE=NO
DM2B_LIVE_ACCEPTANCE_STATUS=NOT_RUN
STAGING_DEPLOYED=NO
```

`test:e2e:engawa-cli` exercises the engawa-map CLI contract against a **local** registry only. It does **not** prove staging TLS, Traefik, or host networking. Report staging PASS only from `test:e2e:staging-cli` or manual post-deployment commands after a live deploy.

## Post-deployment acceptance (operator)

Prerequisites: DNS resolves, TLS is valid, `curl` health checks pass.

From the sibling [Engawa](https://github.com/thierry-gilgen-ict/engawa) checkout (build the map CLI once):

```bash
cd /path/to/engawa
pnpm --filter @thierry-gilgen-ict/engawa-map build
```

Create a throwaway consumer fixture directory with `engawa-map.config.json` and a stub `node_modules/@thierry-gilgen-ict/engawa-core/package.json` (see `scripts/e2e-staging-engawa-cli.ts`).

```bash
export ENGAWA_MAP_ENDPOINT=https://staging-engawa-map.thierry-gilgen-ict.ch

curl -fsS "$ENGAWA_MAP_ENDPOINT/healthz"
curl -fsS "$ENGAWA_MAP_ENDPOINT/readyz"

node /path/to/engawa/packages/map/dist/cli.js register --yes
node /path/to/engawa/packages/map/dist/cli.js status
node /path/to/engawa/packages/map/dist/cli.js unregister
```

Or from this repo (same remote flow, not started in CI):

```bash
ENGAWA_MAP_ENDPOINT=https://staging-engawa-map.thierry-gilgen-ict.ch \
  pnpm test:e2e:staging-cli
```

`ENGAWA_MAP_STAGING_ENDPOINT_OVERRIDE=1` allows a non-default HTTPS hostname for dry runs against alternate endpoints.

**Report PASS only after a live staging deployment.** Until DNS and the VM are provisioned, treat DM2B live acceptance as `NOT_RUN`.

## Local engawa-map CLI E2E (loopback)

Starts a local registry on a random loopback port; does **not** contact staging:

```bash
pnpm test:e2e:engawa-cli
```

## CI scope

GitHub Actions CI validates build, lint, tests, `docker compose config`, and a **runtime smoke** of the staging compose stack (`postgres`, `migrate`, `registry`) — it does **not** deploy staging, does **not** run `test:e2e:staging-cli`, and has no deployment secrets.

## Docker log rotation

All services use `json-file` driver with `max-size: 10m`, `max-file: 3`.

## Local compose validation

```bash
docker compose -f deploy/staging/compose.yaml --env-file deploy/staging/.env.dummy config --quiet
```
