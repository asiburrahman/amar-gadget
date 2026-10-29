import { Redis } from "@upstash/redis";
import { readRedisConfig } from "@/config/runtime";

let cached: { url: string; token: string; client: Redis } | undefined;
export function getRedisClient() {
  const config = readRedisConfig();
  if (!config) return null;
  if (!cached || cached.url !== config.url || cached.token !== config.token) {
    cached = { ...config, client: new Redis({ ...config, retry: false, signal: () => AbortSignal.timeout(2000) }) };
  }
  return cached.client;
}
