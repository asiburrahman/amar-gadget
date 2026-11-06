import { createServer, createConnection } from "node:net";
/** Test-owned loopback fault boundary. It never stops/reconfigures PostgreSQL
 * or changes the input database; only this proxy's own sockets are closed. */
export async function startDatabaseTcpFixture(databaseUrl) {
  const input = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(input.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(input.hostname) || !/^\/audit_[a-z0-9_]+$/.test(input.pathname) || input.search || input.hash) throw Error("Database fault fixture requires a local audit_* database");
  const sockets = new Set(); let available = true, stalled = false;
  const server = createServer((client) => {
    if (!available) { client.destroy(); return; }
    if (stalled) { sockets.add(client); client.on("error", () => client.destroy()); client.on("close", () => sockets.delete(client)); return; }
    const upstream = createConnection({ host: input.hostname.replace(/^\[|\]$/g, ""), port: Number(input.port || 5432) });
    sockets.add(client); sockets.add(upstream);
    const close = () => { sockets.delete(client); sockets.delete(upstream); client.destroy(); upstream.destroy(); };
    client.on("error", close); upstream.on("error", close); client.on("close", close); upstream.on("close", close);
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const proxied = new URL(input); proxied.hostname = "127.0.0.1"; proxied.port = String(server.address().port);
  return { url: proxied.toString(), setAvailable(value) { available = value; if (!value) for (const socket of [...sockets]) socket.destroy(); }, setStalled(value) { stalled = value; for (const socket of [...sockets]) socket.destroy(); }, async close() { for (const socket of [...sockets]) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}
