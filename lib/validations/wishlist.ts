import { z } from "zod";
import { catalogIdSchema } from "@/lib/validations/product";
export const MAX_WISHLIST_ITEMS = 200;
export const wishlistIdsSchema = z.array(catalogIdSchema).min(1).max(MAX_WISHLIST_ITEMS).refine((ids) => new Set(ids).size === ids.length, "Choose distinct products.");
export const wishlistAddSchema = z.object({ productIds: wishlistIdsSchema, merge: z.boolean().optional().default(false) }).strict();
export const wishlistDeleteSchema = z.union([z.object({ productIds: wishlistIdsSchema }).strict(), z.object({ clear: z.literal(true), version: z.number().int().min(0).max(2_147_483_646) }).strict()]);
export type WishlistProduct = { id: string; slug: string; name: string; price: number; discountPrice: number | null; stock: number; imageUrl: string | null; category: string };
export type WishlistEntry = { id: string; product: WishlistProduct | null };
export type WishlistSnapshotPage = { ownerId: string; version: number; items: WishlistEntry[]; page: number; total: number; totalPages: number };
