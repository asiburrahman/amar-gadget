import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";
import { serviceUnavailable } from "@/lib/observability";
export class ReadAccessError extends Error {}
export class ReadPageError extends Error {}
export async function protectedRead<T>(actor: AuthenticatedUser, options: { roles: readonly string[]; approvedSeller?: boolean; operation: string }, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='1500ms'`; await tx.$executeRaw`SET LOCAL statement_timeout='4000ms'`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
      const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, sellerStatus: true, isVerified: true, sessionVersion: true } });
      if (!current?.isVerified || current.role !== actor.role || !options.roles.includes(current.role) || current.sessionVersion !== actor.sessionVersion || (options.approvedSeller && current.role === "MEMBER" && current.sellerStatus !== "APPROVED")) throw new ReadAccessError("Current account access changed. Sign in again.");
      return work(tx);
    }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
  } catch (error) { if (error instanceof ReadAccessError || error instanceof ReadPageError) throw error; throw serviceUnavailable(options.operation, error); }
}
export function readPagination(total: number, page: number, size = 20) {
  if (!Number.isSafeInteger(total) || total < 0) throw Error("Result count could not be confirmed");
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (page > totalPages) throw new ReadPageError("This result page does not exist. Load the first page to review the current results.");
  return { total, page, totalPages, pageSize: size };
}
