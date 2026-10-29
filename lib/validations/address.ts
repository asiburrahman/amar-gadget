import { z } from "zod";
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text without control characters.");
export const shippingAddressSchema = z.object({
  fullName: text(120, 2),
  phone: text(30, 10).regex(/^\+?[\d\s()-]+$/, "Enter a valid phone number.").refine((value) => { const count = value.replace(/\D/g, "").length; return count >= 10 && count <= 15; }, "Enter 10 to 15 phone digits."),
  street: text(500, 3), city: text(100, 2), district: text(100, 2), zipCode: text(20, 0).nullable().optional(),
}).strict();
export const addressRevisionSchema = z.object({ id: z.string().uuid(), version: z.number().int().min(1).max(2_147_483_646) }).strict();
export const createAddressSchema = z.object({ fields: shippingAddressSchema, makeDefault: z.boolean().optional().default(false) }).strict();
export const updateAddressSchema = addressRevisionSchema.extend({ fields: shippingAddressSchema }).strict();
export const addressPageSchema = z.preprocess((value) => value === undefined || value === null ? 1 : typeof value === "string" && /^\d{1,7}$/.test(value) ? Number(value) : value, z.number().int().min(1).max(1_000_000));
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type SavedAddress = ShippingAddress & { id: string; version: number; isDefault: boolean };
export type AddressPage = { addresses: SavedAddress[]; defaultAddress: SavedAddress | null; page: number; total: number; totalPages: number };
export const MAX_SAVED_ADDRESSES = 20;
