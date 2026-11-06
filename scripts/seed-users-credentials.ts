import "dotenv/config";
import { prisma } from "../lib/prisma";
import { seedDefaultAccounts } from "../lib/seed-users";

seedDefaultAccounts().catch(() => { console.error("Local account seeding failed. Check the required SEED_* configuration; production seeding is disabled."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
