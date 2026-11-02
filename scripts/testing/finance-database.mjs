import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Immutable financial evidence is retained until the newly created isolated
// database is dropped. This never resets, deletes or migrates the input DB.
export async function createFinancialSmokeDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error("Use an isolated local audit_* database.");
  const name = `audit_refund_smoke_${randomBytes(8).toString("hex")}`, control = new Client({ connectionString: url.toString() });
  await control.connect(); let created = false, db;
  const close = async () => { try { await db?.$disconnect(); if (created && /^audit_refund_smoke_[a-f0-9]{16}$/.test(name)) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; url.pathname = `/${name}`;
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() }, stdio: ["ignore", "ignore", "ignore"] });
      child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error("Isolated smoke migration failed")));
    });
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 3 }) }); return { db, url: url.toString(), close };
  } catch (error) { await close(); throw error; }
}
