import { randomUUID } from "node:crypto";
import { getRedisClient } from "@/lib/redis";
import { verifiedIngressIp } from "@/lib/ingress";

/**
 * Only the authenticated gateway assertion supplies an IP. Raw forwarding
 * headers and client-selected platform headers are never authority here.
 */
export function getClientIp(headers: Headers): string {
  const ip = verifiedIngressIp(headers);
  if (ip) return ip;
  if (process.env.NODE_ENV === "production") throw new Error("Untrusted request ingress");
  return "untrusted-development";
}

export async function rateLimit(
  ip: string,
  limit = 100,
  windowInSeconds = 60,
  namespace = "default"
) {
  try {
    const redis = getRedisClient();
    if (!redis) {
      if (process.env.NODE_ENV === "production") {
        console.error("Upstash Redis config missing in production; rate-limited request denied.");
        return { success: false, limit, remaining: 0 };
      }
      return {
        success: true,
        limit,
        remaining: limit,
      };
    }

    const key = `ratelimit:${namespace}:${ip}`;
    const now = Math.floor(Date.now() / 1000);
    const clearBefore = now - windowInSeconds;

    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, clearBefore);
    multi.zadd(key, { score: now, member: randomUUID() });
    multi.zcard(key);
    multi.expire(key, windowInSeconds);

    const results = await multi.exec();
    const requestCount = results[2] as number;

    return {
      success: requestCount <= limit,
      limit,
      remaining: Math.max(0, limit - requestCount),
    };
  } catch {
    console.error("Distributed rate limiting is unavailable.");
    return {
      success: process.env.NODE_ENV !== "production",
      limit,
      remaining: 0,
    };
  }
}
