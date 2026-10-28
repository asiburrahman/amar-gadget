import { randomBytes, scrypt, pbkdf2, timingSafeEqual } from "node:crypto";

// OWASP's 64 MiB scrypt configuration. Costs read from storage are strictly
// allowlisted; callers cannot select arbitrary memory/CPU parameters.
const OPTIONS = { N: 65_536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 };
const PREFIX = "scrypt$v1$65536$8$2$";
const CURRENT = /^scrypt\$v1\$65536\$8\$2\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const LEGACY = /^([a-f0-9]{32}):([a-f0-9]{128})$/;
let active = 0;
type Waiter = { start: () => void; timer: ReturnType<typeof setTimeout> };
const waiting: Waiter[] = [];

export class PasswordWorkloadBusy extends Error {
  constructor() { super("Password service is busy. Please retry shortly."); }
}

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active < 2) active++;
  else {
    if (waiting.length >= 16) throw new PasswordWorkloadBusy();
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { start: resolve, timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) { waiting.splice(index, 1); reject(new PasswordWorkloadBusy()); }
      }, 5_000) };
      waiting.push(waiter);
    });
  }
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.start(); }
    else active--;
  }
}

function derive(password: string, salt: Buffer) {
  return withSlot(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  }));
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || !password.length) throw new TypeError("A nonempty password is required.");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${PREFIX}${salt.toString("hex")}$${key.toString("hex")}`;
}

export function passwordNeedsRehash(storedHash: string): boolean { return LEGACY.test(storedHash); }

export function passwordHashStatus(storedHash: string | null): "current" | "legacy" | "missing" | "unsupported" {
  if (!storedHash) return "missing";
  return CURRENT.test(storedHash) ? "current" : LEGACY.test(storedHash) ? "legacy" : "unsupported";
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (typeof password !== "string") return false;
  const current = typeof storedHash === "string" ? CURRENT.exec(storedHash) : null;
  if (current) return timingSafeEqual(await derive(password, Buffer.from(current[1], "hex")), Buffer.from(current[2], "hex"));
  const legacy = typeof storedHash === "string" ? LEGACY.exec(storedHash) : null;
  if (legacy) {
    // The previous format fed the hex salt as UTF-8 text, not raw bytes.
    // Preserve that exact contract without trimming or normalizing passwords.
    const key = await withSlot(() => new Promise<Buffer>((resolve, reject) => {
      pbkdf2(password, legacy[1], 1000, 64, "sha512", (error, value) => error ? reject(error) : resolve(value));
    }));
    if (timingSafeEqual(key, Buffer.from(legacy[2], "hex"))) return true;
  }
  // Equalize KDF work for nonexistent/malformed credentials and incorrect
  // legacy passwords. This computation never authenticates or persists data.
  await derive(password, Buffer.alloc(16));
  return false;
}
