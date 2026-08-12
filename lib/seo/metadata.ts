import type { Metadata } from "next";

export interface MetadataProps {
  title: string;
  description: string;
  image?: string;
  keywords?: string[];
  canonicalUrl?: string;
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  authors?: string[];
}

const getBaseUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "https://amargadget.com";
  const prefixedUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
  return prefixedUrl.replace(/\/$/, "");
};

const DEFAULT_SITE_URL = getBaseUrl();
const DEFAULT_OG_IMAGE = `${DEFAULT_SITE_URL}/og-image.jpg`;
const DEFAULT_DESCRIPTION =
  "Amar Gadget is Bangladesh's premier multi-vendor marketplace for flagship smartphones, laptops, audio, and gadgets with official warranty.";

export function createMetadata({
  title,
  description,
  image,
  keywords = ["electronics", "gadgets", "smartphone", "laptop", "Bangladesh", "Amar Gadget"],
  canonicalUrl,
  noIndex = false,
  type = "website",
  publishedTime,
  authors,
}: MetadataProps): Metadata {
  const siteName = "Amar Gadget";
  
  // Prevent duplicate brand suffixes if title already includes "Amar Gadget"
  const fullTitle = title.includes(siteName) ? title : `${title} | ${siteName}`;

  // Sanitize description
  const cleanDescription = (description || DEFAULT_DESCRIPTION).trim();

  // Resolve absolute image URL safely
  let ogImageUrl = DEFAULT_OG_IMAGE;
  if (image) {
    if (image.startsWith("http://") || image.startsWith("https://")) {
      ogImageUrl = image;
    } else if (image.startsWith("//")) {
      ogImageUrl = `https:${image}`;
    } else {
      ogImageUrl = `${DEFAULT_SITE_URL}${image.startsWith("/") ? "" : "/"}${image}`;
    }
  }

  // Resolve canonical path safely
  const canonicalPath = canonicalUrl
    ? canonicalUrl.startsWith("http")
      ? canonicalUrl
      : `${DEFAULT_SITE_URL}${canonicalUrl.startsWith("/") ? "" : "/"}${canonicalUrl}`
    : DEFAULT_SITE_URL;

  return {
    title: fullTitle,
    description: cleanDescription,
    keywords,
    applicationName: siteName,
    authors: authors ? authors.map((name) => ({ name })) : [{ name: siteName }],
    generator: "Next.js",
    publisher: siteName,
    metadataBase: new URL(DEFAULT_SITE_URL),
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
      googleBot: {
        index: !noIndex,
        follow: !noIndex,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title: fullTitle,
      description: cleanDescription,
      url: canonicalPath,
      siteName,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: "en_US",
      type,
      ...(publishedTime && { publishedTime }),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: cleanDescription,
      images: [ogImageUrl],
      creator: "@amargadget",
      site: "@amargadget",
    },
  };
}