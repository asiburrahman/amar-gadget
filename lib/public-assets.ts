import { readdirSync } from "node:fs";
import { resolve } from "node:path";

let assets: Set<string> | undefined;
export function isPublicAsset(pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (/^\/(api|admin|member|user)(\/|$)/.test(decoded)) return false;
  if (!assets) {
    assets = new Set();
    const visit = (relative = "") => {
      for (const entry of readdirSync(resolve("public", relative), { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const next = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(next);
        else if (entry.isFile()) assets!.add(`/${next}`);
      }
    };
    try { visit(); } catch { /* Missing public files never grant route access. */ }
  }
  return assets.has(decoded);
}
