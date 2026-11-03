import type { Metadata } from "next";
import { NewsletterPreferenceAction } from "@/components/newsletter/preference-action";
export const metadata: Metadata = { title: "Unsubscribe from newsletter | Amar Gadget", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function UnsubscribeNewsletterPage() {
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-10"><h1 className="text-3xl font-bold">Unsubscribe from newsletter</h1><NewsletterPreferenceAction action="unsubscribe" /></main>;
}
