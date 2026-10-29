import { z } from "zod";

export const MAX_SPECIFICATIONS = 30;
export const specificationKey = (label: string) => label.trim().toLowerCase();
const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use plain text without control characters.");
export const specificationsSchema = z.array(z.object({ label: text(60), value: text(300) }).strict()).max(MAX_SPECIFICATIONS)
  .refine((items) => new Set(items.map((item) => specificationKey(item.label))).size === items.length, "Specification labels must be distinct (case-insensitive).");
export type Specification = z.infer<typeof specificationsSchema>[number];
