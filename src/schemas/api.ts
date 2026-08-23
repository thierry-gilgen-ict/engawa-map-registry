import { z } from "zod";
import {
  FROZEN_ERROR_CODES,
  MAX_CANONICAL_URL_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_ERROR_MESSAGE_LENGTH,
} from "../constants.js";
import { validateAndNormalizeCanonicalUrl, CanonicalUrlError } from "./canonical-url.js";
import { exactSemverSchema } from "./semver.js";

const canonicalUrlFieldSchema = z
  .string()
  .min(1)
  .max(MAX_CANONICAL_URL_LENGTH)
  .transform((url, ctx) => {
    try {
      return validateAndNormalizeCanonicalUrl(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid canonical URL";
      ctx.addIssue({
        code: "custom",
        message,
      });
      return z.NEVER;
    }
  });

export const mapHintsSchema = z
  .object({
    framework: z.string().min(1).max(100).optional(),
    byaEnabled: z.boolean().optional(),
    localeCount: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const engawaPackagesSchema = z
  .object({
    "@thierry-gilgen-ict/engawa-core": exactSemverSchema,
    "@thierry-gilgen-ict/engawa-discovery": exactSemverSchema.optional(),
    "@thierry-gilgen-ict/engawa-mcp": exactSemverSchema.optional(),
    "@thierry-gilgen-ict/engawa-react": exactSemverSchema.optional(),
  })
  .strict();

export type EngawaPackages = z.infer<typeof engawaPackagesSchema>;

export const registrationPayloadSchema = z
  .object({
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    canonicalUrl: canonicalUrlFieldSchema,
    packages: engawaPackagesSchema,
    hints: mapHintsSchema.optional(),
  })
  .strict();

export type RegistrationPayload = z.infer<typeof registrationPayloadSchema>;

export const patchPayloadSchema = z
  .object({
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
    canonicalUrl: canonicalUrlFieldSchema.optional(),
    packages: engawaPackagesSchema.optional(),
    hints: mapHintsSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });

export type PatchPayload = z.infer<typeof patchPayloadSchema>;

export const siteStateSchema = z.enum(["PENDING", "LISTED", "DELISTED"]);

export const registerResponseSchema = z
  .object({
    siteId: z.string().uuid(),
    state: z.literal("PENDING"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type RegisterResponse = z.infer<typeof registerResponseSchema>;

export const statusResponseSchema = z
  .object({
    siteId: z.string().uuid(),
    state: siteStateSchema,
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    canonicalUrl: z.string().min(1).max(MAX_CANONICAL_URL_LENGTH),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const publicListItemSchema = z
  .object({
    siteId: z.string().uuid(),
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    canonicalUrl: z.string().min(1).max(MAX_CANONICAL_URL_LENGTH),
    packages: engawaPackagesSchema,
    hints: mapHintsSchema.optional(),
    listedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PublicListItem = z.infer<typeof publicListItemSchema>;

export const publicListResponseSchema = z
  .object({
    items: z.array(publicListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type PublicListResponse = z.infer<typeof publicListResponseSchema>;

export const frozenErrorCodeSchema = z.enum(FROZEN_ERROR_CODES);

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: frozenErrorCodeSchema,
        message: z.string().min(1).max(MAX_ERROR_MESSAGE_LENGTH),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function isCanonicalUrlError(error: unknown): boolean {
  return error instanceof CanonicalUrlError;
}
