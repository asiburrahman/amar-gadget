jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/customer-orders-read", () => ({ readCustomerOrders: jest.fn() }));
import { getCurrentUser } from "@/lib/session";
import { readCustomerOrders } from "@/lib/customer-orders-read";
import { GET } from "@/app/api/orders/route";
import { ReadAccessError, ReadPageError } from "@/lib/protected-read";
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
const session = getCurrentUser as jest.Mock, read = readCustomerOrders as jest.Mock;
const request = (query = "") => new Request(`http://localhost/api/orders${query}`);
beforeEach(() => { jest.clearAllMocks(); session.mockResolvedValue({ id: "buyer", role: "USER" }); });
it("requires authentication before reading private orders", async () => {
  session.mockResolvedValue(null); const response = await GET(request()); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store"); expect(read).not.toHaveBeenCalled();
});
it.each(["?page=0", "?page=2&page=3", "?userId=other", "?status=forged"])("rejects malformed or foreign-scope input %s", async (query) => {
  expect((await GET(request(query))).status).toBe(400); expect(read).not.toHaveBeenCalled();
});
it("returns explicit server pages without leaking financial BigInts, customer or item-private data", async () => {
  read.mockResolvedValue({ total: 23, page: 2, pageSize: 20, totalPages: 2, counts: { ALL: 23 }, orders: [{ id: "order", status: "PENDING", paymentMethod: "COD", paymentStatus: "UNPAID", trackingNumber: "tracking", createdAt: new Date("2026-11-03Z"), total: "100", refundedCents: BigInt(0), userId: "private", items: [{ quantity: 2, productName: "private item" }] }] });
  const response = await GET(request("?page=2&q=Original")), body = await response.json();
  expect(response.status).toBe(200); expect(body.pagination).toEqual({ total: 23, page: 2, pageSize: 20, totalPages: 2 }); expect(body.orders[0].itemsCount).toBe(2);
  expect(JSON.stringify(body)).not.toContain("private"); expect(read).toHaveBeenCalledWith({ id: "buyer", role: "USER" }, { page: 2, q: "Original", status: "ALL" });
});
it.each([[new ReadAccessError("changed"), 401], [new ReadPageError("Page unavailable"), 400]])("distinguishes expected access/page failures", async (error, status) => {
  read.mockRejectedValue(error); expect((await GET(request())).status).toBe(status);
});
it("returns correlated 503 on a session/database outage instead of a successful empty list", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    session.mockRejectedValue(Object.assign(new Error("private SQL credentials"), { code: "ECONNREFUSED" }));
    const response = await GET(request()), body = await response.json();
    expect(response.status).toBe(503); expect(body).not.toHaveProperty("orders"); expect(body.reference).toBe(response.headers.get("x-error-reference"));
    expect(JSON.parse(log.mock.calls[0][0]).reference).toBe(body.reference); expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  } finally { log.mockRestore(); }
});
