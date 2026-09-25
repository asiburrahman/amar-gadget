import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

async function main() {
  const adminPass = hashPassword("AdminPassword123!");
  
  const user = await prisma.user.update({
    where: { email: "asibur70@gmail.com" },
    data: {
      role: "ADMIN",
      isVerified: true,
      password: adminPass,
    },
  });

  console.log(`✅ User ${user.email} successfully updated to role ${user.role} with password AdminPassword123!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
