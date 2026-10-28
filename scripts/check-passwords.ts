import "dotenv/config";
import { prisma } from "../lib/prisma";
import { passwordHashStatus } from "../lib/password";

async function main() {
  const counts = { current: 0, legacy: 0, missing: 0, unsupported: 0 };
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({ select: { id: true, password: true }, orderBy: { id: "asc" }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const user of users) counts[passwordHashStatus(user.password)]++;
    if (users.length < 250) break;
    cursor = users[users.length - 1].id;
  }
  // Format inventory only: never guess credentials or print hashes/passwords.
  console.log(JSON.stringify({ passwordFormats: counts }));
}
main().catch(() => { console.error("Password format inventory failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
