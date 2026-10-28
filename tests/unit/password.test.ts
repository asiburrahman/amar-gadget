import crypto from "node:crypto";
import { hashPassword, verifyPassword, passwordNeedsRehash, PasswordWorkloadBusy } from "../../lib/password";

it("creates random-salted versioned hashes and verifies through timing-safe comparison", async () => {
  const password = "A strong password!123";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).toMatch(/^scrypt\$v1\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  expect(first).not.toBe(second);
  const compare = jest.spyOn(crypto, "timingSafeEqual");
  try {
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}!`, first)).toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
    expect(passwordNeedsRehash(first)).toBe(false);
  } finally { compare.mockRestore(); }
});

it("preserves the legacy salt encoding, spaces and Unicode without normalizing passwords", async () => {
  const password = "  বাংলা পাসওয়ার্ড é!123  ";
  const salt = crypto.randomBytes(16).toString("hex");
  const old = `${salt}:${crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex")}`;
  expect(await verifyPassword(password, old)).toBe(true);
  expect(await verifyPassword(password.trim(), old)).toBe(false);
  expect(passwordNeedsRehash(old)).toBe(true);
  const upgraded = await hashPassword(password);
  expect(await verifyPassword(password, upgraded)).toBe(true);
  expect(await verifyPassword(password.normalize("NFD"), upgraded)).toBe(false);
});

it.each([null, "", "bad:hash", "0".repeat(32) + ":" + "0".repeat(127), "scrypt$v1$999999999$8$2$" + "0".repeat(32) + "$" + "0".repeat(128)])("rejects malformed/unsupported credentials without trusting stored work factors: %s", async (stored) => {
  expect(await verifyPassword("Test password!123", stored)).toBe(false);
});

it("does not truncate long passwords or block the event loop with synchronous derivation", async () => {
  const password = "x".repeat(4096) + "A";
  const work = hashPassword(password);
  let ticked = false;
  await new Promise<void>((resolve) => setTimeout(() => { ticked = true; resolve(); }, 0));
  expect(ticked).toBe(true);
  const hash = await work;
  expect(await verifyPassword(password, hash)).toBe(true);
  expect(await verifyPassword("x".repeat(4096) + "B", hash)).toBe(false);
});

it("bounds active memory work and rejects excess/timed-out queued jobs without leaking slots", async () => {
  jest.useFakeTimers();
  const callbacks: ((error: Error | null, key: Buffer) => void)[] = [];
  const derive = jest.spyOn(crypto, "scrypt").mockImplementation(((...args: unknown[]) => {
    callbacks.push(args[args.length - 1] as (error: Error | null, key: Buffer) => void);
  }) as typeof crypto.scrypt);
  try {
    const results = Promise.allSettled(Array.from({ length: 19 }, () => hashPassword("Load test!123")));
    expect(callbacks).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(5_001);
    callbacks.splice(0).forEach((callback) => callback(null, Buffer.alloc(64)));
    const settled = await results;
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    for (const result of settled) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(PasswordWorkloadBusy);
    const retry = hashPassword("Retry password!123");
    callbacks.shift()!(null, Buffer.alloc(64));
    await expect(retry).resolves.toMatch(/^scrypt\$/);
  } finally { derive.mockRestore(); jest.useRealTimers(); }
});
