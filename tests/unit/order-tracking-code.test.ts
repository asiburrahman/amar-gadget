import { Prisma } from "@prisma/client";
import { withOrderTrackingRetry } from "@/lib/order-tracking-code";

function databaseError(index = "Order_trackingNumber_key", modelName = "Order", code = "P2002") {
  return new Prisma.PrismaClientKnownRequestError("Private database diagnostic", { clientVersion: "7.10.1", code,
    meta: { modelName, driverAdapterError: { cause: { constraint: { index } } } } });
}

it("allocates 128 random bits in a bounded plain-text order reference", async () => {
  const codes = new Set<string>();
  for (let index = 0; index < 50; index++) {
    const code = await withOrderTrackingRetry(async (value) => value);
    expect(code).toMatch(/^AG-[A-F0-9]{32}$/); codes.add(code);
  }
  expect(codes.size).toBe(50);
});

it("retries only a rolled-back order tracking collision with a fresh reference", async () => {
  const create = jest.fn().mockRejectedValueOnce(databaseError()).mockResolvedValueOnce({ id: "saved-order" });
  expect(await withOrderTrackingRetry(create)).toEqual({ id: "saved-order" });
  expect(create).toHaveBeenCalledTimes(2); expect(create.mock.calls[0][0]).not.toBe(create.mock.calls[1][0]);
});

it.each([
  databaseError("Order_checkoutTokenHash_key"), databaseError("Order_pkey"), databaseError("Order_trackingNumber_key", "Product"),
  databaseError("Order_trackingNumber_key", "Order", "P2004"), { code: "P2002", meta: { modelName: "Order" } }, Error("Transport failure"),
])("does not replay unrelated database, business or transport errors", async (error) => {
  const create = jest.fn().mockRejectedValue(error);
  await expect(withOrderTrackingRetry(create)).rejects.toBe(error); expect(create).toHaveBeenCalledTimes(1);
});

it("bounds repeated collisions to three attempts and preserves the final error", async () => {
  const error = databaseError(), create = jest.fn().mockRejectedValue(error);
  await expect(withOrderTrackingRetry(create)).rejects.toBe(error); expect(create).toHaveBeenCalledTimes(3);
});
