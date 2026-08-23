import { z } from "zod";

const NODE_ENV_VALUES = ["development", "test", "production"] as const;

export const configSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENV_VALUES),
    DATABASE_URL: z
      .string({ error: "DATABASE_URL is required" })
      .min(1, "DATABASE_URL is required"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
  })
  .strict();

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL,
    HOST: env.HOST ?? "127.0.0.1",
    PORT: env.PORT ?? "3000",
    TRUST_PROXY_HOPS: env.TRUST_PROXY_HOPS ?? "0",
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid configuration: ${message}`);
  }

  return parsed.data;
}
