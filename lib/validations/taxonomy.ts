import { z } from "zod";
const kind = z.enum(["category", "brand"]);
const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const requestId = z.string().uuid().transform((value) => value.toLowerCase());
const version = z.number().int().min(1).max(2147483646);
const fields = z.object({
  name: z.string().max(300).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).transform((value) => value.normalize("NFKC").trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(100)),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: id.nullable().default(null),
}).strict();
export const taxonomyMutationSchema = z.discriminatedUnion("action", [
  z.object({ kind, action: z.literal("create"), requestId, fields }).strict(),
  z.object({ kind, action: z.literal("update"), requestId, id, version, fields }).strict(),
  z.object({ kind, action: z.literal("delete"), requestId, id, version }).strict(),
  z.object({ kind, action: z.literal("image"), requestId, id, version, uploadKey: z.string().max(160).regex(/^products\/[A-Za-z0-9-]{1,64}\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/).nullable() }).strict(),
]).refine((value) => value.kind !== "brand" || !("fields" in value) || value.fields.parentId === null, "Brands do not have parent categories.");
export const taxonomyQuerySchema = z.object({
  kind, mode: z.enum(["list", "parents", "history", "record"]).default("list"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  q: z.string().trim().max(80).default(""), id: id.optional(), requestId: requestId.optional(),
}).strict().refine((value) => !["history", "record"].includes(value.mode) || !!value.id, "Select a catalog record.").refine((value) => value.mode !== "parents" || value.kind === "category", "Only categories have parents.");
export type TaxonomyMutation = z.infer<typeof taxonomyMutationSchema>;
export type TaxonomyQuery = z.infer<typeof taxonomyQuerySchema>;
