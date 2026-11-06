jest.mock("@/lib/prisma", () => ({ prisma: { category: { findMany: jest.fn() }, brand: { findMany: jest.fn() } } }));
jest.mock("@/lib/catalog-listing", () => ({ getCatalogListing: jest.fn(), CatalogQueryError: class extends Error {} }));
jest.mock("@/lib/catalog-options", () => ({ getCatalogOptions: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "192.0.2.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { getCatalogOptions } from "@/lib/catalog-options";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCatalogListing } from "@/lib/catalog-listing";
import { GET as categories } from "@/app/api/categories/route";
import { GET as brands } from "@/app/api/brands/route";
import { GET as products } from "@/app/api/products/route";
import { isIncidentId } from "@/lib/error-reference";
it.each(["categories", "brands", "products"])("returns a correlated redacted 503 for a failed %s read instead of an empty success", async (kind) => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const failure = Object.assign(new Error("private SQL credential and customer@example.invalid"), { code: "P1001" });
    (prisma.category.findMany as jest.Mock).mockRejectedValue(failure); (prisma.brand.findMany as jest.Mock).mockRejectedValue(failure); (getCatalogListing as jest.Mock).mockRejectedValue(failure);
    (getCatalogOptions as jest.Mock).mockRejectedValue(failure);
    const result = kind === "categories" ? await categories(new Request("http://localhost/api/categories")) : kind === "brands" ? await brands(new Request("http://localhost/api/brands")) : await products(new NextRequest("http://localhost/api/products"));
    expect(result.status).toBe(503); expect(result.headers.get("cache-control")).toBe("no-store"); const body = await result.json(); expect(body.success).toBe(false); expect(body.code).toBe("SERVICE_UNAVAILABLE"); expect(isIncidentId(body.reference)).toBe(true); expect(result.headers.get("x-error-reference")).toBe(body.reference); expect(JSON.parse(log.mock.calls.at(-1)![0]).reference).toBe(body.reference);
    expect(JSON.stringify([body, log.mock.calls])).not.toContain("credential"); expect(JSON.stringify([body, log.mock.calls])).not.toContain("customer@"); expect(body).not.toHaveProperty("categories"); expect(body).not.toHaveProperty("brands"); expect(body).not.toHaveProperty("products");
  } finally { log.mockRestore(); }
});
