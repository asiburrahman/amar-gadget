import { createIngressGateway } from "../lib/ingress-gateway.mjs";

try {
  const port = Number(process.env.GATEWAY_PORT || "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid gateway port");
  const server = createIngressGateway({ secret: process.env.TRUSTED_PROXY_SECRET, appOrigin: process.env.APP_URL, originUrl: process.env.GATEWAY_ORIGIN_URL || "http://127.0.0.1:3000", clientIpMode: process.env.GATEWAY_CLIENT_IP_MODE });
  server.on("error", () => { console.error("Ingress gateway could not listen."); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ event: "ingress_gateway_ready", port })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); setTimeout(() => { server.closeAllConnections(); }, 5000).unref(); });
} catch {
  console.error("Ingress gateway configuration is invalid. Set APP_URL, TRUSTED_PROXY_SECRET and GATEWAY_CLIENT_IP_MODE.");
  process.exitCode = 1;
}
