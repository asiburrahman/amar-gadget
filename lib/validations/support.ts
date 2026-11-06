import { z } from "zod";

export const SUPPORT_TOPICS = ["ORDER", "WARRANTY", "SELLER", "OTHER"] as const;
export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

// Keep messages as plain Unicode text. Reject NUL and nonprinting controls;
// preserve line breaks and tabs in the message rather than collapsing content.
const singleLine = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), "Use a single line without control characters.");
const message = z.string().trim().min(10).max(8000)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), "Remove nonprinting control characters.");

export const supportSubmissionSchema = z.object({
  requestId: z.string().uuid(),
  name: singleLine(2, 100),
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  topic: z.enum(SUPPORT_TOPICS),
  subject: singleLine(3, 160),
  orderReference: singleLine(1, 120).optional(),
  message,
  consent: z.literal(true),
}).strict();

export const supportQueueQuerySchema = z.object({
  status: z.enum(["ALL", ...SUPPORT_STATUSES]).default("OPEN"),
  topic: z.enum(["ALL", ...SUPPORT_TOPICS]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
}).strict();

export const supportStatusMutationSchema = z.object({
  requestId: z.string().uuid(),
  id: z.string().uuid(),
  version: z.number().int().min(1).max(2147483646),
  status: z.enum(SUPPORT_STATUSES),
  reason: singleLine(5, 500),
}).strict();

export type SupportSubmission = z.infer<typeof supportSubmissionSchema>;
export type SupportStatusMutation = z.infer<typeof supportStatusMutationSchema>;

const optionalPublicLine = (maximum: number) => singleLine(1, maximum).nullable();
export const supportContactFieldsSchema = z.object({
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()).nullable(),
  phone: z.string().trim().min(7).max(32).regex(/^\+?[0-9 ()-]+$/, "Use a telephone number without extension text or links.").refine((value) => { const digits = value.replace(/\D/g, ""); return digits.length >= 7 && digits.length <= 15; }).nullable(),
  address: optionalPublicLine(500),
  hours: optionalPublicLine(300),
  published: z.boolean(),
}).strict();
export const supportContactMutationSchema = z.object({
  requestId: z.string().uuid(),
  version: z.number().int().min(0).max(2147483646),
  fields: supportContactFieldsSchema,
  verified: z.boolean(),
  reason: singleLine(5, 500),
}).strict().refine((input) => !input.fields.published || (input.verified && [input.fields.email, input.fields.phone, input.fields.address, input.fields.hours].some(Boolean)), "Verify at least one public contact detail before publishing.");
export type SupportContactFields = z.infer<typeof supportContactFieldsSchema>;
export type SupportContactMutation = z.infer<typeof supportContactMutationSchema>;
