import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function seedDefaultAccounts() {
  const defaultAccounts = [
    {
      name: "System Super Admin",
      email: "admin@amargadget.com",
      password: "AdminPassword123!",
      role: "ADMIN",
    },
    {
      name: "Official Apple Store Vendor",
      email: "vendor@amargadget.com",
      password: "VendorPassword123!",
      role: "MEMBER",
    },
    {
      name: "Demo Customer",
      email: "user@amargadget.com",
      password: "UserPassword123!",
      role: "USER",
    },
  ];

  for (const acc of defaultAccounts) {
    const existing = await prisma.user.findUnique({
      where: { email: acc.email },
    });

    if (!existing) {
      await prisma.user.create({
        data: {
          name: acc.name,
          email: acc.email,
          password: hashPassword(acc.password),
          role: acc.role,
        },
      });
      console.log(`✅ Default account created: ${acc.email} (${acc.role})`);
    }
  }
}
