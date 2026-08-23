# Registry API (v1)

Frozen contract aligned with Engawa `docs/distribution-map-api.md` and `@thierry-gilgen-ict/engawa-map` client schemas.

Base path: `/api/v1`

## Health

### `GET /healthz`

Process liveness. No database dependency.

**200**

```json
{ "status": "ok" }
```

### `GET /readyz`

Database connectivity and applied migrations.

**200** — ready  
**503** — not ready

## Public list

### `GET /api/v1/sites`

Returns **only** `LISTED` sites. Cursor pagination.

Query parameters:

| Name     | Type          | Default | Max |
| -------- | ------------- | ------- | --- |
| `limit`  | integer       | 20      | 100 |
| `cursor` | opaque string | —       | —   |

**200**

```json
{
  "items": [
    {
      "siteId": "uuid",
      "displayName": "Example",
      "canonicalUrl": "https://example.com",
      "packages": {
        "@thierry-gilgen-ict/engawa-core": "0.1.1"
      },
      "hints": { "framework": "nextjs" },
      "listedAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

## Register

### `POST /api/v1/sites`

Unauthenticated first registration. Creates `PENDING` sites only.

Required headers:

| Header                       | Value                               |
| ---------------------------- | ----------------------------------- |
| `Idempotency-Key`            | UUID                                |
| `Engawa-Map-Site-Token-Hash` | base64url SHA-256 of raw site token |

Optional: `Engawa-Map-Client-Version` (protocol metadata; not stored in public listing)

**201**

```json
{
  "siteId": "uuid",
  "state": "PENDING",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Request body (strict — unknown fields rejected):

```json
{
  "displayName": "Example",
  "canonicalUrl": "https://example.com",
  "packages": {
    "@thierry-gilgen-ict/engawa-core": "0.1.1"
  },
  "hints": {
    "framework": "nextjs",
    "byaEnabled": true,
    "localeCount": 2
  }
}
```

## Status

### `GET /api/v1/sites/:siteId/status`

Requires `Authorization: Bearer <raw-site-token>`.

**200** — `PENDING`, `LISTED`, or `DELISTED` (when token still valid)

## Update

### `PATCH /api/v1/sites/:siteId`

Bearer required. Updatable fields: `displayName`, `canonicalUrl`, `packages`, `hints`.

Canonical URL changes reset `LISTED` → `PENDING` and remove public listing until re-approved.

**200** — status response shape

## Unregister

### `DELETE /api/v1/sites/:siteId`

Bearer required.

**204** — site becomes `DELISTED`, token revoked

## Error envelope

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human-readable message"
  }
}
```

Frozen codes: `INVALID_REQUEST`, `INVALID_CANONICAL_URL`, `CANONICAL_URL_ALREADY_REGISTERED`, `RATE_LIMITED`, `UNAUTHORIZED`, `SITE_NOT_FOUND`, `SITE_DELISTED`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_ERROR`.

## Limits

- Request body: 16 KB (`413` when exceeded)
- No CORS for browser clients
- No redirect following (client rule)
- No remote canonical URL verification

## Manual moderation (operator CLI only)

Not exposed over HTTP:

```bash
pnpm admin approve <siteId>
pnpm admin delist <siteId>
```
