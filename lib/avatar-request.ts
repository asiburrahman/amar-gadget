import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getCurrentUser } from "@/lib/session";
import { AccountRequestError, limitAccountIdentity, limitAccountIp } from "@/lib/account-request";
import { AvatarError, decodeAvatarDataUrl } from "@/lib/avatar-image";
import { MAX_AVATAR_BYTES, MAX_AVATAR_DATA_URL_LENGTH, validateAvatarFile, type AvatarImageType } from "@/lib/avatar-policy";

export const avatarPrivateHeaders = { "Cache-Control": "private, no-store" };
export const avatarVersionSchema = z.number().int().min(0).max(2147483646);
const versionBody = z.object({ avatarVersion: avatarVersionSchema }).strict();
const uploadBody = z.union([
  z.object({ avatarVersion: avatarVersionSchema, avatar: z.string().max(MAX_AVATAR_DATA_URL_LENGTH) }).strict(),
  z.object({ avatarVersion: avatarVersionSchema, action: z.literal("restore-legacy") }).strict(),
]);
export async function avatarActor(request: Request, write = false) {
  const operation = write ? "avatar-write" : "avatar-read";
  await limitAccountIp(request, operation, write ? 20 : 120);
  const actor = await getCurrentUser();
  if (!actor) throw new AvatarError("Sign in to manage your photo.", "AVATAR_ACCOUNT_CHANGED", 401);
  if (request.headers.get("x-avatar-owner") !== actor.id) throw new AvatarError("The active account changed. Refresh your session.", "AVATAR_ACCOUNT_CHANGED", 409);
  await limitAccountIdentity(actor.id, operation, write ? 8 : 120, 60);
  return actor;
}
/** Bound the stream before multipart/JSON allocation. A stalled sender cannot
 * keep one of the process's limited decode/upload slots indefinitely. */
async function readBytes(request: Request, maximum: number, timeoutMs = 15_000) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new AvatarError("Photo request is too large or has an invalid length.", "AVATAR_SIZE", 413);
  if (!request.body) throw new AvatarError("Provide a photo request body.", "AVATAR_REQUEST");
  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, timeoutMs);
  // Fixed capacity also bounds metadata/Promise overhead for a sender using
  // millions of tiny chunks. Never retain one allocation/reaction per chunk.
  const buffer = Buffer.allocUnsafe(maximum); let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new AvatarError("Photo upload timed out. Try again.", "AVATAR_TIMEOUT", 408);
      if (done) break;
      if (value.byteLength > maximum - length) { void reader.cancel().catch(() => undefined); throw new AvatarError("Photo request is too large.", "AVATAR_SIZE", 413); }
      buffer.set(value, length); length += value.byteLength;
    }
    if (declared !== null && Number(declared) !== length) throw new AvatarError("Incomplete photo request.", "AVATAR_REQUEST");
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof AvatarError) throw error;
    throw new AvatarError("Incomplete photo request.", "AVATAR_REQUEST");
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
async function json(request: Request, maximum: number) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new AvatarError("Use JSON or a multipart photo upload.", "AVATAR_REQUEST", 415);
  const bytes = await readBytes(request, maximum);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AvatarError("Provide valid JSON photo fields.", "AVATAR_REQUEST"); }
}
export async function readAvatarRemoval(request: Request) {
  return versionBody.parse(await json(request, 1024)).avatarVersion;
}
export async function readAvatarUpload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    const bytes = await readBytes(request, MAX_AVATAR_BYTES + 16 * 1024);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new AvatarError("Provide a valid multipart photo request.", "AVATAR_REQUEST"); }
    if ([...form.keys()].some((key) => !["file", "avatarVersion"].includes(key) || form.getAll(key).length !== 1)) throw new AvatarError("Use each photo field once.", "AVATAR_REQUEST");
    const file = form.get("file"), version = form.get("avatarVersion");
    if (!file || typeof file === "string" || typeof version !== "string" || !/^(?:0|[1-9]\d*)$/.test(version)) throw new AvatarError("Provide a photo file and its current revision.", "AVATAR_REQUEST");
    const invalid = validateAvatarFile(file);
    if (invalid) throw new AvatarError(invalid, "AVATAR_IMAGE", file.size > MAX_AVATAR_BYTES ? 413 : 400);
    return { avatarVersion: avatarVersionSchema.parse(Number(version)), source: { bytes: Buffer.from(await file.arrayBuffer()), type: file.type as AvatarImageType } };
  }
  const body = uploadBody.parse(await json(request, MAX_AVATAR_DATA_URL_LENGTH + 1024));
  return { avatarVersion: body.avatarVersion, source: "avatar" in body ? decodeAvatarDataUrl(body.avatar) : null };
}
export function avatarFailure(error: unknown) {
  if (error instanceof AvatarError || error instanceof AccountRequestError) return NextResponse.json({ success: false, message: error.message, code: error instanceof AvatarError ? error.code : "AVATAR_REQUEST" }, { status: error.status, headers: { ...avatarPrivateHeaders, ...(error instanceof AccountRequestError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Check the photo fields and current revision.", code: "AVATAR_REQUEST" }, { status: 400, headers: avatarPrivateHeaders });
  console.error("Avatar request unavailable; private details were not logged.");
  return NextResponse.json({ success: false, message: "Unable to confirm the photo change. Reload the saved photo before retrying.", code: "AVATAR_UNAVAILABLE" }, { status: 503, headers: avatarPrivateHeaders });
}
