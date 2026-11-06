import { z } from "zod";

export const SITE_PAGE_SLUGS = ["about", "faq", "returns", "privacy-policy", "terms"] as const;
export const SITE_CONTENT_KINDS = ["PAGE", "ARTICLE"] as const;
export const SITE_CONTENT_ACTIONS = ["DRAFT", "PUBLISH", "UNPUBLISH"] as const;
function wellFormedText(value: string) {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}
function utf8Size(value: string) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
const singleLine = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine(wellFormedText, "Use valid Unicode text.")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), "Use a single line without control characters.");
const paragraph = z.string().trim().max(8000)
  .refine(wellFormedText, "Use valid Unicode text.")
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), "Remove nonprinting control characters.");
const addressFields = {
  kind: z.enum(SITE_CONTENT_KINDS),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens in the URL slug."),
};
function checkAddress(value: { kind: string; slug: string }, context: z.RefinementCtx) {
  if (value.kind === "PAGE" && !SITE_PAGE_SLUGS.some((slug) => slug === value.slug)) {
    context.addIssue({ code: "custom", path: ["slug"], message: "Choose a supported information page." });
  }
}
export const siteContentAddressSchema = z.object(addressFields).strict().superRefine(checkAddress);

// Structured plain text, not executable HTML/Markdown. Empty private drafts
// are allowed; publication applies the stronger checks below. The serialized
// byte bound leaves room for the mutation envelope within the 128 KiB body cap.
export const siteContentFieldsSchema = z.object({
  title: singleLine(0, 160),
  summary: singleLine(0, 500),
  byline: singleLine(0, 100),
  sections: z.array(z.object({ heading: singleLine(0, 160), body: paragraph }).strict()).max(24),
}).strict().refine((fields) => utf8Size(JSON.stringify(fields)) <= 96_000, "Keep the complete document within 96,000 UTF-8 bytes.");

export const publishableSiteContentSchema = siteContentFieldsSchema.superRefine((fields, context) => {
  if (fields.title.length < 3) context.addIssue({ code: "custom", path: ["title"], message: "A published title needs at least three characters." });
  if (fields.summary.length < 10) context.addIssue({ code: "custom", path: ["summary"], message: "Write a useful published summary." });
  if (!fields.sections.length) context.addIssue({ code: "custom", path: ["sections"], message: "Add at least one complete section before publishing." });
  fields.sections.forEach((section, index) => {
    if (section.heading.length < 2) context.addIssue({ code: "custom", path: ["sections", index, "heading"], message: "Complete this heading before publishing." });
    if (section.body.length < 10) context.addIssue({ code: "custom", path: ["sections", index, "body"], message: "Complete this section before publishing." });
  });
});

const decisionFields = {
  ...addressFields,
  requestId: z.string().uuid(),
  version: z.number().int().min(0).max(2_147_483_646),
  reason: singleLine(5, 500),
};
export const siteContentMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...decisionFields, action: z.literal("DRAFT"), fields: siteContentFieldsSchema }).strict(),
  // Publication uses the saved, reviewed draft at this exact version. It
  // cannot silently substitute unsaved form content or a newer server draft.
  z.object({ ...decisionFields, action: z.literal("PUBLISH"), reviewed: z.literal(true) }).strict(),
  z.object({ ...decisionFields, action: z.literal("UNPUBLISH") }).strict(),
]).superRefine(checkAddress);

export const siteContentStateSchema = z.object({
  ...addressFields,
  version: z.number().int().min(1).max(2_147_483_647),
  draft: siteContentFieldsSchema,
  publishedVersion: z.number().int().min(1).max(2_147_483_647).nullable(),
}).strict().superRefine((state, context) => {
  checkAddress(state, context);
  if (state.publishedVersion !== null && state.publishedVersion > state.version) {
    context.addIssue({ code: "custom", path: ["publishedVersion"], message: "Publication cannot reference a future revision." });
  }
});

export type SiteContentAddress = z.infer<typeof siteContentAddressSchema>;
export type SiteContentFields = z.infer<typeof siteContentFieldsSchema>;
export type SiteContentMutation = z.infer<typeof siteContentMutationSchema>;
export type SiteContentState = z.infer<typeof siteContentStateSchema>;
