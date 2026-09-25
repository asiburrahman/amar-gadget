import { prisma } from "../lib/prisma";
import { verifyPassword } from "../lib/auth";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      role: true,
      password: true,
      isVerified: true,
    }
  });

  const testPasswords = [
    "AdminPassword123!",
    "SellerPassword123!",
    "UserPassword123!",
    "admin123",
    "Admin123!",
    "Password123!",
    "12345678",
    "asibur123",
    "Asibur123!",
    "asibur70",
    "amar-gadget",
    "AmarGadget123!",
  ];

  for (const u of users) {
    console.log(`\nUser: ${u.email} (Role: ${u.role}, Verified: ${u.isVerified}, HasPassword: ${!!u.password})`);
    if (u.password) {
      console.log(`  Full stored password: "${u.password}"`);
      let matched = false;
      for (const p of testPasswords) {
        if (verifyPassword(p, u.password)) {
          console.log(`  ==> MATCHED PASSWORD: "${p}"`);
          matched = true;
          break;
        }
      }
      if (!matched) {
        console.log(`  Password hash prefix: ${u.password.substring(0, 15)}...`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
