jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn() } } }));
jest.mock("@/lib/session-token", () => ({ verifyJwtToken: jest.fn() }));
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyJwtToken } from "@/lib/session-token";
import { validateSessionToken } from "@/lib/session-validation";
import { GET } from "@/app/api/auth/me/route";
import { ServiceUnavailableError } from "@/lib/observability";
const account = { id: "buyer", name: "Buyer", email: "buyer@example.invalid", role: "USER", isVerified: true, sellerStatus: "APPROVED", sessionVersion: 0, avatar: null, avatarKey: null, avatarVersion: 0, phone: null };
beforeEach(() => {
  jest.clearAllMocks(); (cookies as jest.Mock).mockResolvedValue({ get: () => ({ value: "signed-test-token" }) });
  (verifyJwtToken as jest.Mock).mockResolvedValue({ sub: account.id, email: account.email, role: account.role, sessionVersion: 0 });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(account);
});
it("keeps invalid/missing/revoked sessions separate from service outages", async () => {
  (verifyJwtToken as jest.Mock).mockResolvedValueOnce(null); expect(await validateSessionToken("invalid")).toBeNull(); expect(prisma.user.findUnique).not.toHaveBeenCalled();
  (cookies as jest.Mock).mockResolvedValueOnce({ get: () => undefined }); const missing = await GET(); expect(missing.status).toBe(200); expect(await missing.json()).toEqual({ success: false, user: null }); expect(missing.headers.get("cache-control")).toContain("no-store");
  (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ ...account, sessionVersion: 1 }); expect(await validateSessionToken("revoked")).toBeNull();
});
it("sanitizes a session-authority database failure before it reaches a page/layout", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (prisma.user.findUnique as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("private SQL password"), { code: "P1001" }));
    let caught: unknown; try { await validateSessionToken("signed"); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ServiceUnavailableError); expect((caught as ServiceUnavailableError).incident.operation).toBe("auth.session");
    expect(JSON.parse(log.mock.calls[0][0]).reference).toBe((caught as ServiceUnavailableError).digest); expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  } finally { log.mockRestore(); }
});
it.each(["authority", "profile"])("returns a correlated 503 for an unavailable %s read, without falsely declaring the session signed out", async (stage) => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    if (stage === "profile") (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(account);
    (prisma.user.findUnique as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("private account query"), { code: "ECONNREFUSED" }));
    const response = await GET(), body = await response.json();
    expect(response.status).toBe(503); expect(body).not.toHaveProperty("user"); expect(body.reference).toBe(response.headers.get("x-error-reference")); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(log).toHaveBeenCalledTimes(1); expect(JSON.parse(log.mock.calls[0][0]).reference).toBe(body.reference); expect(JSON.stringify([body, log.mock.calls])).not.toContain("private account");
  } finally { log.mockRestore(); }
});
it("rechecks the profile revision/role and excludes private avatar/session fields from a confirmed response", async () => {
  const response = await GET(), body = await response.json(); expect(body.success).toBe(true); expect(body.user.id).toBe(account.id); expect(body.user).not.toHaveProperty("avatarKey"); expect(body.user).not.toHaveProperty("sessionVersion");
  (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(account).mockResolvedValueOnce({ ...account, sessionVersion: 1 });
  expect(await (await GET()).json()).toEqual({ success: false, user: null });
});
