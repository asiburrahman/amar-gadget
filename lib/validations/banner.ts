import { z } from "zod";
export const bannerPlacementSchema = z.enum(["HERO", "PROMO", "AD"]);
export function isBannerLink(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) return false;
    const url = new URL(value, "https://banner.example.invalid");
    return url.origin === "https://banner.example.invalid" && !decodeURIComponent(url.pathname).startsWith("//") && !/^\/(?:api|admin|member|user|login|register)(?:\/|$)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text.");
export const bannerFieldsSchema = z.object({ title: text(160), subtitle: text(500).nullable(), linkUrl: z.string().trim().refine(isBannerLink, "Use a public storefront path beginning with a single slash.").nullable(), placement: bannerPlacementSchema, position: z.number().int().min(0).max(1_000_000), isActive: z.boolean() }).strict();
const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/), version = z.number().int().min(1).max(2147483646), requestId = z.string().uuid().transform((value) => value.toLowerCase());
const uploadKey = z.string().max(160).regex(/^products\/[A-Za-z0-9-]{1,64}\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/);
export const bannerMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId, fields: bannerFieldsSchema, uploadKey }).strict(),
  z.object({ action: z.literal("update"), requestId, id, version, fields: bannerFieldsSchema }).strict(),
  z.object({ action: z.literal("activation"), requestId, id, version, isActive: z.boolean() }).strict(),
  z.object({ action: z.literal("image"), requestId, id, version, uploadKey }).strict(),
  z.object({ action: z.literal("delete"), requestId, id, version }).strict(),
]);
export const bannerQuerySchema = z.object({ mode: z.enum(["list", "record", "history"]).default("list"), id: id.optional(), requestId: requestId.optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), q: z.string().trim().max(160).default(""), placement: z.enum(["ALL", "HERO", "PROMO", "AD"]).default("ALL"), status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL") }).strict().refine((value) => value.mode === "list" || !!value.id);
export type BannerMutation = z.infer<typeof bannerMutationSchema>;
export type BannerFields = z.infer<typeof bannerFieldsSchema>;
