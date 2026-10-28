// Codex audit evidence: reads repository source and tests the installed adapter.
// No environment files, credentials, database queries, or external services used.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const root = fileURLToPath(new URL("../", import.meta.url));
async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  }));
  return files.flat().sort();
}

const inventory = [];
for (const file of await walk("app")) {
  if (!/\/(page\.tsx|route\.ts)$/.test(file)) continue;
  const source = await readFile(path.join(root, file), "utf8");
  const route = "/" + file.split("/").slice(1, -1)
    .filter((part) => !part.startsWith("("))
    .join("/");
  inventory.push({
    route,
    file,
    kind: file.endsWith("page.tsx") ? "page" : "api",
    ...(file.endsWith("page.tsx")
      ? { textOnlyPlaceholder: /^\s*export default function Page\(\)\s*\{\s*return <div>[^<]*<\/div>;?\s*\}\s*$/.test(source) }
      : { methods: [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1]) }),
  });
}

const adapter = await new PrismaNeonHttp("postgresql://audit:audit@localhost:5432/audit", {}).connect();
let transactionError = null;
try {
  await adapter.startTransaction();
} catch (error) {
  transactionError = error.message;
} finally {
  await adapter.dispose();
}
console.log(JSON.stringify({
  scope: "Offline source inventory and installed HTTP adapter capability; no live integration checks",
  counts: {
    pages: inventory.filter((item) => item.kind === "page").length,
    apiRoutes: inventory.filter((item) => item.kind === "api").length,
    textOnlyPlaceholderPages: inventory.filter((item) => item.textOnlyPlaceholder).length,
  },
  httpAdapterTransactionError: transactionError,
  inventory,
}, null, 2));
