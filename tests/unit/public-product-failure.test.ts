jest.mock("@/lib/prisma", () => ({ prisma: { product: { findFirst: jest.fn(), findUnique: jest.fn() }, $queryRaw: jest.fn() } }));
jest.mock("@/lib/reviews", () => ({ publishedReviewWhere: {}, reviewDisplayName: (name: string) => name }));
jest.mock("@/lib/product-media-policy", () => ({ publicProductMedia: () => ({ imageUrl: null, images: [] }) }));
import { prisma } from "@/lib/prisma";
import { getPublicProduct } from "@/lib/public-product";
import { ServiceUnavailableError } from "@/lib/observability";
import { isIncidentId } from "@/lib/error-reference";
beforeEach(() => { jest.clearAllMocks(); (prisma.product.findFirst as jest.Mock).mockReset().mockResolvedValue(null); (prisma.product.findUnique as jest.Mock).mockReset().mockResolvedValue(null); (prisma.$queryRaw as jest.Mock).mockReset().mockResolvedValue([]); });
it("returns genuine not-found only after successful lookup queries confirm absence", async () => {
  expect(await getPublicProduct("missing-product")).toBeNull(); expect(prisma.product.findFirst).toHaveBeenCalledTimes(2); expect(prisma.product.findUnique).toHaveBeenCalledTimes(1); expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
});
it.each(["slug", "hidden-identity", "legacy-alias"])("preserves a failed %s lookup as a correlated service failure rather than a missing product", async (stage) => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const failure = Object.assign(new Error("private SQL password and customer email"), { code: "P1001" });
    if (stage === "slug") (prisma.product.findFirst as jest.Mock).mockRejectedValueOnce(failure);
    if (stage === "hidden-identity") (prisma.product.findUnique as jest.Mock).mockRejectedValueOnce(failure);
    if (stage === "legacy-alias") (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(failure);
    let caught: unknown; try { await getPublicProduct("some-product"); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ServiceUnavailableError); const error = caught as ServiceUnavailableError;
    expect(isIncidentId(error.digest)).toBe(true); expect(JSON.parse(log.mock.calls[0][0]).reference).toBe(error.digest); expect(JSON.stringify([caught, log.mock.calls])).not.toContain("password"); expect(JSON.stringify([caught, log.mock.calls])).not.toContain("customer email");
  } finally { log.mockRestore(); }
});
