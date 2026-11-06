import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Immutable financial evidence is retained until the newly created isolated
// database is dropped. This never resets, deletes or migrates the input DB.
export async function createFinancialSmokeDatabase({ beforeMigration } = {}) {
  const url = new URL(process.env.TEST_DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error("Use an isolated local audit_* database.");
  const name = `audit_refund_smoke_${randomBytes(8).toString("hex")}`, control = new Client({ connectionString: url.toString() });
  const migrationRoot = resolve("prisma/migrations");
  const migrations = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (beforeMigration !== undefined && !migrations.includes(beforeMigration)) throw Error("Unknown isolated migration boundary.");
  await control.connect(); let created = false, db, stage;
  const close = async () => {
    try {
      await db?.$disconnect();
      if (created && /^audit_refund_smoke_[a-f0-9]{16}$/.test(name)) { await control.query(`DROP DATABASE "${name}"`); created = false; }
    } finally {
      try {
        if (stage) {
          // Only remove the absolute mkdtemp root this invocation created.
          const target = resolve(stage), parent = resolve(tmpdir());
          if (dirname(target) !== parent || !/^amar-audit-migrations-[A-Za-z0-9]+$/.test(basename(target))) throw Error("Unexpected isolated migration staging path.");
          await rm(target, { recursive: true, force: true }); stage = undefined;
        }
      } finally { await control.end(); }
    }
  };
  const cli = (args) => new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve("node_modules/prisma/build/index.js"), ...args], { env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() }, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", () => reject(Error("Isolated migration process could not start.")));
    child.once("exit", (code) => code === 0 ? done() : reject(Error("Isolated migration command failed.")));
  });
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; url.pathname = `/${name}`;
    let config = resolve("prisma.config.ts");
    if (beforeMigration !== undefined) {
      stage = await mkdtemp(join(tmpdir(), "amar-audit-migrations-"));
      const stagedMigrations = join(stage, "migrations"); await mkdir(stagedMigrations);
      for (const migration of migrations.filter((entry) => entry < beforeMigration)) {
        if (!/^\d{14}_[a-z0-9_]+$/.test(migration)) throw Error("Unexpected isolated migration name.");
        await mkdir(join(stagedMigrations, migration));
        await copyFile(join(migrationRoot, migration, "migration.sql"), join(stagedMigrations, migration, "migration.sql"));
      }
      await copyFile(join(migrationRoot, "migration_lock.toml"), join(stagedMigrations, "migration_lock.toml"));
      config = join(stage, "prisma.config.ts");
      await writeFile(config, `export default { schema: ${JSON.stringify(resolve("prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(stagedMigrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`);
    }
    await cli(["migrate", "deploy", "--config", config]);
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 3 }) });
    return { db, url: url.toString(), close,
      deploy: () => cli(["migrate", "deploy", "--config", resolve("prisma.config.ts")]),
      resolveRolledBack: (migration) => {
        if (!migrations.includes(migration)) throw Error("Unknown isolated rollback marker.");
        return cli(["migrate", "resolve", "--rolled-back", migration, "--config", resolve("prisma.config.ts")]);
      },
    };
  } catch (error) { await close(); throw error; }
}
