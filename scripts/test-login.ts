import { prisma } from "../lib/prisma";
import { signJwtToken } from "../lib/auth";

async function test() {
  console.log("1. Testing database connection...");
  try {
    const user = await prisma.user.findFirst();
    console.log("User query success! User:", user ? { id: user.id, email: user.email, role: user.role } : "No user in database");
    
    if (user) {
      console.log("2. Testing signJwtToken...");
      const token = await signJwtToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
      console.log("JWT token signed successfully:", token.substring(0, 30) + "...");
    }
  } catch (err: any) {
    console.error("❌ CRITICAL ERROR IN DB/AUTH:", err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
