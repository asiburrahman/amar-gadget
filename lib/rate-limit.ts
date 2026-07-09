import { Redis } from "@upstash/redis";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

// Conditionally initialize to prevent crashes if Redis is unconfigured (like in local dev)
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

/**
 * Extracts the real client IP address securely, prioritizing proxy headers 
 * from Vercel, Cloudflare, and standard load balancers.
 */
export function getClientIp(headers: Headers): string {
  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp;

  const vercelIp = headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp;

  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const ips = xForwardedFor.split(",").map((ip) => ip.trim());
    if (ips[0]) return ips[0];
  }

  const xRealIp = headers.get("x-real-ip");
  if (xRealIp) return xRealIp;

  return "127.0.0.1";
}

export async function rateLimit(ip: string, limit = 100, windowInSeconds = 60) {
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      console.warn("⚠️ Upstash Redis config missing in production! Rate limiter bypassed.");
    }
    return {
      success: true,
      limit,
      remaining: limit,
    };
  }

  try {
    const key = `ratelimit:${ip}`;
    const now = Math.floor(Date.now() / 1000);
    const clearBefore = now - windowInSeconds;

    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, clearBefore);
    multi.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    multi.zcard(key);
    multi.expire(key, windowInSeconds);

    const results = await multi.exec();
    const requestCount = results[2] as number;

    return {
      success: requestCount <= limit,
      limit,
      remaining: Math.max(0, limit - requestCount),
    };
  } catch (error) {
    console.error("Rate limiting execution failed:", error);
    // Graceful fail-open: allow request to proceed under disaster recovery scenarios
    return {
      success: true,
      limit,
      remaining: 0,
    };
  }
}