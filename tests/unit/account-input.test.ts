jest.mock("@/lib/otp-response", () => ({ otpErrorResponse: jest.fn(() => new Response(null, { status: 503 })) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { readAccountJson, accountErrorResponse, limitAccountIp, limitAccountIdentity } from "../../lib/account-request";
import { rateLimit } from "@/lib/rate-limit";
import { newPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, changePasswordSchema, profileUpdateSchema } from "../../lib/validations/auth";

const email = "person@example.invalid";
const request = (body: string, headers?: HeadersInit) => new Request("http://localhost/input-test", { method: "POST", body, headers });
beforeEach(() => { jest.clearAllMocks(); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); });

it.each(["short", "alllowercase123!", "ALLUPPERCASE123!", "MissingNumber!", "MissingSpecial123", "A1!" + "a".repeat(126)])("applies the same new-password rejection to signup/reset/change: %s", (password) => {
  expect(newPasswordSchema.safeParse(password).success).toBe(false);
  expect(registerSchema.safeParse({ name: "Person", email, password }).success).toBe(false);
  expect(resetPasswordSchema.safeParse({ email, otp: "012345", newPassword: password }).success).toBe(false);
  expect(changePasswordSchema.safeParse({ currentPassword: "old", newPassword: password, confirmPassword: password }).success).toBe(false);
});
it("preserves existing password bytes at login and accepts long valid new passphrases", () => {
  expect(loginSchema.parse({ email: " Person@Example.invalid ", password: " old " })).toEqual({ email, password: " old " });
  expect(newPasswordSchema.safeParse("A1!" + "a".repeat(125)).success).toBe(true);
  expect(loginSchema.safeParse({ email, password: "a".repeat(4097) }).success).toBe(false);
});
it("rejects bounded profile violations, privilege fields and unsafe URLs before a write", () => {
  for (const data of [{ role: "ADMIN" }, {}, { name: "a".repeat(121) }, { name: "Invalid\0name" }, { phone: "1".repeat(33) }, { avatar: "not a URL" }, { avatar: "javascript:alert(1)" }, { avatar: "https://user:pass@example.invalid/avatar.png" }, { avatar: "data:image/svg+xml;base64,PHN2Zz4=" }, { address: { street: "incomplete" } }]) {
    expect(profileUpdateSchema.safeParse(data).success).toBe(false);
  }
  expect(profileUpdateSchema.parse({ name: " Person ", phone: "" })).toEqual({ name: "Person", phone: "" });
});
it("reads JSON exactly at its byte limit and returns controlled malformed-body failures", async () => {
  expect(await readAccountJson(request('{"a":1}'), 7)).toEqual({ a: 1 });
  for (const body of ["", "{", "not json"]) {
    try { await readAccountJson(request(body)); throw new Error("Malformed JSON accepted"); }
    catch (error) { expect(accountErrorResponse(error).status).toBe(400); }
  }
});
it("bounds actual streamed bytes without trusting Content-Length and cancels oversized input", async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("12345678")); controller.enqueue(new TextEncoder().encode("90123456")); }, cancel });
  const req = new Request("http://localhost/stream", { method: "POST", body: stream, duplex: "half", headers: { "Content-Length": "1" } } as RequestInit);
  try { await readAccountJson(req, 10); throw new Error("Oversized stream accepted"); }
  catch (error) { expect(accountErrorResponse(error).status).toBe(413); }
  expect(cancel).toHaveBeenCalledTimes(1);
  try { await readAccountJson(request("{}", { "Content-Length": "100000" }), 10); throw new Error("Oversized declaration accepted"); }
  catch (error) { expect(accountErrorResponse(error).status).toBe(413); }
});
it("uses separate account and IP limiter keys and returns retry metadata on a denial", async () => {
  const req = request("{}");
  await limitAccountIp(req, "password-change", 5);
  await limitAccountIdentity(email, "password-change");
  const calls = (rateLimit as jest.Mock).mock.calls;
  expect(calls[0]).toEqual(["192.0.2.1", 5, 60, "password-change:ip"]);
  expect(calls[1][0]).toMatch(/^[a-f0-9]{64}$/);
  expect(calls[1][3]).toBe("password-change:account");
  expect(JSON.stringify(calls)).not.toContain(email);
  (rateLimit as jest.Mock).mockResolvedValue({ success: false });
  try { await limitAccountIdentity(email, "password-change"); throw new Error("Denied limit accepted"); }
  catch (error) { const response = accountErrorResponse(error); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("600"); }
});
