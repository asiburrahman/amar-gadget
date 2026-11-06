import type { Metadata } from "next";
import { NewsletterForm } from "@/components/newsletter/newsletter-form";
export const metadata: Metadata = { title: "Newsletter preferences | Amar Gadget", alternates: { canonical: "/newsletter" }, robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function NewsletterPage() {
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-10"><h1 className="text-3xl font-bold">Newsletter preferences</h1><p>Request an email to confirm a new subscription or manage an existing preference. Opening an email link does not change your preference until you confirm the action on its page.</p><NewsletterForm /></main>;
}
