import type { PoolClient } from "pg";
import { IDEMPOTENCY_RETENTION_HOURS } from "../constants.js";
import type { EngawaPackages, RegistrationPayload } from "../schemas/api.js";
import { hashRegistrationPayload } from "../schemas/payload-hash.js";
import {
  canonicalUrlAlreadyRegistered,
  idempotencyConflict,
  internalError,
  isUniqueViolation,
} from "../errors.js";
import { newSiteId, queryOne, toIsoString } from "../db/pool.js";
import type { RegisterResponse } from "../schemas/api.js";

export interface SiteRow {
  id: string;
  display_name: string;
  canonical_url: string;
  packages: EngawaPackages;
  hints: RegistrationPayload["hints"] | null;
  state: "PENDING" | "LISTED" | "DELISTED";
  token_hash: string | null;
  created_at: Date;
  updated_at: Date;
  listed_at: Date | null;
  delisted_at: Date | null;
}

interface IdempotencyRow {
  idempotency_key: string;
  site_id: string;
  payload_hash: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function mapRegisterResponse(row: SiteRow): RegisterResponse {
  return {
    siteId: row.id,
    state: "PENDING",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export async function registerSite(
  client: PoolClient,
  input: {
    payload: RegistrationPayload;
    idempotencyKey: string;
    tokenHash: string;
  },
): Promise<RegisterResponse> {
  const payloadHash = hashRegistrationPayload(input.payload);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000);

  await client.query("DELETE FROM idempotency_keys WHERE expires_at < NOW()");

  const existingIdempotency = await queryOne<IdempotencyRow>(
    client,
    `SELECT idempotency_key, site_id, payload_hash, token_hash, created_at, expires_at
     FROM idempotency_keys
     WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  );

  if (existingIdempotency) {
    if (existingIdempotency.expires_at.getTime() <= Date.now()) {
      await client.query("DELETE FROM idempotency_keys WHERE idempotency_key = $1", [
        input.idempotencyKey,
      ]);
    } else {
      if (
        existingIdempotency.payload_hash !== payloadHash ||
        existingIdempotency.token_hash !== input.tokenHash
      ) {
        throw idempotencyConflict();
      }

      const site = await queryOne<SiteRow>(client, "SELECT * FROM sites WHERE id = $1", [
        existingIdempotency.site_id,
      ]);
      if (!site) {
        throw internalError();
      }
      return mapRegisterResponse(site);
    }
  }

  const siteId = newSiteId();
  const hints = input.payload.hints ?? null;

  try {
    await client.query(
      `INSERT INTO sites (
        id, display_name, canonical_url, packages, hints, state, token_hash
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'PENDING', $6)`,
      [
        siteId,
        input.payload.displayName,
        input.payload.canonicalUrl,
        JSON.stringify(input.payload.packages),
        hints ? JSON.stringify(hints) : null,
        input.tokenHash,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw canonicalUrlAlreadyRegistered();
    }
    throw error;
  }

  try {
    await client.query(
      `INSERT INTO idempotency_keys (idempotency_key, site_id, payload_hash, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.idempotencyKey, siteId, payloadHash, input.tokenHash, expiresAt],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw canonicalUrlAlreadyRegistered();
    }
    throw error;
  }

  const site = await queryOne<SiteRow>(client, "SELECT * FROM sites WHERE id = $1", [siteId]);
  if (!site) {
    throw internalError();
  }

  return mapRegisterResponse(site);
}

export async function getSiteById(client: PoolClient, siteId: string): Promise<SiteRow | null> {
  return queryOne<SiteRow>(client, "SELECT * FROM sites WHERE id = $1", [siteId]);
}

export function mapStatusResponse(row: SiteRow) {
  return {
    siteId: row.id,
    state: row.state,
    displayName: row.display_name,
    canonicalUrl: row.canonical_url,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapPublicListItem(row: SiteRow) {
  return {
    siteId: row.id,
    displayName: row.display_name,
    canonicalUrl: row.canonical_url,
    packages: row.packages,
    hints: row.hints ?? undefined,
    listedAt: row.listed_at ? toIsoString(row.listed_at) : toIsoString(row.updated_at),
    updatedAt: toIsoString(row.updated_at),
  };
}
