import { z } from "zod";
import { MAX_PRODUCT_IMAGES } from "@/lib/product-media-policy";
import { MAX_PRODUCT_PRICE, MAX_PRODUCT_STOCK, MAX_PRODUCT_DESCRIPTION, PRODUCT_STATUSES } from "@/lib/catalog-constants";
import { catalogQuerySchema } from "@/lib/validations/catalog-query";
export { MAX_PRODUCT_PRICE, MAX_PRODUCT_STOCK, MAX_PRODUCT_DESCRIPTION } from "@/lib/catalog-constants";

export const catalogIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, "Invalid catalog identifier.");
export const productPriceSchema = z.number().min(0.01, "Price must be at least 0.01 BDT.").max(MAX_PRODUCT_PRICE, "Price exceeds the database limit.").multipleOf(0.01, "Use at most two decimal places.");
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const sellerStatusSchema = z.enum(["APPROVED", "BLOCKED", "PENDING", "REJECTED"]);
export const productImageUrlSchema = z.string().min(1).max(2048).refine((value) => {
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/")) return /^\/(?:images\/|assets\/)?[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/.test(value) && !/(?:^|\/)\.\.(?:\/|$)/.test(value) && !value.startsWith("//");
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash; } catch { return false; }
}, "Use a bounded HTTPS image URL or a local public asset path.");
export const productUploadKeySchema = z.string().max(160).regex(/^products\/[A-Za-z0-9-]{1,64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/, "Select a valid uploaded product image.");
const fields = {
  name: z.string().trim().min(3, "Product name must be at least 3 characters.").max(120),
  description: z.string().max(MAX_PRODUCT_DESCRIPTION).optional(),
  price: productPriceSchema,
  discountPrice: productPriceSchema.nullable().optional(),
  stock: z.number().int().min(0).max(MAX_PRODUCT_STOCK),
  categoryId: catalogIdSchema,
  brandId: catalogIdSchema.nullable().optional(),
  isFeatured: z.boolean().optional().default(false),
};
function discountValid(data: { price?: number; discountPrice?: number | null }) { return data.price === undefined || data.discountPrice == null || data.discountPrice < data.price; }
const discountRule = { message: "Discount price must be lower than the regular price.", path: ["discountPrice"] };
const imageList = z.array(productImageUrlSchema).max(MAX_PRODUCT_IMAGES).refine((values) => new Set(values).size === values.length, "Gallery images must be distinct.");

const createFields = z.object({
  ...fields,
  imageUrl: productImageUrlSchema.optional(),
  images: imageList.optional().default([]),
  uploadKeys: z.array(productUploadKeySchema).min(1, "Upload at least one product image.").max(MAX_PRODUCT_IMAGES).refine((values) => new Set(values).size === values.length, "Select distinct uploaded images."),
}).strict();
export const createProductSchema = createFields.refine(discountValid, discountRule);

export const updateProductSchema = createFields.partial().extend({ id: catalogIdSchema }).strict().refine(discountValid, discountRule);
export const productPriceUpdateSchema = z.object({ productId: catalogIdSchema, price: productPriceSchema, discountPrice: productPriceSchema.nullable().optional() }).strict().refine(discountValid, discountRule);
export const productStatusUpdateSchema = z.object({ productId: catalogIdSchema, status: productStatusSchema }).strict();
export const sellerStatusUpdateSchema = z.object({ sellerId: catalogIdSchema, sellerStatus: sellerStatusSchema }).strict();
export const productApprovalSchema = z.object({ ...fields, imageUrl: productImageUrlSchema.nullable(), images: imageList }).strict().refine(discountValid, discountRule).refine((data) => Boolean(data.imageUrl) && (!data.images.length || data.images[0] === data.imageUrl), "A valid cover and matching ordered gallery are required before approval.");

export const productQuerySchema = catalogQuerySchema;

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
