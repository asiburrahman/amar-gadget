jest.mock("@/config/runtime", () => ({ readSweepConfig: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock("@/lib/notification-delivery", () => ({ sweepNotificationEvents: jest.fn() }));
import { readSweepConfig } from "@/config/runtime";
import { prisma } from "@/lib/prisma";
import { sweepNotificationEvents } from "@/lib/notification-delivery";
import { POST } from "@/app/api/internal/notifications/deliver/route";
const secret = "test-notification-worker-secret-".repeat(2), request = (value = `Bearer ${secret}`) => new Request("http://localhost/api/internal/notifications/deliver", { method: "POST", headers: { authorization: value } });
beforeEach(() => { jest.clearAllMocks(); (readSweepConfig as jest.Mock).mockReturnValue({ CHECKOUT_SWEEP_SECRET: secret, CHECKOUT_SWEEP_DATABASE: "audit_notifications" }); (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ name: "audit_notifications" }]); (sweepNotificationEvents as jest.Mock).mockResolvedValue({ checked: 1, delivered: 1, inserted: 1, progressed: 0, skipped: 0, deferred: 0, dead: 0 }); });
it("requires the actual maintenance credential before any database or delivery work", async () => {
  expect((await POST(request("Bearer incorrect"))).status).toBe(401); expect(prisma.$queryRaw).not.toHaveBeenCalled(); expect(sweepNotificationEvents).not.toHaveBeenCalled();
});
it("enforces the configured database and returns only confirmed bounded worker results", async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ name: "other_database" }]); expect((await POST(request())).status).toBe(503); expect(sweepNotificationEvents).not.toHaveBeenCalled(); const result = await POST(request()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store"); expect(sweepNotificationEvents).toHaveBeenCalledWith(10); expect((await result.json()).inserted).toBe(1);
});
it("does not disguise a configuration or database failure as a successful empty delivery", async () => {
  (readSweepConfig as jest.Mock).mockImplementationOnce(() => { throw new Error("private configuration value"); }); const missing = await POST(request()); expect(missing.status).toBe(503); expect(await missing.text()).not.toContain("private configuration");
  (sweepNotificationEvents as jest.Mock).mockRejectedValueOnce(new Error("private SQL diagnostic")); const failed = await POST(request()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private SQL");
});
