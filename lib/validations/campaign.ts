import { z } from "zod";
import { catalogIdSchema } from "./product";
const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text.");
export const campaignFieldsSchema = z.object({
  title: text(120), slug: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(1000), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
  isActive: z.boolean(), productIds: z.array(catalogIdSchema).max(50).refine((ids) => new Set(ids).size === ids.length, "Choose distinct products."),
}).strict().refine((data) => Date.parse(data.endsAt) > Date.parse(data.startsAt), { path: ["endsAt"], message: "End must be after start." })
  .refine((data) => !data.isActive || data.productIds.length > 0, { path: ["productIds"], message: "An enabled campaign needs at least one product." });
export const campaignSaveSchema = z.object({ id: catalogIdSchema.optional(), version: z.number().int().min(1).max(2_147_483_646).optional(), fields: campaignFieldsSchema }).strict()
  .refine((input) => Boolean(input.id) === Boolean(input.version), "Existing campaigns require their version.");
export const campaignDeleteSchema = z.object({ id: catalogIdSchema, version: z.number().int().positive().max(2_147_483_647) }).strict();
export const campaignPageSchema = z.preprocess((value) => value === undefined ? 1 : typeof value === "string" && /^\d{1,7}$/.test(value) ? Number(value) : value, z.number().int().min(1).max(1_000_000));
export type CampaignFields = z.infer<typeof campaignFieldsSchema>;
