const mockQuery = jest.fn();
const mockPing = jest.fn();
jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn().mockImplementation(() => ({ $queryRaw: mockQuery })) }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }));
jest.mock("@/config/runtime", () => ({ validateRuntimeConfig: jest.fn(() => ({ DATABASE_URL: "postgresql://local@localhost/audit_ready" })) }));
jest.mock("@/lib/redis", () => ({ getRedisClient: () => ({ ping: mockPing }) }));

beforeEach(() => { jest.resetModules(); mockQuery.mockReset().mockResolvedValue([{ migration_name: "present" }]); mockPing.mockReset().mockResolvedValue("PONG"); });
afterEach(() => { jest.useRealTimers(); });
it("distinguishes liveness from a ready database/Redis check and disables HTTP caching", async () => {
  const live = (await import("../../app/api/health/route")).GET();
  expect(live.status).toBe(200); expect((await live.json()).check).toBe("liveness");
  const ready = await (await import("../../app/api/health/ready/route")).GET();
  expect(ready.status).toBe(200); expect(ready.headers.get("Cache-Control")).toBe("no-store");
  expect((await ready.json()).checks).toEqual({ configuration: true, database: true, redis: true });
});
it.each(["database", "redis", "schema"])("returns 503 for unavailable %s while liveness stays 200, without leaking failure details", async (failure) => {
  if (failure === "database") mockQuery.mockRejectedValueOnce(new Error("private database URL and account details"));
  if (failure === "schema") mockQuery.mockResolvedValueOnce([]);
  if (failure === "redis") mockPing.mockRejectedValueOnce(new Error("private token and endpoint"));
  const result = await (await import("../../app/api/health/ready/route")).GET();
  expect(result.status).toBe(503);
  const body = await result.json(); expect(body.status).toBe("UNAVAILABLE"); expect(JSON.stringify(body)).not.toContain("private");
  expect((await import("../../app/api/health/route")).GET().status).toBe(200);
});
it("coalesces concurrent probes and refreshes the bounded five-second cached result", async () => {
  jest.useFakeTimers();
  const { getReadiness } = await import("../../lib/readiness");
  const first = await Promise.all([getReadiness(), getReadiness(), getReadiness()]);
  expect(first.every((entry) => entry.status === "READY")).toBe(true);
  expect(mockQuery).toHaveBeenCalledTimes(1); expect(mockPing).toHaveBeenCalledTimes(1);
  await getReadiness(); expect(mockQuery).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(5001); mockPing.mockResolvedValueOnce("unexpected");
  expect((await getReadiness()).status).toBe("UNAVAILABLE"); expect(mockQuery).toHaveBeenCalledTimes(2);
});
it("does not contact providers when configuration itself is invalid", async () => {
  jest.requireMock("@/config/runtime").validateRuntimeConfig.mockImplementationOnce(() => { throw new Error("invalid private setting"); });
  const response = await (await import("../../app/api/health/ready/route")).GET();
  expect(response.status).toBe(503); expect((await response.json()).checks.configuration).toBe(false);
  expect(mockQuery).not.toHaveBeenCalled(); expect(mockPing).not.toHaveBeenCalled();
});
