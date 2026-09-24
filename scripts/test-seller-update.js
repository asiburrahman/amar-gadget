require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaNeon } = require("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const seller = await prisma.user.findFirst({ where: { role: "MEMBER" } });
  if (seller) {
    const updated = await prisma.user.update({
      where: { id: seller.id },
      data: { sellerStatus: "APPROVED" },
    });
    console.log("Successfully updated seller status in DB:", updated.email, "->", updated.sellerStatus);
  } else {
    console.log("No seller found");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
