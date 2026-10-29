import { randomUUID } from "node:crypto";
import { getRedisClient } from "@/lib/redis";

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
