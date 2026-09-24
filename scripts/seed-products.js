require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaNeon } = require("@prisma/adapter-neon");

const databaseUrl = process.env.DATABASE_URL;
const adapter = new PrismaNeon({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding products...");

  // Create default categories
  const categoriesData = [
    { name: "Smartphones", slug: "smartphones", image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400" },
    { name: "Laptops", slug: "laptops", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400" },
    { name: "Audio", slug: "audio", image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400" },
    { name: "Smart Watches", slug: "smart-watches", image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400" },
    { name: "Accessories", slug: "accessories", image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400" },
  ];

  for (const cat of categoriesData) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }

  const categories = await prisma.category.findMany();
  const catMap = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

  // Find or create admin user for sellerId
  let seller = await prisma.user.findFirst();
  if (!seller) {
    seller = await prisma.user.create({
      data: {
        email: "admin@amargadget.com",
        name: "Amar Gadget Admin",
        role: "ADMIN",
        isVerified: true,
      },
    });
  }

  const productsData = [
    {
      name: "Apple iPhone 16 Pro Max 256GB",
      slug: "iphone-16-pro-max-256gb",
      description: "Natural Titanium finish with A18 Pro chip, 48MP Fusion camera system and telephoto lens.",
      price: 165000,
      discountPrice: 159990,
      stock: 12,
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.9,
      categoryId: catMap["smartphones"],
      sellerId: seller.id,
    },
    {
      name: 'Apple MacBook Air 15" M3 Chip 16GB / 512GB',
      slug: "macbook-air-15-m3-16gb-512gb",
      description: "Liquid Retina display with 18-hour battery life, fanless quiet design, and MagSafe 3 charging.",
      price: 182000,
      discountPrice: 174900,
      stock: 8,
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.8,
      categoryId: catMap["laptops"],
      sellerId: seller.id,
    },
    {
      name: "Sony WH-1000XM5 Noise Canceling Headphones",
      slug: "sony-wh-1000xm5-headphones",
      description: "Industry-leading noise canceling with dual processors, 8 microphones, and 30-hour battery life.",
      price: 38500,
      discountPrice: 34900,
      stock: 15,
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.9,
      categoryId: catMap["audio"],
      sellerId: seller.id,
    },
    {
      name: "Samsung Galaxy Watch 6 Classic 47mm LTE",
      slug: "samsung-galaxy-watch-6-classic",
      description: "Rotating stainless steel bezel with advanced sleep tracking, ECG sensor, and Sapphire Crystal glass.",
      price: 34990,
      discountPrice: 31900,
      stock: 10,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.7,
      categoryId: catMap["smart-watches"],
      sellerId: seller.id,
    },
    {
      name: "Keychron K2 Pro Wireless Mechanical Keyboard",
      slug: "keychron-k2-pro-mechanical-keyboard",
      description: "QMK/VIA programmable custom mechanical keyboard with hot-swappable switches and RGB backlighting.",
      price: 12500,
      discountPrice: null,
      stock: 20,
      imageUrl: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: false,
      rating: 4.8,
      categoryId: catMap["accessories"],
      sellerId: seller.id,
    },
    {
      name: "Logitech MX Master 3S Wireless Performance Mouse",
      slug: "logitech-mx-master-3s-mouse",
      description: "8K DPI track-on-glass optical sensor with Quiet Clicks and MagSpeed electromagnetic scrolling wheel.",
      price: 13900,
      discountPrice: 12500,
      stock: 14,
      imageUrl: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.9,
      categoryId: catMap["accessories"],
      sellerId: seller.id,
    },
    {
      name: "Samsung Galaxy S24 Ultra 512GB Titanium",
      slug: "samsung-galaxy-s24-ultra-512gb",
      description: "Built-in S Pen, Snapdragon 8 Gen 3 for Galaxy, 200MP camera, and Galaxy AI features.",
      price: 155000,
      discountPrice: 147000,
      stock: 9,
      imageUrl: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: true,
      rating: 4.8,
      categoryId: catMap["smartphones"],
      sellerId: seller.id,
    },
    {
      name: "Apple iPad Air 11-Inch M2 Chip 256GB WiFi",
      slug: "ipad-air-11-m2-256gb",
      description: "Stunning Liquid Retina display with M2 power, Apple Pencil Pro support, and all-day battery.",
      price: 88000,
      discountPrice: 82500,
      stock: 11,
      imageUrl: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
      status: "APPROVED",
      isFeatured: false,
      rating: 4.7,
      categoryId: catMap["smartphones"],
      sellerId: seller.id,
    },
  ];

  for (const prod of productsData) {
    await prisma.product.upsert({
      where: { slug: prod.slug },
      update: prod,
      create: prod,
    });
  }

  const count = await prisma.product.count();
  console.log(`Successfully seeded ${count} products into database!`);
}

main()
  .catch((e) => {
    console.error("Error seeding products:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
