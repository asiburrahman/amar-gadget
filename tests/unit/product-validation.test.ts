import { createProductSchema, productPriceUpdateSchema, productStatusUpdateSchema, sellerStatusUpdateSchema, updateProductSchema, MAX_PRODUCT_PRICE } from "../../lib/validations/product";

const key = "products/owner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";
const input = { name: "Real gadget", price: 100, stock: 1, categoryId: "category-1", uploadKeys: [key] };

it.each([0, -1, NaN, Infinity, -Infinity, 100_000_000, 1.001, "100", null, {}, []])("rejects an invalid price on both create and admin update: %p", (price) => {
  expect(createProductSchema.safeParse({ ...input, price }).success).toBe(false);
  expect(productPriceUpdateSchema.safeParse({ productId: "product-1", price }).success).toBe(false);
});
it.each([0.01, 0.29, 0.3, 19.99, 100, MAX_PRODUCT_PRICE])("accepts exact two-decimal database-range prices: %p", (price) => {
  expect(createProductSchema.safeParse({ ...input, price }).success).toBe(true);
});
it.each([0, -1, NaN, Infinity, 1.001, 100, 101, "50"])("rejects invalid discounts without silent rounding: %p", (discountPrice) => {
  expect(createProductSchema.safeParse({ ...input, discountPrice }).success).toBe(false);
  expect(productPriceUpdateSchema.safeParse({ productId: "product-1", price: 100, discountPrice }).success).toBe(false);
});
it("permits explicit discount clearing and a valid partial update, while validating paired values", () => {
  expect(productPriceUpdateSchema.safeParse({ productId: "product-1", price: 100, discountPrice: null }).success).toBe(true);
  expect(updateProductSchema.safeParse({ id: "product-1", price: 1, discountPrice: 2 }).success).toBe(false);
  expect(updateProductSchema.safeParse({ id: "product-1", name: "New name" }).success).toBe(true);
});
it.each([{ name: "   " }, { name: "x".repeat(121) }, { description: "x".repeat(20_001) }, { stock: 1.5 }, { stock: -1 }, { stock: 2_147_483_648 }, { stock: "2" }, { categoryId: "x".repeat(65) }, { brandId: {} }, { uploadKeys: [] }, { uploadKeys: [key, key] }, { uploadKeys: Array.from({ length: 9 }, (_, index) => key.replace("aaaaaaaa.png", `${String(index).padStart(8, "a")}.png`)) }, { uploadKeys: ["products/owner/../another.png"] }, { imageUrl: "data:image/png;base64,AAA" }, { imageUrl: "javascript:alert(1)" }, { imageUrl: "https://user:password@media.example.invalid/photo.png" }, { imageUrl: "/api/user/profile" }, { imageUrl: "/images/%2e%2e/api.png" }, { images: Array(9).fill("https://media.example.invalid/photo.png") }, { sellerId: "another-user" }, { status: "APPROVED" }, { role: "ADMIN" }])("bounds product fields and rejects forged/active media or mass assignment: %p", (changes) => {
  expect(createProductSchema.safeParse({ ...input, ...changes }).success).toBe(false);
});
it("validates runtime status enums and identifiers rather than relying on TypeScript unions", () => {
  for (const status of ["PAID", "approved", {}, null, undefined, ["APPROVED"]]) expect(productStatusUpdateSchema.safeParse({ productId: "product-1", status }).success).toBe(false);
  expect(productStatusUpdateSchema.safeParse({ productId: "", status: "APPROVED" }).success).toBe(false);
  expect(sellerStatusUpdateSchema.safeParse({ sellerId: "seller-1", sellerStatus: "ADMIN" }).success).toBe(false);
  for (const status of ["PENDING_APPROVAL", "APPROVED", "REJECTED"]) expect(productStatusUpdateSchema.safeParse({ productId: "product-1", status }).success).toBe(true);
});
