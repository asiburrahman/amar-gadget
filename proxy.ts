import { NextResponse, type NextRequest } from "next/server";
import { verifyJwtToken } from "@/lib/session-token";
import { verifiedIngressIp, isAllowedRequestOrigin } from "@/lib/ingress";
import { isPublicAsset } from "@/lib/public-assets";
import { readApplicationOrigin } from "@/config/runtime";

/** Optimistic navigation only. Layouts, APIs and actions validate the current
 * database version through lib/session-validation before protected access. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const readOnly = ["GET", "HEAD"].includes(request.method) && !request.headers.has("next-action");
  const publicResource = readOnly && (path === "/api/health" || path === "/api/health/ready" || path.startsWith("/_next/static/") || path === "/_next/image" || isPublicAsset(path));
  let responseHeaders: Headers | undefined;
  if (process.env.NODE_ENV === "production" && !publicResource) {
    const ip = verifiedIngressIp(request.headers, request.method, path + request.nextUrl.search);
    if (!ip || !isAllowedRequestOrigin(request.headers, request.method, path)) return NextResponse.json({ error: "Request ingress is not permitted." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const origin = new URL(readApplicationOrigin());
    responseHeaders = new Headers(request.headers);
    for (const key of ["forwarded", "cf-connecting-ip", "cf-connecting-ipv6", "x-real-ip", "x-vercel-forwarded-for", "x-forwarded-for"]) responseHeaders.delete(key);
    responseHeaders.set("host", origin.host);
    responseHeaders.set("x-forwarded-host", origin.host);
    responseHeaders.set("x-forwarded-proto", origin.protocol.slice(0, -1));
  }
  const proceed = () => NextResponse.next(responseHeaders ? { request: { headers: responseHeaders } } : undefined);
  if (!/^\/(admin|member|user)(\/|$)/.test(path)) return proceed();
  const token = request.cookies.get("auth_token")?.value;
  const payload = token ? await verifyJwtToken(token) : null;
  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", process.env.NODE_ENV === "production" ? readApplicationOrigin() : request.url));
    if (token) response.cookies.set("auth_token", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
    return response;
  }
  if ((path.startsWith("/admin") && payload.role !== "ADMIN") || (path.startsWith("/member") && !["ADMIN", "MEMBER"].includes(payload.role))) return NextResponse.redirect(new URL("/unauthorized", process.env.NODE_ENV === "production" ? readApplicationOrigin() : request.url));
  return proceed();
}

export const config = { matcher: ["/:path*"] };
