let prisma;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be configured before seeding.");
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import("@prisma/client"), import("@prisma/adapter-pg")]);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000, max: 5 }) });
  const categories = [
    ["Electronics", "electronics"],
    ["Fashion", "fashion"],
    ["Home & Garden", "home-garden"],
    ["Sports & Outdoors", "sports-outdoors"],
    ["Books", "books"],
  ];

  for (const [name, slug] of categories) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.catalog-taxonomy.v1',0))`;
      const existing = await tx.category.findFirst({ where: { OR: [{ slug }, { aliases: { some: { slug } } }] }, select: { id: true } });
      if (!existing) await tx.category.create({ data: { name, slug } });
    });
  }

  const brands = ["Apple", "Samsung", "Sony", "Nike", "Adidas"];
  for (const name of brands) {
    const slug = name.toLowerCase();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('amar.catalog-taxonomy.v1',0))`;
      const existing = await tx.brand.findFirst({ where: { OR: [{ slug }, { aliases: { some: { slug } } }] }, select: { id: true } });
      if (!existing) await tx.brand.create({ data: { name, slug } });
    });
  }

  console.log("Seeded sample categories and brands.");
}

main()
  .catch(() => {
    console.error("Database seeding failed. Check migration state and catalog uniqueness privately; credentials and query details were not logged.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
