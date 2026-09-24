require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaNeon } = require("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function cleanDemoProducts() {
  console.log("Checking products in database...");

  const products = await prisma.product.findMany({
    include: { seller: { select: { email: true, name: true } } },
  });

  console.log(`Found ${products.length} products total.`);

  // Find products with example.com URLs or placeholder demo data
  const demoProducts = products.filter(
    (p) =>
      p.imageUrl?.includes("example.com") ||
      p.slug.includes("smartphone-x1") ||
      p.slug.includes("wireless-headphones-pro") ||
      p.slug.includes("4k-ultra-hd-smart-tv") ||
      p.slug.includes("mens-casual-shirt") ||
      p.slug.includes("womens-running-shoes") ||
      p.slug.includes("coffee-maker-deluxe") ||
      p.slug.includes("yoga-mat-premium") ||
      p.slug.includes("web-development-guide")
  );

  console.log(`Found ${demoProducts.length} dummy/demo products to remove:`);
  demoProducts.forEach((dp) => console.log(` - ${dp.name} (${dp.id})`));

  if (demoProducts.length > 0) {
    const demoIds = demoProducts.map((p) => p.id);
    // Delete order items or reviews referencing demo products if any
    await prisma.orderItem.deleteMany({ where: { productId: { in: demoIds } } });
    await prisma.review.deleteMany({ where: { productId: { in: demoIds } } });
    await prisma.wishlist.deleteMany({ where: { productId: { in: demoIds } } });

    const deleted = await prisma.product.deleteMany({
      where: { id: { in: demoIds } },
    });
    console.log(`✓ Deleted ${deleted.count} demo products from database.`);
  } else {
    console.log("✓ No dummy demo products found.");
  }

  const remainingProducts = await prisma.product.findMany({
    include: { seller: { select: { name: true, email: true } } },
  });
  console.log(`\nRemaining Authentic Seller Products (${remainingProducts.length}):`);
  remainingProducts.forEach((rp) => {
    console.log(`- ${rp.name} | Price: ৳${rp.price} | Status: ${rp.status} | Seller: ${rp.seller?.name || rp.seller?.email}`);
  });

  await prisma.$disconnect();
}

cleanDemoProducts().catch((err) => {
  console.error("Failed to clean demo products:", err);
  process.exit(1);
});
