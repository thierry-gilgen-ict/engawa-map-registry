# Production deployment design (DM3A contract)

**Status:** design only — **not deployed**. Implementation artifacts are **DM3B**. Live acceptance is **DM3C**.

## Deployment status

```text
PRODUCTION_DEPLOYMENT = NO
PRODUCTION_HOST = engawa-map.thierry-gilgen-ict.ch
PRODUCTION_ORIGIN = https://engawa-map.thierry-gilgen-ict.ch
STAGING_LIVE = YES (staging-engawa-map.thierry-gilgen-ict.ch, DM2B PASS)
STAGING_DATA_COPIED_TO_PRODUCTION = NO
```

Authoritative product contract: [Engawa distribution-map-production-launch.md](https://github.com/thierry-gilgen-ict/engawa/blob/main/docs/distribution-map-production-launch.md).

## Infrastructure decision

```text
SEPARATE_PRODUCTION_VM = YES
SEPARATE_PRODUCTION_DATABASE = YES
SEPARATE_PRODUCTION_POSTGRES_VOLUME = YES
SEPARATE_PRODUCTION_ACME_STATE = YES
SEPARATE_PRODUCTION_ENV = YES
```

Production must not share staging Postgres data, volumes, ACME state, or `.env`.

Preferred host: Ubuntu 24.04 LTS, ≥ 2 vCPU, ≥ 2 GB RAM, ≥ 20 GB disk, dedicated VM (not shared with staging).

## Target architecture

```text
Internet
  -> Traefik (edge: 80/443, TLS, rate limits, body limits, security headers)
       |
       +-- showcase service (static/read-only UI at /)
       |
       +-- registry service (/api/v1/*, /healthz, /readyz)
              |
              +-- postgres:5432 (backend network only)
```

Networks (same pattern as staging):

- `edge` — Traefik host ports
- `proxy` — internal Traefik ↔ app services
- `backend` — internal registry ↔ postgres; no general internet egress for registry/postgres

## DM2B hardening (carry forward)

- PostgreSQL 18, volume mount `/var/lib/postgresql`, PGDATA `/var/lib/postgresql/18/docker`
- Explicit `migrate` service; no auto-migrate on registry start
- Registry container: non-root, read-only root FS, no-new-privileges, cap_drop ALL
- No published 3000 or 5432
- TLS ≥ 1.2, CSP on API paths; showcase CSP tuned for static UI in DM3B
- No Traefik access logs; bounded Docker log rotation
- `TRUST_PROXY_HOPS=1`
- Backup to `/var/backups/engawa-map-registry`, restore-test script, systemd timer

## DM3B deliverables (not in DM3A)

- `deploy/production/` — compose, Traefik dynamic config, `.env.example`, backup scripts
- Public showcase frontend service (static or minimal SSR)
- CI: compose config, runtime smoke (postgres → migrate → registry → showcase)
- Documentation cross-links

## DM3C acceptance

See production acceptance checklist in Engawa `docs/distribution-map-production-launch.md`.

## Moderation

Same as staging: admin CLI on host only; no admin HTTP API; domain verification deferred.
