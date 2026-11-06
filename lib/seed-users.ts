import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { registerSchema } from "@/lib/validations/auth";

export async function seedDefaultAccounts() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Default account seeding is disabled in production.");
  }

  const accounts = [
    {
      name: "System Super Admin",
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      role: "ADMIN",
    },
    {
      name: "Official Vendor",
      email: process.env.SEED_SELLER_EMAIL,
      password: process.env.SEED_SELLER_PASSWORD,
      role: "MEMBER",
    },
    {
      name: "Local Customer",
      email: process.env.SEED_USER_EMAIL,
      password: process.env.SEED_USER_PASSWORD,
      role: "USER",
    },
  ];

  if (accounts.some((account) => !account.email || !account.password)) {
    throw new Error("Set all SEED_*_EMAIL and SEED_*_PASSWORD values before seeding accounts.");
  }

  for (const account of accounts) {
    const email = registerSchema.shape.email.parse(account.email).trim().toLowerCase();
    const password = registerSchema.shape.password.parse(account.password);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue;

    await prisma.user.create({
      data: {
        name: account.name,
        email,
        password: await hashPassword(password),
        role: account.role,
        sellerStatus: account.role === "MEMBER" ? "PENDING" : "APPROVED",
        isVerified: true,
      },
    });
    console.log(`Created local seed account for ${account.role}.`);
  }
}
