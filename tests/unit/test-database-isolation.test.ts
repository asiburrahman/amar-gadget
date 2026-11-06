import { isolatedTestDatabase } from "../helpers/isolated-database";

it("replaces ambient production URLs with the explicit guarded test database before application imports", () => {
  expect(process.env.DATABASE_URL).toBe(isolatedTestDatabase(process.env));
  expect(isolatedTestDatabase({ DATABASE_URL: "postgresql://private@production.invalid/store", TEST_DATABASE_URL: "postgresql://test@127.0.0.1:55439/audit_isolation" })).toBe("postgresql://test@127.0.0.1:55439/audit_isolation");
});
it("uses a closed loopback database for unit-only runs instead of ambient credentials", () => {
  const url = new URL(isolatedTestDatabase({ DATABASE_URL: "postgresql://private@production.invalid/store" }));
  expect(url.hostname).toBe("127.0.0.1"); expect(url.port).toBe("1"); expect(url.pathname).toMatch(/^\/audit_/);
});
it.each(["postgresql://private@production.invalid/audit_db", "postgresql://private@127.0.0.1/store", "postgresql://private@127.0.0.1/audit_db?host=production.invalid", "not-a-url"])("refuses unsafe test targets without echoing their contents: %s", (TEST_DATABASE_URL) => {
  try { isolatedTestDatabase({ TEST_DATABASE_URL }); throw new Error("Unsafe target accepted"); }
  catch (error) { expect(String(error)).toContain("isolated local audit_*"); expect(String(error)).not.toContain(TEST_DATABASE_URL); }
});
