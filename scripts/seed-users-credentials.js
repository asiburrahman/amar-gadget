require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaNeon } = require("@prisma/adapter-neon");
const crypto = require("crypto");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

async function seedUsers() {
  console.log("Seeding verified admin, member, and user accounts...");

  const adminPass = hashPassword("AdminPassword123!");
  const sellerPass = hashPassword("SellerPassword123!");
  const userPass = hashPassword("UserPassword123!");

  // 1. Admin
  const admin = await prisma.user.upsert({
    where: { email: "admin@amargadget.com" },
    update: {
      password: adminPass,
      role: "ADMIN",
      isVerified: true,
      name: "Amar Gadget Admin",
    },
    create: {
      email: "admin@amargadget.com",
      password: adminPass,
      role: "ADMIN",
      isVerified: true,
      name: "Amar Gadget Admin",
    },
  });
  console.log("Admin account created/updated:", admin.email);

  // 2. Member / Seller
  const seller = await prisma.user.upsert({
    where: { email: "seller@amargadget.com" },
    update: {
      password: sellerPass,
      role: "MEMBER",
      isVerified: true,
      name: "Amar Electronics Seller",
    },
    create: {
      email: "seller@amargadget.com",
      password: sellerPass,
      role: "MEMBER",
      isVerified: true,
      name: "Amar Electronics Seller",
    },
  });
  console.log("Member (Seller) account created/updated:", seller.email);

  // 3. Regular Customer
  const customer = await prisma.user.upsert({
    where: { email: "user@amargadget.com" },
    update: {
      password: userPass,
      role: "USER",
      isVerified: true,
      name: "Asibur Rahman",
    },
    create: {
      email: "user@amargadget.com",
      password: userPass,
      role: "USER",
      isVerified: true,
      name: "Asibur Rahman",
    },
  });
  console.log("Customer account created/updated:", customer.email);

  console.log("Users seeding successfully completed!");
  await prisma.$disconnect();
}

seedUsers().catch((err) => {
  console.error("User seeding failed:", err);
  process.exit(1);
});
