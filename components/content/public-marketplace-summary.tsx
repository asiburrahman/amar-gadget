import Link from "next/link";
import { readInformationPage } from "@/lib/site-information";

export async function PublicMarketplaceSummary() {
  let publication;
  try { publication = await readInformationPage("about"); }
  catch {
    return <div className="space-y-2"><p role="alert">Marketplace information is temporarily unavailable.</p><Link href="/about" className="underline">View marketplace information</Link></div>;
  }
  return <div className="space-y-2">
    <p className="text-xs text-gray-500 leading-relaxed font-medium">{publication?.summary ?? "Browse the catalog, review product details and contact the marketplace operator for purchase information."}</p>
    <Link href="/about" className="text-xs underline">About this marketplace</Link>
  </div>;
}
