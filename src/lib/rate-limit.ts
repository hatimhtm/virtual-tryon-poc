/**
 * In-memory IP rate limiter.
 *
 * Imperfect (resets on cold start, doesn't span Vercel function instances)
 * but fine for a public POC — protects against drive-by abuse without the
 * Upstash dependency. Each instance gets its own counter; a determined
 * attacker spreading requests across instances will succeed, so don't
 * rely on this for security-critical quotas.
 */

interface Bucket {
    /** Window expiry timestamp (epoch ms). */
    resetAt: number;
    /** Hits in the current window. */
    count: number;
}

const buckets = new Map<string, Bucket>();

/** Trim the map opportunistically — every successful call has a 1/100 chance to sweep. */
function maybeSweep(now: number) {
    if (Math.random() > 0.01) return;
    for (const [key, b] of buckets) {
        if (b.resetAt < now) buckets.delete(key);
    }
}

export interface RateLimitOptions {
    /** Window size in milliseconds. */
    windowMs: number;
    /** Max hits per window. */
    max: number;
}

export interface RateLimitResult {
    ok: boolean;
    remaining: number;
    resetIn: number;  // seconds until window resets
    limit: number;
}

/**
 * Check if `key` (typically an IP) is within the limit. Returns the verdict
 * and counter metadata you should echo back to the client via headers.
 */
export function rateLimit(key: string, { windowMs, max }: RateLimitOptions): RateLimitResult {
    const now = Date.now();
    maybeSweep(now);

    const existing = buckets.get(key);
    if (!existing || existing.resetAt < now) {
        const resetAt = now + windowMs;
        buckets.set(key, { resetAt, count: 1 });
        return { ok: true, remaining: max - 1, resetIn: Math.ceil(windowMs / 1000), limit: max };
    }

    existing.count += 1;
    const remaining = Math.max(0, max - existing.count);
    const resetIn = Math.ceil((existing.resetAt - now) / 1000);

    return {
        ok: existing.count <= max,
        remaining,
        resetIn,
        limit: max,
    };
}

/**
 * Pull a stable client identifier from a Next.js Request — Vercel sets
 * x-forwarded-for and x-real-ip; fall back to a constant string so a
 * misconfigured environment still rate-limits (just globally).
 */
export function clientKey(req: Request): string {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]!.trim();
    return req.headers.get('x-real-ip')
        ?? req.headers.get('cf-connecting-ip')
        ?? 'unknown';
}

/** Build the `Retry-After` + `X-RateLimit-*` response headers. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
    return {
        'X-RateLimit-Limit': String(r.limit),
        'X-RateLimit-Remaining': String(r.remaining),
        'X-RateLimit-Reset': String(r.resetIn),
        ...(r.ok ? {} : { 'Retry-After': String(r.resetIn) }),
    };
}
