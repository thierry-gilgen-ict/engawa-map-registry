# Security model

Engawa Distribution Map registry — staging live (DM2B PASS); production not deployed.

## Trust boundaries

| Boundary              | Rule                                                |
| --------------------- | --------------------------------------------------- |
| Consumer Engawa sites | No registry credentials in website runtime          |
| Main ICT website      | No shared DB, sessions, or deployment credentials   |
| Registry PostgreSQL   | Dedicated credentials; least privilege              |
| Operator              | Direct DB/env access for `pnpm admin` commands only |

```text
DOMAIN_VERIFICATION = DEFERRED
ADMIN_HTTP_API = NONE
PRODUCTION_DEPLOYMENT = NOT_DEPLOYED
LIVE_STAGING_STATUS = PASS
STAGING = deploy/staging/ (Traefik edge, DM2B merged 4a45b71)
STAGING_ACCEPTED_SHA = 61623df1422206d86fc0b4aee39e1f843440faa9
```

## Edge layer (staging, DM2B)

Staging terminates TLS at Traefik with:

- HTTP → HTTPS redirect and Let's Encrypt certificates
- Request body cap 16 KiB at edge (matches application limit)
- Per-route rate limits (registration strict, auth moderate, public read relaxed)
- Security headers: `nosniff`, `no-referrer`, frame deny, CSP `default-src 'none'; frame-ancestors 'none'`, HSTS for the staging hostname only (no `includeSubDomains`, no preload)
- TLS minimum version TLS 1.2 (`VersionTLS12`)
- Forwarded headers: `forwardedHeaders.insecure=false` on Traefik entrypoints
- No CORS middleware
- Traefik access logging disabled (no raw client IP retention at edge)

Behind the proxy, the app sets `TRUST_PROXY_HOPS=1` (one hop) so in-memory rate limits use the client IP from `X-Forwarded-For`.

## Token model

- CLI generates ≥256-bit random site tokens
- Server stores **hash only** (`SHA-256` base64url)
- Registration sends hash via `Engawa-Map-Site-Token-Hash` header
- Protected routes use `Authorization: Bearer <raw-token>`
- Token hash is **not** accepted as a bearer credential
- Constant-time comparison for hash verification
- `DELETE` and operator `delist` revoke tokens (`token_hash = NULL`)

## Idempotency

- `Idempotency-Key` is not authentication
- Binds payload hash + token hash + site record
- 24-hour retention; conflicting replays return `409 IDEMPOTENCY_CONFLICT`
- Replays never return raw tokens

## Payload identity

`SHA-256(hex)` of `JSON.stringify(registrationPayloadSchema.parse(payload))` — matches Engawa `engawa-map` client.

## Canonical URL validation

Parser-only validation. **No DNS. No HTTP.** Prevents SSRF via registration URLs.

Rejected: non-HTTPS, credentials, query, fragment, non-root paths, localhost, `.local`, private/reserved IPs.

## Duplicate origins

Partial unique index on `canonical_url WHERE state <> 'DELISTED'`. Conflicts return `409 CANONICAL_URL_ALREADY_REGISTERED` without leaking prior registrant data.

## Rate limiting

In-memory, single-instance policies:

| Policy                  | Approx. limit            |
| ----------------------- | ------------------------ |
| Registration (`POST`)   | 10 / minute / client key |
| Authenticated mutations | 30 / minute              |
| Public reads            | 120 / minute             |

Rate-limit state is ephemeral infrastructure signal, not product data. `429` includes `Retry-After` when limited.

## Body limits

16 KB JSON body cap (`413`). Public list pagination capped at 100 items per page.

## Logging and redaction

Structured logs include request id, route, status, duration, safe error codes.

**Never logged:** `Authorization`, raw bearer tokens, `Engawa-Map-Site-Token-Hash`, `DATABASE_URL`, request bodies.

Raw IP addresses are not persisted as product telemetry.

## SSRF / outbound fetch

```text
REGISTRY_OUTBOUND_SITE_FETCH = NONE
```

No `fetch`, `axios`, or HTTP client calls to canonical URLs, MCP endpoints, or site content during DM2A.

## Manual moderation

Operator-only CLI (`pnpm admin approve|delist`). No admin HTTP surface. No site bearer tokens for moderation.

## Deployment (DM2B staging live; production DM3)

- HTTPS termination at edge — staging live; production design in [production-deployment.md](production-deployment.md)
- `DATABASE_URL` required at startup (no silent defaults in production or migration paths)
- Separate credentials and network isolation (three-network topology: edge, proxy, backend)
- Backups and privacy notice for retention
- Edge rate limits in addition to application limits — **implemented** for staging

## Residual risks

- No domain ownership proof until a future verification phase
- Maintainer manual approval is the v1 trust mechanism
- Single-instance in-memory rate limits do not coordinate across replicas (acceptable for single-instance staging; production multi-replica TBD in DM3B)
