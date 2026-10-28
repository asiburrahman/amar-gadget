import { NextResponse, type NextRequest } from "next/server";
import { verifyJwtToken } from "@/lib/session-token";

/** Optimistic navigation only. Layouts, APIs and actions validate the current
 * database version through lib/session-validation before protected access. */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  const payload = token ? await verifyJwtToken(token) : null;
  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (token) response.cookies.set("auth_token", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
    return response;
  }
  const path = request.nextUrl.pathname;
  if ((path.startsWith("/admin") && payload.role !== "ADMIN") || (path.startsWith("/member") && !["ADMIN", "MEMBER"].includes(payload.role))) return NextResponse.redirect(new URL("/unauthorized", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/member/:path*", "/user/:path*"] };
