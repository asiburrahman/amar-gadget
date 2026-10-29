jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({ get: () => ({ value: "local-profile-token" }) }) }));
jest.mock("@/lib/session-validation", () => ({ validateSessionToken: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1", rateLimit: jest.fn().mockResolvedValue({ success: true }) }));

import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { validateSessionToken } from "@/lib/session-validation";

const databaseSuite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite("atomic profile and single-default address", () => {
  let db: PrismaClient;
  let save: typeof import("@/app/api/user/profile/route").PUT;
  let read: typeof import("@/app/api/user/profile/route").GET;
  const ids: string[] = [];
  const prefix = `audit-profile-${randomUUID()}`;
  const address = (label = "Home") => ({ fullName: label, phone: "01700000000", street: `${label} street`, city: "Dhaka", district: "Dhaka", zipCode: "1200" });
  const request = (data: unknown) => new Request("http://localhost/profile-test", { method: "PUT", body: JSON.stringify(data) });
  const createUser = async () => {
    const user = await db.user.create({ data: { email: `${prefix}-${randomUUID()}@example.invalid`, name: "Original owner", isVerified: true } });
    ids.push(user.id); return user;
  };
  const authenticate = (user: User) => (validateSessionToken as jest.Mock).mockResolvedValue(user);
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_")) throw new Error("Profile tests require a disposable local audit_* database.");
    process.env.DATABASE_URL = url.toString();
    db = (await import("@/lib/prisma")).prisma;
    ({ PUT: save, GET: read } = await import("@/app/api/user/profile/route"));
  });
  afterAll(async () => {
    if (!db) return;
    try { await db.address.deleteMany({ where: { userId: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: ids } } }); }
    finally { await db.$disconnect(); }
  });

  it("commits normalized profile and address together and returns the actual default", async () => {
    const user = await createUser(); authenticate(user);
    const result = await save(request({ name: "  Updated owner  ", phone: "01700000000", address: address("  Home  ") }));
    expect(result.status).toBe(200);
    const data = await result.json(); expect(data.user.name).toBe("Updated owner");
    expect(data.user.addresses).toHaveLength(1); expect(data.user.addresses[0].fullName).toBe("Home");
    expect(data.user.addresses[0].isDefault).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(user.sessionVersion);
    const id = data.user.addresses[0].id;
    expect((await save(request({ address: address("Office") }))).status).toBe(200);
    expect(await db.address.count({ where: { userId: user.id } })).toBe(1);
    expect((await db.address.findUniqueOrThrow({ where: { id } })).fullName).toBe("Office");
  });

  it("serializes simultaneous first saves without duplicate defaults or mixed profile/address snapshots", async () => {
    const user = await createUser(); authenticate(user);
    const labels = ["Alpha", "Bravo", "Charlie", "Delta"];
    const results = await Promise.all(labels.map((label) => save(request({ name: label, address: address(label) }))));
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    const account = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const saved = await db.address.findMany({ where: { userId: user.id } });
    expect(saved).toHaveLength(1); expect(saved[0].isDefault).toBe(true);
    expect(saved[0].fullName).toBe(account.name); expect(saved[0].street).toBe(`${account.name} street`);
  });

  it("rolls back a real SQL address failure together with an already-executed profile write", async () => {
    const user = await createUser(); authenticate(user);
    const suffix = randomUUID().replaceAll("-", "");
    const constraint = `audit_profile_${suffix}`;
    const rejectedStreet = `audit-reject-${suffix}`;
    // Test-only DDL against the guarded disposable database. Names/literals
    // contain only generated hexadecimal characters, never request input.
    await db.$executeRawUnsafe(`ALTER TABLE "Address" ADD CONSTRAINT "${constraint}" CHECK ("street" <> '${rejectedStreet}')`);
    try {
      const result = await save(request({ name: "Must roll back", address: { ...address(), street: rejectedStreet } }));
      expect(result.status).toBe(503);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(user.name);
      expect(await db.address.count({ where: { userId: user.id } })).toBe(0);
    } finally { await db.$executeRawUnsafe(`ALTER TABLE "Address" DROP CONSTRAINT "${constraint}"`); }
  });

  it("enforces one default through SQL even when writers bypass application locks", async () => {
    const user = await createUser();
    const results = await Promise.allSettled(["First", "Second"].map((label) => db.address.create({ data: { ...address(label), userId: user.id, isDefault: true } })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.address.count({ where: { userId: user.id, isDefault: true } })).toBe(1);
    await db.address.create({ data: { ...address("Additional"), userId: user.id, isDefault: false } });
    expect(await db.address.count({ where: { userId: user.id } })).toBe(2);
  });

  it("does not mutate another account's address or accept a client-selected owner/id", async () => {
    const owner = await createUser(); const foreign = await createUser();
    const foreignAddress = await db.address.create({ data: { ...address("Foreign"), userId: foreign.id, isDefault: true } });
    authenticate(owner);
    expect((await save(request({ address: { ...address(), id: foreignAddress.id, userId: foreign.id } }))).status).toBe(400);
    expect((await save(request({ address: address("Own home") }))).status).toBe(200);
    expect((await db.address.findUniqueOrThrow({ where: { id: foreignAddress.id } })).fullName).toBe("Foreign");
    expect(await db.address.count({ where: { userId: owner.id, isDefault: true } })).toBe(1);
  });

  it("rechecks session authority under the user lock and leaves rejected changes untouched", async () => {
    const user = await createUser(); authenticate(user);
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await save(request({ name: "Stale mutation", address: address() }))).status).toBe(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(user.name);
    expect(await db.address.count({ where: { userId: user.id } })).toBe(0);
  });

  it("does not present a nondefault address as the current default", async () => {
    const user = await createUser(); authenticate(user);
    await db.address.create({ data: { ...address("Saved only"), userId: user.id, isDefault: false } });
    expect((await (await read()).json()).user.addresses).toEqual([]);
    expect(await db.address.count({ where: { userId: user.id } })).toBe(1);
  });
});
