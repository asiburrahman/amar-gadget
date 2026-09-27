import { prisma } from "../lib/prisma";

async function main() {
  const email = `testuser_${Date.now()}@example.com`;
  const password = "Password123!";
  const name = "Automated Test User";

  console.log(`1. Testing registration for: ${email}...`);
  const regRes = await fetch("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email,
      password,
      role: "USER",
    }),
  });

  const regData = await regRes.json();
  console.log("Registration Response:", regRes.status, regData);
  if (!regData.success) {
    throw new Error("Registration failed: " + JSON.stringify(regData));
  }

  console.log("2. Fetching generated OTP from database...");
  const otpRecord = await prisma.otpToken.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord) {
    throw new Error("No OTP found in database for " + email);
  }
  console.log("Found OTP code:", otpRecord.code);

  console.log("3. Verifying OTP...");
  const verifyRes = await fetch("http://localhost:3000/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      otp: otpRecord.code,
    }),
  });

  const verifyData = await verifyRes.json();
  console.log("Verification Response:", verifyRes.status, verifyData);
  if (!verifyData.success) {
    throw new Error("OTP verification failed: " + JSON.stringify(verifyData));
  }

  console.log("4. Logging in as new user...");
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const loginData = await loginRes.json();
  console.log("Login Response:", loginRes.status, loginData);
  if (!loginData.success) {
    throw new Error("Login failed: " + JSON.stringify(loginData));
  }

  console.log("5. Checking auth cookie from login response...");
  const setCookie = loginRes.headers.get("set-cookie");
  console.log("Auth Cookie Received:", !!setCookie);

  console.log("6. Verifying /api/auth/me with auth token...");
  const meRes = await fetch("http://localhost:3000/api/auth/me", {
    headers: {
      cookie: setCookie || "",
    },
  });
  const meData = await meRes.json();
  console.log("Current User API Response:", meData);

  if (meData.success && meData.user?.email === email) {
    console.log("🎉 ALL TESTS PASSED! User registration, OTP verification, login, and session validation are 100% WORKING!");
  } else {
    throw new Error("Session validation failed");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
