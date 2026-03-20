import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRedis() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        return null;
    }
    return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

const redis = createRedis();

function createLimiter(tokens: number, window: string, prefix: string) {
    if (!redis) return null;
    return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(tokens, window as any),
        prefix,
    });
}

export const authLimiter = createLimiter(5, "1 m", "rl:auth");
export const signupLimiter = createLimiter(3, "1 m", "rl:signup");
export const passwordResetLimiter = createLimiter(3, "1 m", "rl:pwreset");
export const apiLimiter = createLimiter(30, "1 m", "rl:api");
export const proofUploadLimiter = createLimiter(20, "1 m", "rl:proof");
export const aiEvaluationLimiter = createLimiter(20, "10 m", "rl:ai-eval");
export const webhookLimiter = createLimiter(60, "1 m", "rl:webhook");

export async function checkRateLimit(
    limiter: Ratelimit | null,
    identifier: string
): Promise<{ limited: boolean; reset?: number }> {
    if (!limiter) return { limited: false };
    const result = await limiter.limit(identifier);
    return { limited: !result.success, reset: result.reset };
}
