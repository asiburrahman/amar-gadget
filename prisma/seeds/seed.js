const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured before seeding.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, max: 5 }),
});

async function main() {
  const categories = [
    ["Electronics", "electronics"],
    ["Fashion", "fashion"],
    ["Home & Garden", "home-garden"],
    ["Sports & Outdoors", "sports-outdoors"],
    ["Books", "books"],
  ];

  for (const [name, slug] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name },
      create: { name, slug },
    });
  }

  const brands = ["Apple", "Samsung", "Sony", "Nike", "Adidas"];
  for (const name of brands) {
    const slug = name.toLowerCase();
    await prisma.brand.upsert({
      where: { slug },
      update: { name },
      create: { name, slug },
    });
  }

  console.log("Seeded sample categories and brands.");
}

main()
  .catch((error) => {
    console.error("Database seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
