import { z } from "zod";
import { catalogIdSchema, productPriceSchema, MAX_PRODUCT_DESCRIPTION, MAX_PRODUCT_STOCK } from "@/lib/validations/product";
import { specificationsSchema } from "@/lib/validations/specifications";
import { PRODUCT_STATUSES } from "@/lib/catalog-constants";
const version = z.number().int().min(1).max(2147483646), requestId = z.string().uuid().transform((value) => value.toLowerCase());
const reason = z.string().trim().min(5).max(300).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a single line for the inventory/catalog reason.");
export const maintenanceFieldsSchema = z.object({
  name: z.string().trim().min(3).max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  description: z.string().max(MAX_PRODUCT_DESCRIPTION).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Use ordinary text and line breaks in the description.").nullable(), specifications: specificationsSchema,
  price: productPriceSchema, discountPrice: productPriceSchema.nullable(), categoryId: catalogIdSchema, brandId: catalogIdSchema.nullable(),
}).strict().refine((value) => value.discountPrice === null || value.discountPrice < value.price, "Discount price must be lower than regular price.");
const identity = { id: catalogIdSchema, version, requestId, reason };
export const productMaintenanceMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("edit"), fields: maintenanceFieldsSchema }).strict(),
  z.object({ ...identity, action: z.literal("stock"), inventoryVersion: version, delta: z.number().int().min(-MAX_PRODUCT_STOCK).max(MAX_PRODUCT_STOCK).refine((value) => value !== 0), confirmed: z.literal(true) }).strict(),
  z.object({ ...identity, action: z.literal("archive"), confirmed: z.literal(true) }).strict(),
  z.object({ ...identity, action: z.literal("resubmit"), confirmed: z.literal(true) }).strict(),
]);
export const productMaintenanceQuerySchema = z.object({ mode: z.enum(["list", "record", "history"]).default("list"), id: catalogIdSchema.optional(), requestId: requestId.optional(), q: z.string().trim().max(120).default(""), status: z.enum(["ALL", ...PRODUCT_STATUSES]).default("ALL"), page: z.coerce.number().int().min(1).max(1_000_000).default(1) }).strict().refine((value) => value.mode === "list" || !!value.id);
export type MaintenanceFields = z.infer<typeof maintenanceFieldsSchema>;
export type ProductMaintenanceMutation = z.infer<typeof productMaintenanceMutationSchema>;
