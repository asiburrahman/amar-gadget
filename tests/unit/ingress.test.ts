import { signIngress, verifyIngress, canonicalIp, canonicalTarget, names } from "../../lib/ingress-protocol.cjs";
import { verifiedIngressIp, isAllowedRequestOrigin } from "../../lib/ingress";
import { getClientIp } from "../../lib/rate-limit";
import { proxy } from "../../proxy";
import { NextRequest } from "next/server";

const secret = "private-test-ingress-key-".repeat(2);
const origin = "https://store.example.invalid";
const previous = { ...process.env };
const sign = (method = "GET", target = "/api/products?q=a%20b", now?: number) => signIngress({ secret, origin, ip: "2001:db8::1", method, target, now });
beforeEach(() => { Object.assign(process.env, { NODE_ENV: "production", APP_URL: origin, TRUSTED_PROXY_SECRET: secret }); });
afterAll(() => { process.env = previous; });

it("accepts actual cryptographic assertions only for the bound origin, method and query", () => {
  const headers = new Headers(sign());
  expect(verifiedIngressIp(headers, "GET", "/api/products?q=a%20b")).toBe("2001:db8::1");
  for (const change of [{ origin: "https://other.example.invalid" }, { method: "POST", target: "/api/products?q=a%20b" }, { method: "GET", target: "/api/products?q=b" }, { secret: "different-private-key-".repeat(3) }]) {
    expect(verifyIngress({ headers, secret, origin, ...change })).toBeNull();
  }
});
it.each(Object.values(names))("rejects missing or altered assertion component %s", (name) => {
  const headers = new Headers(sign()); headers.delete(name);
  expect(verifiedIngressIp(headers)).toBeNull();
  headers.set(name, "forged"); expect(verifiedIngressIp(headers)).toBeNull();
});
it("bounds assertion lifetime and rejects noncanonical or ambiguous values", () => {
  const now = Date.now();
  expect(verifyIngress({ headers: sign("GET", "/", now - 121_000), secret, origin, now })).toBeNull();
  expect(verifyIngress({ headers: sign("GET", "/", now + 6000), secret, origin, now })).toBeNull();
  const headers = sign(); headers[names.ip] = [headers[names.ip], "192.0.2.1"] as unknown as string;
  expect(verifyIngress({ headers, secret, origin })).toBeNull();
});
it.each([["::ffff:192.0.2.1", "192.0.2.1"], ["::ffff:c000:201", "192.0.2.1"], ["2001:0DB8:0:0:0:0:0:1", "2001:db8::1"], ["127.0.0.1", "127.0.0.1"], ["1.2.3.4, 5.6.7.8", null], ["fe80::1%eth0", null], ["unknown", null]])("canonicalizes IP %s", (input, expected) => {
  expect(canonicalIp(input)).toBe(expected);
});
it("normalizes request targets and rejects absolute/network/backslash targets", () => {
  expect(canonicalTarget("/products/../api/products?q=a%20b")).toBe("/api/products?q=a%20b");
  for (const value of ["https://evil.invalid/", "//evil.invalid/", "/\\evil.invalid/"]) expect(() => canonicalTarget(value)).toThrow();
});
it("never grants authority to spoofed forwarding or platform headers", () => {
  const raw = new Headers({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2", "x-vercel-forwarded-for": "192.0.2.3" });
  expect(() => getClientIp(raw)).toThrow("Untrusted request ingress");
  Object.assign(process.env, { NODE_ENV: "development" });
  expect(getClientIp(raw)).toBe("untrusted-development");
  expect(getClientIp(new Headers(sign()))).toBe("2001:db8::1");
});
it("requires the exact browser origin, including server actions and exceptional paths", () => {
  for (const value of ["https://evil.invalid", "https://sub.store.example.invalid", "null", "https://store.example.invalid:444"]) expect(isAllowedRequestOrigin(new Headers({ origin: value }), "POST", "/api/auth/login")).toBe(false);
  expect(isAllowedRequestOrigin(new Headers({ origin }), "POST", "/api/auth/login")).toBe(true);
  expect(isAllowedRequestOrigin(new Headers(), "POST", "/api/auth/login")).toBe(false);
  for (const path of ["/api/stripe/webhook", "/api/internal/checkout/expire"]) {
    expect(isAllowedRequestOrigin(new Headers(), "POST", path)).toBe(true);
    expect(isAllowedRequestOrigin(new Headers({ "next-action": "fake" }), "POST", path)).toBe(false);
  }
});
it("blocks unsigned APIs, pages and actions even at public/static/health paths", async () => {
  for (const path of ["/api/auth/login", "/products", "/api/products", "/file.svg", "/_next/static/fake.js", "/api/health"]) {
    const response = await proxy(new NextRequest(origin + path, { method: "POST", headers: { origin, "next-action": "fake", "x-forwarded-for": "192.0.2.1" } }));
    expect(response.status).toBe(403);
  }
  expect((await proxy(new NextRequest(origin + "/api/products"))).status).toBe(403);
  for (const path of ["/file.svg", "/api/health", "/api/health/ready", "/_next/static/fake.js"]) expect((await proxy(new NextRequest(origin + path))).headers.get("x-middleware-next")).toBe("1");
});
it("passes authenticated requests with canonical host and without raw forwarding authority", async () => {
  const target = "/api/products?q=a%20b";
  const response = await proxy(new NextRequest(origin + target, { headers: { ...sign(), "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2", "x-forwarded-host": "evil.invalid" } }));
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("x-middleware-request-x-forwarded-host")).toBe("store.example.invalid");
  expect(response.headers.get("x-middleware-request-cf-connecting-ip")).toBeNull();
  expect(response.headers.get("x-middleware-request-x-forwarded-for")).toBeNull();
});
