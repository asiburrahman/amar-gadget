import { isolatedTestDatabase } from "./helpers/isolated-database";

// Runs before any application import can construct a cached Prisma client.
// An ambient production DATABASE_URL must never win over the guarded fixture.
process.env.DATABASE_URL = isolatedTestDatabase(process.env);
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.APP_URL = "http://localhost";
