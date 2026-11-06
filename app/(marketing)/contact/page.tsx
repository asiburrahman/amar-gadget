import type { Metadata } from "next";
import { H1, P } from "@/components/ui/typography";
import { ContactForm } from "@/components/support/contact-form";
import { PublicContactDetails } from "@/components/support/public-contact-details";
import { connection } from "next/server";

export const metadata: Metadata = {
  alternates: { canonical: "/contact" },
  title: "Contact & Support | Amar Gadget",
  description: "Submit an order, warranty or seller inquiry to Amar Gadget for administrator review.",
};

export default async function ContactPage() {
  await connection();
  return <div className="min-h-screen bg-background pb-16">
    <section className="border-b bg-muted/30 py-12">
      <div className="container mx-auto max-w-3xl px-4 text-center">
        <H1>Contact &amp; Support</H1>
        <P className="mt-3">Send an order, warranty or seller inquiry using the form below.</P>
      </div>
    </section>
    <section aria-label="Contact submission" className="container mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PublicContactDetails />
      <ContactForm />
    </section>
  </div>;
}
