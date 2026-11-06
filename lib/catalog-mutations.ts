import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/session";

export class CatalogMutationError extends Error {}
export async function withCurrentAdmin<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient) => Promise<T>, ownerIds: string[] = []) {
  return prisma.$transaction(async (tx) => {
    for (const id of [...new Set([actor.id, ...ownerIds])].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, sessionVersion: true, isVerified: true } });
    if (!current?.isVerified || current.role.toUpperCase() !== "ADMIN" || current.sessionVersion !== actor.sessionVersion) throw new CatalogMutationError("Administrator access changed. Sign in again.");
    await tx.$queryRaw`SELECT set_config('amar.product_maintenance_actor_id',${actor.id},true),set_config('amar.product_maintenance_reason','Administrator catalog action',true)`;
    return work(tx);
  }, { timeout: 10_000, maxWait: 5000 });
}
