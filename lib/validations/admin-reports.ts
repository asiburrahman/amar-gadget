import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const result = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === value && value >= "2000-01-01"; }, "Use a valid calendar date from 2000 onward.");
export const adminReportQuerySchema = z.object({
  from: date.optional(), to: date.optional(),
  status: z.enum(["ALL", "PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]).default("ALL"),
  paymentStatus: z.enum(["ALL", "UNPAID", "PAID", "FAILED"]).default("ALL"), paymentMethod: z.enum(["ALL", "COD", "STRIPE"]).default("ALL"),
  customerId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), format: z.enum(["json", "csv"]).default("json"),
}).strict().refine((value) => !!value.from === !!value.to, "Supply both range dates.").refine((value) => !value.from || !value.to || (value.from <= value.to && Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 365 * 86400_000), "Use an inclusive date range of at most 366 days.");
export function resolveReportPeriod(raw: unknown, now = new Date()) {
  const input = adminReportQuerySchema.parse(raw);
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value, today = `${get("year")}-${get("month")}-${get("day")}`;
  const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 29);
  return { ...input, from: input.from ?? start.toISOString().slice(0, 10), to: input.to ?? today };
}
