jest.mock("@/config/runtime", () => ({ readSweepConfig: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock("@/lib/newsletter", () => ({ sweepNewsletterDeliveries: jest.fn() }));
import { readSweepConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { sweepNewsletterDeliveries } from "@/lib/newsletter";
import { POST } from "@/app/api/internal/newsletter/deliver/route";
const secret = "isolated-newsletter-worker-secret-".repeat(2), request = (value = `Bearer ${secret}`) => new Request("http://localhost/api/internal/newsletter/deliver", { method: "POST", headers: { authorization: value } });
beforeEach(() => { jest.clearAllMocks(); (readSweepConfig as jest.Mock).mockReturnValue({ CHECKOUT_SWEEP_SECRET: secret, CHECKOUT_SWEEP_DATABASE: "audit_newsletter" }); (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ name: "audit_newsletter" }]); (sweepNewsletterDeliveries as jest.Mock).mockResolvedValue({ examined: 1, delivered: 1, deferred: 0, failed: 0 }); });
it("rejects the wrong maintenance credential before database/delivery work", async () => {
  expect((await POST(request("Bearer wrong"))).status).toBe(401); expect(prisma.$queryRaw).not.toHaveBeenCalled(); expect(sweepNewsletterDeliveries).not.toHaveBeenCalled();
});
it("requires the configured database target and admits only one SMTP attempt", async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ name: "other_database" }]); expect((await POST(request())).status).toBe(503); expect(sweepNewsletterDeliveries).not.toHaveBeenCalled();
  const result = await POST(request()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store"); expect(sweepNewsletterDeliveries).toHaveBeenCalledWith(1); expect((await result.json()).delivered).toBe(1);
});
it("does not replace configuration/database failures with fake successful empty runs", async () => {
  (readSweepConfig as jest.Mock).mockImplementationOnce(() => { throw Error("private configuration marker"); }); const missing = await POST(request()); expect(missing.status).toBe(503); expect(await missing.text()).not.toContain("private configuration marker");
  (sweepNewsletterDeliveries as jest.Mock).mockRejectedValueOnce(Error("private recipient and SQL marker")); const failed = await POST(request()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("SQL marker");
});
