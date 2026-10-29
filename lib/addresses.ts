import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AccountRequestError } from "@/lib/account-request";
import { MAX_SAVED_ADDRESSES, type ShippingAddress } from "@/lib/validations/address";
export const addressSelect = { id: true, version: true, fullName: true, phone: true, street: true, city: true, district: true, zipCode: true, isDefault: true } satisfies Prisma.AddressSelect;
export async function withAddressOwner<T>(actor: AuthenticatedUser, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { sessionVersion: true, isVerified: true, role: true } });
    if (!current?.isVerified || current.sessionVersion !== actor.sessionVersion || current.role !== actor.role) throw new AccountRequestError("Your account changed. Sign in again.", 409);
    return work(tx);
  }, { timeout: 10_000, maxWait: 5000 });
}
export async function listAddresses(actor: AuthenticatedUser, page: number) {
  return withAddressOwner(actor, async (tx) => {
    const where = { userId: actor.id }, limit = 10;
    const total = await tx.address.count({ where });
    const addresses = page > Math.max(1, Math.ceil(total / limit)) ? [] : await tx.address.findMany({ where, select: addressSelect, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit });
    const defaultAddress = await tx.address.findFirst({ where: { ...where, isDefault: true }, select: addressSelect });
    return { addresses, defaultAddress, page, total, totalPages: Math.ceil(total / limit) };
  });
}
async function makeDefault(tx: Prisma.TransactionClient, userId: string, id: string) {
  await tx.address.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false, version: { increment: 1 } } });
  return tx.address.update({ where: { id }, data: { isDefault: true, version: { increment: 1 } }, select: addressSelect });
}
export async function createAddress(actor: AuthenticatedUser, fields: ShippingAddress, makeDefaultRequested: boolean) {
  return withAddressOwner(actor, async (tx) => {
    const count = await tx.address.count({ where: { userId: actor.id } });
    if (count >= MAX_SAVED_ADDRESSES) throw new AccountRequestError("You can save up to 20 addresses. Edit or remove an existing one first.", 409);
    const shouldDefault = count === 0 || makeDefaultRequested;
    if (shouldDefault) await tx.address.updateMany({ where: { userId: actor.id, isDefault: true }, data: { isDefault: false, version: { increment: 1 } } });
    return tx.address.create({ data: { ...fields, zipCode: fields.zipCode || null, userId: actor.id, isDefault: shouldDefault }, select: addressSelect });
  });
}
export async function mutateAddress(actor: AuthenticatedUser, revision: { id: string; version: number }, operation: "update" | "default" | "delete", fields?: ShippingAddress) {
  return withAddressOwner(actor, async (tx) => {
    const address = await tx.address.findFirst({ where: { id: revision.id, userId: actor.id }, select: addressSelect });
    if (!address) throw new AccountRequestError("Address not found.", 404);
    if (address.version !== revision.version) throw new AccountRequestError("This address changed. Reload saved addresses, then reopen it to review the latest version.", 409);
    if (operation === "update") {
      if (!fields) throw new AccountRequestError("Address fields are required.", 400);
      return tx.address.update({ where: { id: address.id }, data: { ...fields, zipCode: fields.zipCode || null, version: { increment: 1 } }, select: addressSelect });
    }
    if (operation === "default") return address.isDefault ? address : makeDefault(tx, actor.id, address.id);
    await tx.address.delete({ where: { id: address.id } });
    if (address.isDefault) {
      const next = await tx.address.findFirst({ where: { userId: actor.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
      if (next) await makeDefault(tx, actor.id, next.id);
    }
    return null;
  });
}
