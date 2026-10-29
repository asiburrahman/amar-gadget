import "dotenv/config";
import { prisma } from "../lib/prisma";
import { productMediaStore } from "../lib/cloudflare/r2";
import { cleanupProductImages } from "../lib/product-media-cleanup";
import { processImageCleanupJobs } from "../lib/product-image-lifecycle";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--cursor="))) throw new Error("Use --apply and/or --cursor only");
  const expected = process.env.MEDIA_CLEANUP_DATABASE;
  const databases = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!expected || databases[0]?.name !== expected) throw new Error("Set MEDIA_CLEANUP_DATABASE to the intended database name");
  const cursor = args.find((arg) => arg.startsWith("--cursor="))?.slice(9);
  const store = productMediaStore();
  const jobs = await processImageCleanupJobs(prisma, store, { apply: args.includes("--apply"), limit: 25 });
  const result = await cleanupProductImages(prisma, store, { apply: args.includes("--apply"), cursor });
  console.log(JSON.stringify({ event: "product_image_cleanup", dryRun: !args.includes("--apply"), jobs, ...result }));
  if (result.errors || jobs.errors) process.exitCode = 1;
}
main().catch(() => { console.error("Image cleanup failed. Verify the explicit database target, storage configuration and arguments."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
