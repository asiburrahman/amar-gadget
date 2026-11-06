import "dotenv/config";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";
import { registerSchema } from "../lib/validations/auth";
import { z } from "zod";

async function main() {
  const email = z.string().email().parse(process.env.SEED_ADMIN_EMAIL).trim().toLowerCase();
  const password = registerSchema.shape.password.parse(process.env.SEED_ADMIN_PASSWORD);
  // Explicit operator-provided account and password; no default target,
  // embedded credentials, account creation or plaintext credential output.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true } });
  if (!user) throw new Error("The target account must already exist.");
  const hashed = await hashPassword(password);
  const result = await prisma.user.updateMany({ where: { id: user.id, password: user.password }, data: { role: "ADMIN", isVerified: true, password: hashed } });
  if (result.count !== 1) throw new Error("The account changed during provisioning.");
  console.log("The explicitly configured account was provisioned as administrator.");
}
main().catch(() => { console.error("Admin provisioning failed. Check the explicit target, password policy and database configuration."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
