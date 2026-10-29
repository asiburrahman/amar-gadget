import type { Metadata } from "next";
import { readApplicationOrigin } from "@/config/runtime";
import { canonicalUrl, publicImageUrl } from "./urls";
export interface MetadataProps { title: string; description: string; image?: string; keywords?: string[]; canonicalUrl?: string; noIndex?: boolean; type?: "website" | "article"; publishedTime?: string; authors?: string[] }
export function paginatedMetadata(path: string, title: string, description: string, pageInput: unknown): Metadata {
  const valid = pageInput === undefined || (typeof pageInput === "string" && /^[1-9]\d{0,5}$/.test(pageInput));
  const page = valid ? Number(pageInput ?? 1) : 1;
  const metadata = createMetadata({ title, description, canonicalUrl: `${path}${page > 1 ? `?page=${page}` : ""}`, noIndex: !valid || page > 1 });
  return !valid || page > 1 ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}
export function createMetadata({ title, description, image, keywords, canonicalUrl: path = "/", noIndex = false, type = "website", publishedTime, authors }: MetadataProps): Metadata {
  const fullTitle = title.includes("Amar Gadget") ? title : `${title} | Amar Gadget`, url = canonicalUrl(path), ogImage = publicImageUrl(image);
  return { title: fullTitle, description: description.trim(), keywords, applicationName: "Amar Gadget", metadataBase: new URL(readApplicationOrigin()), alternates: { canonical: url },
    ...(authors ? { authors: authors.map((name) => ({ name })) } : {}),
    robots: { index: !noIndex, follow: !noIndex, googleBot: { index: !noIndex, follow: !noIndex, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: { title: fullTitle, description: description.trim(), url, siteName: "Amar Gadget", locale: "en_BD", type, ...(ogImage ? { images: [{ url: ogImage, alt: title }] } : {}), ...(publishedTime ? { publishedTime } : {}) },
    twitter: { card: ogImage ? "summary_large_image" : "summary", title: fullTitle, description: description.trim(), ...(ogImage ? { images: [ogImage] } : {}) },
  };
}
