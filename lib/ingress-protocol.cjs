"use strict";
// Shared by the Next bundle and dependency-free native gateway/worker entry points.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");

const names = { ip: "x-amar-client-ip", timestamp: "x-amar-ingress-time", nonce: "x-amar-ingress-nonce", scope: "x-amar-ingress-scope", signature: "x-amar-ingress-signature" };

/** @param {unknown} value */
function canonicalIp(value) {
  if (typeof value !== "string" || value.length > 64 || value.includes("%") || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return normalized;
}
/** @param {string} value */
function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Invalid public application origin");
  return url.origin;
}
/** @param {string} value */
function canonicalTarget(value) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) throw new Error("Invalid request target");
  const url = new URL(value, "http://internal.invalid");
  return url.pathname + url.search;
}
/** @param {string} method @param {string} target */
function requestScope(method, target) {
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) throw new Error("Unsupported request method");
  return createHash("sha256").update(JSON.stringify([method, canonicalTarget(target)])).digest("hex");
}
/** @param {unknown} secret */
function validSecret(secret) { return typeof secret === "string" && secret.length <= 4096 && Buffer.byteLength(secret) >= 32; }
/** @param {string} secret @param {string} origin @param {string} ip @param {string} timestamp @param {string} nonce @param {string} scope */
function digest(secret, origin, ip, timestamp, nonce, scope) {
  return createHmac("sha256", secret).update(JSON.stringify(["amar-ingress-v1", canonicalOrigin(origin), ip, timestamp, nonce, scope])).digest("hex");
}
/** @param {{ secret: string, origin: string, ip: string, method: string, target: string, now?: number }} input */
function signIngress(input) {
  const ip = canonicalIp(input.ip);
  if (!validSecret(input.secret) || !ip) throw new Error("Invalid ingress signing configuration");
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));
  const nonce = randomBytes(16).toString("hex");
  const scope = requestScope(input.method, input.target);
  return { [names.ip]: ip, [names.timestamp]: timestamp, [names.nonce]: nonce, [names.scope]: scope, [names.signature]: digest(input.secret, input.origin, ip, timestamp, nonce, scope) };
}
/** @param {Headers | Record<string, string | string[] | undefined>} headers @param {string} name */
function header(headers, name) {
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
  return typeof value === "string" ? value : null;
}
/** Short-lived proxy assertion, never a user/session credential.
 * @param {{headers: Headers | Record<string, string | string[] | undefined>, secret: string, origin: string, method?: string, target?: string, now?: number}} input */
function verifyIngress(input) {
  try {
    if (!validSecret(input.secret)) return null;
    const ip = header(input.headers, names.ip), timestamp = header(input.headers, names.timestamp);
    const nonce = header(input.headers, names.nonce), scope = header(input.headers, names.scope), signature = header(input.headers, names.signature);
    if (!ip || canonicalIp(ip) !== ip || !timestamp || !/^\d{10,13}$/.test(timestamp) || String(Number(timestamp)) !== timestamp || !nonce || !/^[a-f0-9]{32}$/.test(nonce) || !scope || !/^[a-f0-9]{64}$/.test(scope) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const age = Math.floor((input.now ?? Date.now()) / 1000) - Number(timestamp);
    if (age < -5 || age > 120) return null;
    if (input.method !== undefined && input.target !== undefined && requestScope(input.method, input.target) !== scope) return null;
    const expected = digest(input.secret, input.origin, ip, timestamp, nonce, scope);
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")) ? ip : null;
  } catch { return null; }
}

exports.names = names;
exports.canonicalIp = canonicalIp;
exports.canonicalOrigin = canonicalOrigin;
exports.canonicalTarget = canonicalTarget;
exports.signIngress = signIngress;
exports.verifyIngress = verifyIngress;
exports.validSecret = validSecret;
