import { cache } from "react";
import { connection } from "next/server";
import { readPublishedSiteContent } from "@/lib/site-content";
import { createMetadata } from "@/lib/seo/metadata";
import type { SITE_PAGE_SLUGS } from "@/lib/validations/site-content";

export type InformationSlug = typeof SITE_PAGE_SLUGS[number];
// These are operational navigation guides, never seeded operator publications
// or substitutes for the operator's policies, commercial promises or identity.
export const informationGuides: Record<InformationSlug, { title: string; summary: string; sections: { heading: string; body: string }[] }> = {
  about: {
    title: "About this marketplace", summary: "Browse products, manage your account and contact the marketplace operator.",
    sections: [
      { heading: "Product information", body: "Review the individual product listing and checkout summary before ordering. Ask the operator to clarify any missing product, seller or delivery information." },
      { heading: "Operator information", body: "The operator has not published an introduction here. Use Contact to request business information or help with an order." },
    ],
  },
  faq: {
    title: "Shopping help", summary: "Find the product catalog, account area, order tracking and support form.",
    sections: [
      { heading: "Where can I review an order?", body: "Sign in to your account to view your order history. The Track order page also accepts the order reference or tracking code and the phone number used at checkout." },
      { heading: "Where can I ask a product or payment question?", body: "Use Contact and include the relevant product or order reference. Do not send passwords, verification codes or card details." },
      { heading: "Where are delivery and return conditions?", body: "Check the product listing, checkout and the operator's published terms and returns information. If the information you need is missing, ask support before ordering." },
    ],
  },
  returns: {
    title: "Returns and refund enquiries", summary: "Contact support about an item, return or refund using your order reference.",
    sections: [
      { heading: "Ask about your order", body: "Include the order reference, the affected item and quantity, and the reason for your enquiry. Keep the item and packaging until the operator confirms the next steps." },
      { heading: "Request the applicable conditions", body: "The operator has not published a returns policy here. Ask support about eligibility, shipping costs and refund handling before sending an item back. This guide does not promise a return window or refund outcome." },
    ],
  },
  "privacy-policy": {
    title: "Privacy information", summary: "Request the operator's privacy policy and answers about your personal information.",
    sections: [
      { heading: "Policy awaiting operator publication", body: "The operator has not published its privacy policy here. Use Contact to ask how your information is handled, how long it is retained, who receives it and how to exercise your rights before providing information you are unsure about." },
      { heading: "Contact safely", body: "Include only the information needed for your enquiry. Do not put passwords, verification codes or payment card details in a support message." },
    ],
  },
  terms: {
    title: "Terms information", summary: "Request the operator's terms and clarify purchase conditions before ordering.",
    sections: [
      { heading: "Terms awaiting operator publication", body: "The operator has not published its terms here. Ask support for the applicable purchase conditions, seller responsibilities and dispute process. This navigation guide does not establish contractual terms." },
      { heading: "Review your purchase", body: "Read the product listing and checkout summary. Ask about any missing delivery, warranty or return conditions before placing an order." },
    ],
  },
};

export const readInformationPage = cache(async (slug: InformationSlug) => {
  await connection();
  return readPublishedSiteContent({ kind: "PAGE", slug });
});

export async function informationMetadata(slug: InformationSlug) {
  const publication = await readInformationPage(slug), guide = informationGuides[slug];
  return createMetadata({ title: publication?.title ?? guide.title, description: publication?.summary ?? guide.summary,
    canonicalUrl: `/${slug}`, noIndex: !publication });
}
