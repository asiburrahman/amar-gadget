const keyPattern = /^products\/([A-Za-z0-9-]{1,64})\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;
export function imageKeyOwner(key: string) { return keyPattern.exec(key)?.[1] ?? null; }
export function ownedImageKey(url: string, ownerId: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const key = parsed.pathname.slice(1);
    return imageKeyOwner(key) === ownerId ? key : null;
  } catch { return null; }
}
