import { z } from "zod";
import { catalogIdSchema, productImageUrlSchema, productUploadKeySchema } from "./product";
export const galleryItemSchema = z.discriminatedUnion("source", [z.object({ source: z.literal("existing"), url: productImageUrlSchema }).strict(), z.object({ source: z.literal("upload"), key: productUploadKeySchema }).strict()]);
export const replaceGallerySchema = z.object({ productId: catalogIdSchema, version: z.number().int().min(1).max(2_147_483_646), items: z.array(galleryItemSchema).min(1, "Keep or upload at least one image.").max(8) }).strict()
  .refine((data) => new Set(data.items.map((item) => item.source === "existing" ? item.url : item.key)).size === data.items.length, "Choose distinct gallery images.");
export type GalleryItem = z.infer<typeof galleryItemSchema>;
