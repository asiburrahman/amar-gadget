export function isolatedTestDatabase(values: Record<string, string | undefined>) {
  if (!values.TEST_DATABASE_URL) return "postgresql://test@127.0.0.1:1/audit_unit_no_database";
  try {
    const url = new URL(values.TEST_DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/audit_") || url.search || url.hash) throw new Error();
    return url.toString();
  } catch { throw new Error("Jest requires an isolated local audit_* TEST_DATABASE_URL without query overrides."); }
}
