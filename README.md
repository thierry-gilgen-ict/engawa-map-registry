# Engawa Distribution Map Registry

Dedicated registry service for the optional [Engawa Distribution Map](https://github.com/thierry-gilgen-ict/engawa). This repository is a **separate security boundary** from Engawa consumer sites and from the main Thierry Gilgen ICT website.

```text
STATUS = LIVE
PRODUCTION = LIVE (DM3C acceptance PASS)
PRODUCTION_HOST = engawa-map.thierry-gilgen-ict.ch
PRODUCTION_ACCEPTED_SHA = 91b971e47f4014df97cd4dbcade73ac2d92e8aa1
LIVE_STAGING_STATUS = PASS
STAGING_HOSTNAME = staging-engawa-map.thierry-gilgen-ict.ch
STAGING_ACCEPTED_SHA = 61623df1422206d86fc0b4aee39e1f843440faa9
NPM_CLI = @thierry-gilgen-ict/engawa-map@0.1.0 (public on npm)
```

Staging is operator-deployed via [deploy/staging/](deploy/staging/). Production is live at [engawa-map.thierry-gilgen-ict.ch](https://engawa-map.thierry-gilgen-ict.ch) with the public showcase in [showcase/](showcase/) and deploy artifacts in [deploy/production/](deploy/production/).

## What this service does

- Accepts site registrations from the `engawa-map` CLI (`PENDING` until manually approved)
- Serves a public, read-only list of `LISTED` sites
- Authenticates site-scoped bearer tokens (hash-only server storage)
- Enforces idempotency, canonical-origin uniqueness, rate limits, and strict schemas

## What this service does not do

- No visitor tracking or runtime telemetry
- No outbound fetches to registered canonical URLs (no DNS, no HTTP verification)
- No domain verification (deferred)
- No admin HTTP API or browser UI
- No dependency on consumer website runtimes

## Local development

Requirements: Node.js 24+, pnpm, Docker (for PostgreSQL 18).

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

Health checks:

- `GET /healthz` — process alive
- `GET /readyz` — database reachable and migrations applied

API base path: `/api/v1`

## Staging deployment

See [docs/staging-deployment.md](docs/staging-deployment.md) for the full runbook (host setup, TLS, backups, rollback).

Staging URL: `https://staging-engawa-map.thierry-gilgen-ict.ch`

## Production deployment

See [docs/production-deployment.md](docs/production-deployment.md). Production is **live** at `https://engawa-map.thierry-gilgen-ict.ch` (DM3C acceptance PASS).

Join the map (voluntary, operator-initiated):

```bash
npm install --save-dev @thierry-gilgen-ict/engawa-map
npx engawa-map register
```

First registration is `PENDING`; public listing requires manual approval. No runtime phone-home from Engawa consumer sites.

## Commands

| Command                       | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `pnpm dev`                    | Start development server                                  |
| `pnpm db:migrate`             | Apply SQL migrations (explicit; not run on app startup)   |
| `pnpm test`                   | Integration tests (requires Postgres)                     |
| `pnpm admin approve <siteId>` | Operator-only: `PENDING` → `LISTED`                       |
| `pnpm admin delist <siteId>`  | Operator-only: revoke token and delist                    |
| `pnpm test:e2e:engawa-cli`    | Local loopback engawa-map CLI E2E (starts local registry) |
| `pnpm test:e2e:staging-cli`   | Remote HTTPS staging acceptance (`ENGAWA_MAP_ENDPOINT`)   |

## Token model

The CLI generates a cryptographic site token before registration. The server stores only `SHA-256(rawToken)` as base64url via the `Engawa-Map-Site-Token-Hash` header. Protected routes authenticate with `Authorization: Bearer <raw-token>`. Raw tokens are never returned or logged.

## Idempotency

`POST /api/v1/sites` requires `Idempotency-Key` (UUID). Replays with the same payload hash and token hash return the same semantic result within **24 hours**. Conflicting replays return `409 IDEMPOTENCY_CONFLICT`.

## Payload hash

Registration idempotency compares `SHA-256(JSON.stringify(registrationPayloadSchema.parse(payload)))` (hex), matching the Engawa `engawa-map` client.

## Documentation

- [API reference](docs/api.md)
- [Security model](docs/security.md)
- [Staging deployment runbook](docs/staging-deployment.md)
- [Production deployment design](docs/production-deployment.md)
- [Production operations runbook](docs/production-operations.md)
- Engawa contract: [distribution-map-api.md](https://github.com/thierry-gilgen-ict/engawa/blob/main/docs/distribution-map-api.md)

## License

MIT
