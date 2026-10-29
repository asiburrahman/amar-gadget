import { createServer, type IncomingMessage } from "node:http";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

const accessKeyId = "LOCAL_MEDIA_FIXTURE_ACCESS";
const secretAccessKey = "private-local-media-fixture-".repeat(2);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (item) => `%${item.charCodeAt(0).toString(16).toUpperCase()}`);

// A real SigV4-verifying HTTP boundary, not an S3 SDK mock. No application
// code imports this fixture and its credentials have no external authority.
function signed(req: IncomingMessage, url: URL) {
  const authorization = req.headers.authorization ?? "";
  const credential = url.searchParams.get("X-Amz-Credential") ?? authorization.match(/Credential=([^, ]+)/)?.[1];
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") ?? authorization.match(/SignedHeaders=([^, ]+)/)?.[1];
  const signature = url.searchParams.get("X-Amz-Signature") ?? authorization.match(/Signature=([^, ]+)/)?.[1];
  const timestamp = url.searchParams.get("X-Amz-Date") ?? req.headers["x-amz-date"] as string;
  if (!credential || !signedHeaders || !signature || !timestamp) return false;
  const [access, date, region, service, end] = credential.split("/");
  if (access !== accessKeyId || region !== "auto" || service !== "s3" || end !== "aws4_request") return false;
  const headers = signedHeaders.split(";").map((name) => `${name}:${String(req.headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...url.searchParams].filter(([key]) => key !== "X-Amz-Signature").map(([key, value]) => [encode(key), encode(value)]).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("&");
  const payload = String(url.searchParams.get("X-Amz-Content-Sha256") ?? req.headers["x-amz-content-sha256"] ?? hash(""));
  const canonical = [req.method, url.pathname, query, headers, signedHeaders, payload].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
  return createHmac("sha256", key).update(["AWS4-HMAC-SHA256", timestamp, scope, hash(canonical)].join("\n")).digest("hex") === signature;
}

export async function startS3MediaFixture() {
  const objects = new Map<string, { body: Buffer; type: string; etag: string; modified: Date }>();
  let available = true;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture.invalid");
    const reject = (status: number, code: string) => { res.writeHead(status, { "Content-Type": "application/xml" }); res.end(`<Error><Code>${code}</Code></Error>`); };
    if (!available) { reject(503, "ServiceUnavailable"); return; }
    // Test-only CDN contract over loopback with an exact Host. Public DNS,
    // TLS and the operator's Cloudflare bucket are separate release checks.
    if (req.headers.host === "cdn.media.example.invalid") {
      if (!["GET", "HEAD"].includes(req.method ?? "") || url.search || !/^\/products\/[A-Za-z0-9-]+\/[a-f0-9-]+\.(png|jpg|webp)$/.test(url.pathname)) { reject(403, "InvalidPublicRequest"); return; }
      const object = objects.get(`/fixture-media${url.pathname}`);
      if (!object) { reject(404, "NoSuchKey"); return; }
      res.writeHead(200, { "Content-Type": object.type, "Content-Length": object.body.length, "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(req.method === "HEAD" ? undefined : object.body); return;
    }
    if (!signed(req, url)) { reject(403, "SignatureDoesNotMatch"); return; }
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const contents = [...objects].filter(([key]) => key.startsWith("/fixture-media/products/")).map(([key]) => `<Contents><Key>${key.slice("/fixture-media/".length)}</Key></Contents>`).join("");
      res.writeHead(200, { "Content-Type": "application/xml" }); res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`); return;
    }
    if (req.method === "DELETE") { objects.delete(url.pathname); res.writeHead(204); res.end(); return; }
    if (req.method === "PUT") {
      if (req.headers["if-none-match"] !== "*") { reject(400, "MissingWriteCondition"); return; }
      if (objects.has(url.pathname)) { reject(412, "PreconditionFailed"); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 5 * 1024 * 1024) { reject(413, "EntityTooLarge"); req.destroy(); return; } chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const etag = `"${hash(body)}"`;
      objects.set(url.pathname, { body, type: String(req.headers["content-type"]), etag, modified: new Date() });
      res.writeHead(200, { ETag: etag }); res.end(); return;
    }
    const object = objects.get(url.pathname);
    if (!object) { reject(404, "NoSuchKey"); return; }
    if (req.headers["if-match"] && req.headers["if-match"] !== object.etag) { reject(412, "PreconditionFailed"); return; }
    const range = req.headers.range === "bytes=0-31";
    const body = range ? object.body.subarray(0, 32) : object.body;
    res.writeHead(range ? 206 : 200, { "Content-Type": object.type, "Content-Length": req.method === "HEAD" ? object.body.length : body.length, "Last-Modified": object.modified.toUTCString(), ETag: object.etag, ...(range ? { "Content-Range": `bytes 0-${body.length - 1}/${object.body.length}` } : {}) });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture listener failed");
  return { endpoint: `http://127.0.0.1:${address.port}`, credentials: { accessKeyId, secretAccessKey }, objects, setAvailable: (value: boolean) => { available = value; }, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

export function validLargePng() {
  const crc32 = (bytes: Buffer) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1024); header.writeUInt32BE(1024, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(1024 * (3072 + 1));
  for (let row = 0; row < 1024; row++) randomBytes(3072).copy(rows, row * 3073 + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
