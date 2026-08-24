# Production operations runbook

Operational guide for the live Engawa Distribution Map registry. For architecture and design, see [production-deployment.md](production-deployment.md). For staging reference, see [staging-deployment.md](staging-deployment.md).

## Current production state

```text
hostname       = engawa-map.thierry-gilgen-ict.ch
origin         = https://engawa-map.thierry-gilgen-ict.ch
server         = 168.119.177.41
OS             = Ubuntu 24.04 LTS
repository     = /opt/engawa-map-registry
SSH user       = deploy
compose path   = /opt/engawa-map-registry/deploy/production
```

### SSH access

From the operator workstation (existing key only):

```powershell
ssh -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\engawa" deploy@168.119.177.41
```

**Security:** Never commit, read, print, or copy the private SSH key. Do not paste `.env` or database secrets into issues or chat.

The `deploy` user runs Docker via `sudo`. Compose commands on the host typically use:

```bash
sudo docker compose --env-file .env -f compose.yaml ...
```

When uploading shell scripts from Windows, ensure **Unix line endings (LF)**. CRLF breaks `/bin/sh` on the server.

## Normal deployment procedure

Use this after a registry PR is merged and post-merge CI is green.

1. **Record the exact accepted merge SHA** from the merged PR (not a moving branch tip).
2. **SSH** to production (`deploy@168.119.177.41`).
3. **Fetch and checkout exact SHA:**

   ```bash
   cd /opt/engawa-map-registry
   git fetch origin
   git checkout <exact-merge-sha>
   git rev-parse HEAD    # must match
   git status --short    # must be empty
   ```

4. **Validate compose** (no secrets in output):

   ```bash
   cd deploy/production
   sudo docker compose --env-file .env -f compose.yaml config --quiet
   ```

5. **Migration** — run only if the release includes new SQL migrations:

   ```bash
   sudo docker compose --env-file .env -f compose.yaml up migrate
   ```

   Static/docs-only showcase changes do **not** require migration.

6. **Compose update/build:**
   - **Showcase/static only:** rebuild `showcase` service.
   - **Registry API/runtime change:** rebuild `registry` (and `migrate` if needed); restart affected services.
   - **Full stack** (rare): follow compose dependencies in [compose.yaml](../deploy/production/compose.yaml).

   Example (showcase-only):

   ```bash
   sudo docker compose --env-file .env -f compose.yaml up -d --build showcase
   ```

7. **Verify endpoints:**

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://engawa-map.thierry-gilgen-ict.ch/healthz
   curl -sS -o /dev/null -w '%{http_code}\n' https://engawa-map.thierry-gilgen-ict.ch/readyz
   curl -sS -o /dev/null -w '%{http_code}\n' https://engawa-map.thierry-gilgen-ict.ch/api/v1/sites
   curl -sS -o /dev/null -w '%{http_code}\n' https://engawa-map.thierry-gilgen-ict.ch/
   curl -sS -o /dev/null -w '%{http_code}\n' https://engawa-map.thierry-gilgen-ict.ch/privacy
   ```

   All should return `200`.

8. **Record deployed SHA** in operator notes.

Documentation-only changes under `docs/` that are **not** baked into container images do **not** require a production redeploy.

## Production guardrails

- Do **not** deploy a moving branch tip without verifying the exact SHA.
- Do **not** copy staging database, volumes, ACME state, or `.env` into production.
- Do **not** expose port `3000` or `5432` publicly.
- Do **not** disable UFW or fail2ban without explicit operator decision.
- Do **not** enable Traefik access logs casually (no raw client IP retention at edge by design).
- Do **not** print `.env`, database passwords, or site bearer tokens.
- Do **not** modify staging as part of a production deploy.

## Backup and recovery

### Components

| Artifact | Path |
| -------- | ---- |
| Backup script | [deploy/production/backup.sh](../deploy/production/backup.sh) |
| Restore-test script | [deploy/production/restore-test.sh](../deploy/production/restore-test.sh) |
| systemd service | [deploy/production/systemd/engawa-map-registry-backup.service](../deploy/production/systemd/engawa-map-registry-backup.service) |
| systemd timer | [deploy/production/systemd/engawa-map-registry-backup.timer](../deploy/production/systemd/engawa-map-registry-backup.timer) |
| Backup directory | `/var/backups/engawa-map-registry` |

### Backup behavior

- Daily timer (`OnCalendar=daily`, randomized delay up to 15 minutes).
- `pg_dump` via Docker Compose exec into the production Postgres container.
- Atomic write: temp file → verify non-empty → `chmod 600` → rename.
- Backup directory mode `700`; dump files mode `600`.
- Retention: 7 days (configurable via `RETENTION_DAYS`).

### Verify backup health

On the production host:

```bash
systemctl status engawa-map-registry-backup.timer
ls -la /var/backups/engawa-map-registry/
# latest engawa_registry_*.dump must exist and be non-zero size
stat -c '%a %n' /var/backups/engawa-map-registry
# directory should be 700; dumps 600
```

Run restore validation:

```bash
cd /opt/engawa-map-registry/deploy/production
sudo ./restore-test.sh
```

Restore-test loads the latest dump into temporary database `engawa_registry_restore_test`, verifies `schema_migrations` and `sites`, then drops the temp DB.

**Principle:** A backup is not considered trustworthy until restore-test succeeds.

### Recovery (operator judgment)

For catastrophic data loss or corruption:

1. Stop registry writes if needed (`docker compose stop registry`).
2. Identify the last known-good dump in `/var/backups/engawa-map-registry/`.
3. Restore into production Postgres using operator-approved procedure (not automated in v1).
4. Run restore-test against the candidate dump before trusting it.
5. Restart registry; verify `/readyz` and `/api/v1/sites`.

Document the incident and the dump timestamp used.

## Rollback

### Static or code-only release (no schema change)

Safe bounded procedure:

1. Identify the prior known-good deployed SHA.
2. `git checkout <prior-sha>` on `/opt/engawa-map-registry`.
3. Rebuild/restart affected compose services (usually `showcase` and/or `registry`).
4. Verify `/healthz`, `/readyz`, `/api/v1/sites`, showcase, and privacy pages.
5. Record the rolled-back SHA.

### Database-changing release

**Do not blindly downgrade application code or schema.**

1. Review whether the migration is reversible.
2. If not reversible, prefer **restore from backup** per recovery procedure above.
3. Never assume `git checkout` alone fixes a failed migration.
4. Document operator decisions before destructive steps.

Destructive rollback is **not** automatically safe.

## Repository workflow (post-hardening)

- Changes land on `main` via **pull request** with green CI (`test` job).
- Direct pushes, force pushes, and branch deletion on `main` are blocked.
- Solo maintainer: **0 required approvals** — PR + CI is the gate.
- Emergency bypass of branch protection is exceptional only; not the normal deploy path.

## Related

- [production-deployment.md](production-deployment.md) — architecture and DM3C acceptance design
- [staging-deployment.md](staging-deployment.md) — staging runbook (do not conflate with production)
- [security.md](security.md) — trust boundaries
- Engawa [release-and-operations.md](https://github.com/thierry-gilgen-ict/engawa/blob/main/docs/release-and-operations.md) — npm and map CLI release policy
