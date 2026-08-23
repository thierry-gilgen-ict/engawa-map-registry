export type RateLimitPolicy = "register" | "authMutation" | "publicRead";

interface Bucket {
  count: number;
  resetAt: number;
}

const POLICY_LIMITS: Record<RateLimitPolicy, { max: number; windowMs: number }> = {
  register: { max: 10, windowMs: 60_000 },
  authMutation: { max: 30, windowMs: 60_000 },
  publicRead: { max: 120, windowMs: 60_000 },
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(policy: RateLimitPolicy, key: string): { allowed: boolean; retryAfterSeconds: number } {
    const { max, windowMs } = POLICY_LIMITS[policy];
    const now = Date.now();
    const bucketKey = `${policy}:${key}`;
    const existing = this.buckets.get(bucketKey);

    if (!existing || now >= existing.resetAt) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function clientRateLimitKey(ip: string): string {
  return ip || "unknown";
}
