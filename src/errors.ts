import type { FrozenErrorCode } from "./constants.js";
import { MAX_ERROR_MESSAGE_LENGTH } from "./constants.js";

export class AppError extends Error {
  readonly code: FrozenErrorCode;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: FrozenErrorCode,
    message: string,
    statusCode: number,
    retryAfterSeconds?: number,
  ) {
    super(message.slice(0, MAX_ERROR_MESSAGE_LENGTH));
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function invalidRequest(message: string): AppError {
  return new AppError("INVALID_REQUEST", message, 400);
}

export function invalidCanonicalUrl(message: string): AppError {
  return new AppError("INVALID_CANONICAL_URL", message, 400);
}

export function canonicalUrlAlreadyRegistered(): AppError {
  return new AppError(
    "CANONICAL_URL_ALREADY_REGISTERED",
    "The canonical URL already has an active registration.",
    409,
  );
}

export function idempotencyConflict(): AppError {
  return new AppError(
    "IDEMPOTENCY_CONFLICT",
    "Idempotency key was already used with a different registration attempt.",
    409,
  );
}

export function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Missing or invalid bearer token.", 401);
}

export function siteNotFound(): AppError {
  return new AppError("SITE_NOT_FOUND", "Site not found.", 404);
}

export function siteDelisted(): AppError {
  return new AppError("SITE_DELISTED", "Site has been delisted.", 410);
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", "Rate limit exceeded.", 429, retryAfterSeconds);
}

export function internalError(): AppError {
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
