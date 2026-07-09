import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "true";

// Hard-crash at runtime if JWT_SECRET is not configured
if (!isBuildTime && !process.env.JWT_SECRET) {
  throw new Error("❌ JWT_SECRET environment variable is missing at runtime!");
}

const JWT_SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-for-build-purposes-only-32chars"
);

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  const path = request.nextUrl.pathname;

  if (!token) {
    if (path.startsWith("/admin") || path.startsWith("/member") || path.startsWith("/user")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    const userRole = payload.role as string;

    // Strict Role-Based Access Control Checks
    if (path.startsWith("/admin") && userRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
    if (path.startsWith("/member") && !["ADMIN", "MEMBER"].includes(userRole)) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }

    const response = NextResponse.next();
    response.headers.set("x-user-id", payload.sub as string);
    response.headers.set("x-user-role", userRole);
    return response;
  } catch (error) {
    console.error("JWT Verification failed inside Edge proxy:", error);
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("auth_token");
    return response;
  }
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/member/:path*",
    "/user/:path*",
  ],
};
