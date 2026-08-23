import { createHash } from "node:crypto";
import { registrationPayloadSchema, type RegistrationPayload } from "./api.js";

export function hashRegistrationPayload(payload: RegistrationPayload): string {
  const normalized = registrationPayloadSchema.parse(payload);
  const serialized = JSON.stringify(normalized);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
