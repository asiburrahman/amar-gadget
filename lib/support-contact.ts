import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { supportAdministrator } from "@/lib/support";
import { SupportError } from "@/lib/support-policy";
import { supportContactFieldsSchema, supportContactMutationSchema } from "@/lib/validations/support";

export async function readPublicSupportContact() {
  // No cache: the server page opts into request-time rendering. Never return
  // draft fields/history/actor IDs to a public component or client payload.
  const saved = await prisma.supportContactSettings.findUnique({ where: { id: "PUBLIC" }, select: { email: true, phone: true, address: true, hours: true, published: true } });
  if (!saved?.published) return null;
  return supportContactFieldsSchema.parse(saved);
}

export async function readSupportContactSettings(actor: AuthenticatedUser, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new SupportError("Invalid settings history page.", 400, "SUPPORT_REQUEST");
  return supportAdministrator(actor, async (tx) => {
    const settings = await tx.supportContactSettings.findUnique({ where: { id: "PUBLIC" } });
    const total = await tx.supportContactEvent.count(), totalPages = Math.max(1, Math.ceil(total / 20));
    if (page > totalPages) throw new SupportError("This settings history page does not exist.", 404, "SUPPORT_NOT_FOUND");
    const rows = await tx.supportContactEvent.findMany({ take: 20, skip: (page - 1) * 20, orderBy: { version: "desc" } });
    return { ownerId: actor.id, settings: settings ? { ...settings, updatedAt: settings.updatedAt.toISOString() } : null, history: { page, total, totalPages, rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) } };
  });
}

export async function saveSupportContactSettings(actor: AuthenticatedUser, raw: unknown) {
  const input = supportContactMutationSchema.parse(raw), fields = input.fields;
  const hash = createHash("sha256").update(JSON.stringify(["support-contact-v1", input.version, fields.email, fields.phone, fields.address, fields.hours, fields.published, input.verified, input.reason])).digest("hex");
  return supportAdministrator(actor, async (tx) => {
    // Share the receipt-identity lock with status operations, then serialize the
    // singleton (including its absent initial state) for competing editors.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`support:decision:${input.requestId}`},0))`;
    const receipt = await tx.supportRequest.findUnique({ where: { id: input.requestId } });
    if (receipt) {
      if (receipt.ownerId !== actor.id || receipt.contentHash !== hash) throw new SupportError("This operation reference was already used for another decision.");
      return { ownerId: actor.id, result: receipt.result };
    }
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('support:contact:PUBLIC',0))`;
    const current = await tx.supportContactSettings.findUnique({ where: { id: "PUBLIC" } });
    if ((current?.version ?? 0) !== input.version) throw new SupportError("Public contact settings changed. Load the latest version before editing again.");
    const before = current ? { id: current.id, email: current.email, phone: current.phone, address: current.address, hours: current.hours, published: current.published, version: current.version } : null;
    const after = { id: "PUBLIC", ...fields, version: input.version + 1 };
    if (before && JSON.stringify({ ...before, version: 0 }) === JSON.stringify({ ...after, version: 0 })) throw new SupportError("These contact details are already saved. Change a field before saving.");
    await tx.supportContactEvent.create({ data: { version: after.version, actorId: actor.id, before: before ?? Prisma.DbNull, after, verified: input.verified, reason: input.reason } });
    const saved = current ? await tx.supportContactSettings.update({ where: { id: "PUBLIC" }, data: after }) : await tx.supportContactSettings.create({ data: after });
    const result = { ...saved, updatedAt: saved.updatedAt.toISOString() };
    await tx.supportRequest.create({ data: { id: input.requestId, ownerId: actor.id, contentHash: hash, result } });
    return { ownerId: actor.id, result };
  }, true);
}
export type SupportContactView = Awaited<ReturnType<typeof readSupportContactSettings>>;
