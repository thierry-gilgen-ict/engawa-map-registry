import { z } from "zod";

const NODE_ENV_VALUES = ["development", "test", "production"] as const;

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export const configSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENV_VALUES),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY: z.boolean().default(false),
  })
  .strict();

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL,
    HOST: env.HOST ?? "127.0.0.1",
    PORT: env.PORT ?? "3000",
    TRUST_PROXY: parseBooleanEnv(env.TRUST_PROXY, false),
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid configuration: ${message}`);
  }

  return parsed.data;
}
