import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
/** Financial evidence is intentionally retained by SQL. Each finance suite
 * owns a fresh database, then drops only that newly created random fixture. */
export async function createFinanceDatabase() {
  const input = new URL(process.env.TEST_DATABASE_URL!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(input.hostname) || !input.pathname.startsWith("/audit_")) throw new Error("Use a local audit_* database.");
  const name = `audit_finance_${randomBytes(8).toString("hex")}`;
  if (!/^audit_finance_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture name");
  const control = new Client({ connectionString: input.toString() }); await control.connect(); let setup: Client | undefined, db: PrismaClient | undefined, created = false;
  const close = async () => {
    await db?.$disconnect(); await setup?.end(); setup = undefined;
    try { if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); }
  };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; input.pathname = `/${name}`;
    setup = new Client({ connectionString: input.toString() }); await setup.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort();
    for (const entry of names) await setup.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    await setup.end(); setup = undefined;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.toString(), max: 5 }), log: [] });
    return { db, url: input.toString(), close };
  } catch (error) { await close(); throw error; }
}
