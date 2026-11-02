import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { accountAdminMutationSchema, accountAdminQuerySchema } from "@/lib/validations/admin-accounts";
import { passwordHashStatus } from "@/lib/password";
export class AccountAdminError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
export async function withAccountAdministrator<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient) => Promise<T>, write = false, targetIds: string[] = []) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout='2000ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
    if (write) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.account-administration.v1',0))`;
    for (const id of [...new Set([actor.id, ...targetIds])].sort()) {
      if (write) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`; else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR SHARE`;
    }
    const saved = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isVerified: true, sessionVersion: true } });
    if (actor.role !== "ADMIN" || saved?.role !== "ADMIN" || !saved.isVerified || saved.sessionVersion !== actor.sessionVersion) throw new AccountAdminError("Administrator access changed. Sign in again.", "ADMIN_ACCOUNT_CHANGED", 403);
    await tx.$queryRaw`SELECT set_config('amar.account_admin_actor_id',${actor.id},true)`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 5000, isolationLevel: write ? "ReadCommitted" : "RepeatableRead" });
}
const select = { id: true, email: true, name: true, role: true, sellerStatus: true, isVerified: true, administrationVersion: true, createdAt: true, _count: { select: { products: true, orders: true, vendorFulfillments: true } } } satisfies Prisma.UserSelect;
type Account = Prisma.UserGetPayload<{ select: typeof select }>;
const dto = (row: Account) => ({ ...row, createdAt: row.createdAt.toISOString() });
type Result = { id: string; version: number; sessionChanged: boolean };
async function answer(tx: Prisma.TransactionClient, result: Result) {
  const row = await tx.user.findUnique({ where: { id: result.id }, select }); return { result, row: row ? dto(row) : null };
}
const signInCredential = (password: string | null) => ["current", "legacy"].includes(passwordHashStatus(password));
async function retainsAdministrator(tx: Prisma.TransactionClient, excludedId: string) {
  // Bound memory while checking the actual password parser, not merely the
  // presence of a legacy/imported string. The enclosing transaction bounds time.
  let after: string | undefined;
  for (;;) {
    const rows = await tx.user.findMany({ where: { role: "ADMIN", isVerified: true, id: { not: excludedId, ...(after ? { gt: after } : {}) }, password: { not: null } }, select: { id: true, password: true }, orderBy: { id: "asc" }, take: 100 });
    if (rows.some((row) => signInCredential(row.password))) return true;
    if (rows.length < 100) return false;
    after = rows[rows.length - 1].id;
  }
}
export async function mutateAccountAdministration(actor: AuthenticatedUser, raw: unknown) {
  const input = accountAdminMutationSchema.parse(raw), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return withAccountAdministrator(actor, async (tx) => {
    const prior = await tx.accountAdminRequest.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.ownerId !== actor.id || prior.hash !== hash) throw new AccountAdminError("This request identity belongs to different changes.", "ADMIN_REQUEST_CONFLICT");
      return answer(tx, prior.result as unknown as Result);
    }
    const current = await tx.user.findUnique({ where: { id: input.id } });
    if (!current) throw new AccountAdminError("This account no longer exists.", "ADMIN_TARGET_NOT_FOUND", 404);
    if (current.administrationVersion !== input.version) throw new AccountAdminError("This account changed. Reload its revision before making another decision.", "ADMIN_TARGET_CHANGED");
    let data: Prisma.UserUpdateInput = { sessionVersion: { increment: 1 } };
    if (input.action === "role") {
      if (current.role === input.role) throw new AccountAdminError("Choose a different account role.", "ADMIN_NO_CHANGE", 400);
      if (input.role === "ADMIN" && (!current.isVerified || !signInCredential(current.password))) throw new AccountAdminError("Administrator promotion requires an already verified account with supported sign-in credentials.", "ADMIN_PROMOTION_UNAVAILABLE", 400);
      if (current.role === "ADMIN" && input.role !== "ADMIN" && !await retainsAdministrator(tx, current.id)) throw new AccountAdminError("Retain at least one verified administrator with supported sign-in credentials before changing this role.", "ADMIN_LAST_ADMIN");
      data = { ...data, role: input.role, sellerStatus: input.role === "MEMBER" ? "PENDING" : input.role === "ADMIN" ? "APPROVED" : "BLOCKED" };
    } else if (input.action === "seller-status") {
      if (current.role !== "MEMBER") throw new AccountAdminError("Seller moderation applies only to member/seller accounts.", "ADMIN_NOT_SELLER", 400);
      if (current.sellerStatus === input.sellerStatus) throw new AccountAdminError("Choose a different seller status.", "ADMIN_NO_CHANGE", 400);
      if (input.sellerStatus === "APPROVED" && (!current.isVerified || !signInCredential(current.password))) throw new AccountAdminError("The seller must finish verification and have supported sign-in credentials before approval.", "ADMIN_SELLER_UNVERIFIED", 400);
      data.sellerStatus = input.sellerStatus;
    }
    await tx.$queryRaw`SELECT set_config('amar.account_admin_reason',${input.reason},true)`;
    const saved = await tx.user.update({ where: { id: current.id }, data, select: { id: true, administrationVersion: true } });
    const result: Result = { id: saved.id, version: saved.administrationVersion, sessionChanged: current.id === actor.id };
    await tx.accountAdminRequest.create({ data: { id: input.requestId, ownerId: actor.id, hash, result } });
    return answer(tx, result);
  }, true, [input.id]);
}
export async function readAccountAdministration(actor: AuthenticatedUser, raw: unknown) {
  const input = accountAdminQuerySchema.parse(raw), limit = 20;
  return withAccountAdministrator(actor, async (tx) => {
    const receipt = input.requestId ? await tx.accountAdminRequest.findFirst({ where: { id: input.requestId, ownerId: actor.id } }) : null;
    const attempt = receipt ? receipt.result as unknown as Result : null, attemptedRow = attempt ? (await answer(tx, attempt)).row : null;
    if (input.mode === "history") {
      const where = { userId: input.id! }, total = await tx.accountAdminEvent.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
      if (input.page > totalPages) throw new AccountAdminError("This history page does not exist.", "ADMIN_PAGE", 404);
      const events = await tx.accountAdminEvent.findMany({ where, orderBy: { sequence: "desc" }, take: limit, skip: (input.page - 1) * limit });
      return { ownerId: actor.id, scope: input.scope, rows: [], events: events.map((row) => ({ ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() })), page: input.page, total, totalPages, attempt, attemptedRow };
    }
    const pattern = input.q.replace(/[\\%_]/g, "\\$&");
    const where: Prisma.UserWhereInput = input.mode === "record" ? { id: input.id } : {
      ...(input.scope === "members" ? { role: "MEMBER" } : input.role !== "ALL" ? { role: input.role } : {}),
      ...(input.sellerStatus !== "ALL" ? { AND: [{ role: "MEMBER" }], sellerStatus: input.sellerStatus } : {}),
      ...(input.verified !== "ALL" ? { isVerified: input.verified === "YES" } : {}),
      ...(pattern ? { OR: [{ name: { contains: pattern, mode: "insensitive" } }, { email: { contains: pattern, mode: "insensitive" } }, { id: { equals: input.q } }] } : {}),
    };
    const total = await tx.user.count({ where }), totalPages = Math.max(1, Math.ceil(total / limit));
    if (input.page > totalPages) throw new AccountAdminError("This account page does not exist.", "ADMIN_PAGE", 404);
    if (input.mode === "record" && !total) throw new AccountAdminError("This account no longer exists.", "ADMIN_TARGET_NOT_FOUND", 404);
    const rows = await tx.user.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, skip: (input.page - 1) * limit });
    return { ownerId: actor.id, scope: input.scope, rows: rows.map(dto), events: [], page: input.page, total, totalPages, attempt, attemptedRow };
  });
}
export type AccountAdminView = Awaited<ReturnType<typeof readAccountAdministration>>;
export type AccountAdminRow = ReturnType<typeof dto>;
