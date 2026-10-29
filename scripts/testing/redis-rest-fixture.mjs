import { createServer } from "node:http";

/** Test-only Upstash REST boundary for the guarded standalone smoke runner.
 * The production application never imports this module. */
export async function startRedisRestFixture(token) {
  const keys = new Map();
  let available = true;
  const execute = (command) => {
    const [name, key, ...args] = command;
    if (String(name).toUpperCase() === "PING") return "PONG";
    if (keys.get(key)?.expires <= Date.now()) keys.delete(key);
    if (!keys.has(key)) keys.set(key, { members: new Map(), expires: Infinity });
    const item = keys.get(key);
    switch (String(name).toUpperCase()) {
      case "ZREMRANGEBYSCORE": {
        let removed = 0;
        for (const [member, score] of item.members) if (score >= Number(args[0]) && score <= Number(args[1])) { item.members.delete(member); removed++; }
        return removed;
      }
      case "ZADD": { const existed = item.members.has(args[1]); item.members.set(args[1], Number(args[0])); return existed ? 0 : 1; }
      case "ZCARD": return item.members.size;
      case "EXPIRE": item.expires = Date.now() + Number(args[0]) * 1000; return 1;
      default: throw new Error("Unsupported test fixture command");
    }
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(JSON.stringify({ error: "Unauthorized fixture request" })); return; }
    if (!available) { response.writeHead(503).end(JSON.stringify({ error: "Fixture unavailable" })); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error("Fixture body too large"); chunks.push(chunk); }
      const commands = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const pipeline = Array.isArray(commands[0]);
      const encode = (value) => typeof value === "string" && value !== "OK" && request.headers["upstash-encoding"] === "base64" ? Buffer.from(value).toString("base64") : value;
      const result = pipeline ? commands.map((command) => ({ result: encode(execute(command)) })) : { result: encode(execute(commands)) };
      response.end(JSON.stringify(result));
    } catch { response.writeHead(400).end(JSON.stringify({ error: "Invalid fixture request" })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`, token,
    setAvailable(value) { available = value; },
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}
