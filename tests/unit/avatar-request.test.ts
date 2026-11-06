jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { readAvatarUpload, readAvatarRemoval, avatarFailure } from "@/lib/avatar-request";
import { MAX_AVATAR_BYTES } from "@/lib/avatar-policy";
const json = (body: unknown) => new Request("http://localhost/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("rejects unknown JSON fields, invalid revisions, non-JSON bodies and unsupported data", async () => {
  for (const body of [{}, { avatarVersion: -1, action: "restore-legacy" }, { avatarVersion: 0.5, action: "restore-legacy" }, { avatarVersion: 0, action: "restore-legacy", ownerId: "other" }, { avatarVersion: 0, avatar: "https://remote.invalid/a.png" }, { avatarVersion: 0, avatar: "data:image/svg+xml;base64,PHN2Zz4=" }]) await expect(readAvatarUpload(json(body))).rejects.toThrow();
  await expect(readAvatarUpload(new Request("http://localhost/avatar", { method: "POST", body: "{}" }))).rejects.toMatchObject({ status: 415 });
  expect(await readAvatarUpload(json({ action: "restore-legacy", avatarVersion: 3 }))).toEqual({ avatarVersion: 3, source: null });
  expect(await readAvatarRemoval(json({ avatarVersion: 2 }))).toBe(2);
  await expect(readAvatarRemoval(json({ avatarVersion: 2, avatar: "" }))).rejects.toThrow();
});
it("bounds actual streamed bytes and cancels despite false Content-Length before multipart decoding", async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX_AVATAR_BYTES + 16 * 1024 + 1)); }, cancel });
  const request = new Request("http://localhost/avatar", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit);
  await expect(readAvatarUpload(request)).rejects.toMatchObject({ status: 413 }); expect(cancel).toHaveBeenCalledTimes(1);
});
it("releases a stalled stream after the absolute upload deadline", async () => {
  jest.useFakeTimers(); const cancel = jest.fn();
  try {
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request("http://localhost/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const pending = readAvatarUpload(request), rejection = expect(pending).rejects.toMatchObject({ status: 408, code: "AVATAR_TIMEOUT" });
    await jest.advanceTimersByTimeAsync(15001); await rejection; expect(cancel).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
it("handles tiny chunks without trusting allocation/chunk counts, and times out even if sender cancellation never settles", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ avatarVersion: 4 }));
  const streamed = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  expect(await readAvatarRemoval(new Request("http://localhost/avatar", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: streamed, duplex: "half" } as RequestInit))).toBe(4);
  jest.useFakeTimers();
  try {
    const stalled = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => undefined) });
    const pending = readAvatarRemoval(new Request("http://localhost/avatar", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: stalled, duplex: "half" } as RequestInit));
    const rejected = expect(pending).rejects.toMatchObject({ status: 408 }); await jest.advanceTimersByTimeAsync(15001); await rejected;
  } finally { jest.useRealTimers(); }
});
it("rejects duplicate multipart parts, false lengths and oversized metadata", async () => {
  const form = new FormData(); form.set("file", new Blob(["image"], { type: "image/png" }), "photo.png"); form.append("avatarVersion", "0"); form.append("avatarVersion", "1");
  await expect(readAvatarUpload(new Request("http://localhost/avatar", { method: "POST", body: form }))).rejects.toMatchObject({ code: "AVATAR_REQUEST" });
  for (const length of ["NaN", "-1", "50000000", "2"]) {
    const req = json({ avatarVersion: 0, action: "restore-legacy" }); req.headers.set("Content-Length", length);
    await expect(readAvatarUpload(req)).rejects.toThrow();
  }
});
it("redacts arbitrary provider exceptions and returns private cache and retry headers", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { const response = avatarFailure(new Error("private-provider-secret")); expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(JSON.stringify(await response.json()) + JSON.stringify(log.mock.calls)).not.toContain("private-provider-secret"); }
  finally { log.mockRestore(); }
});
