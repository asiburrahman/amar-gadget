import { Metadata } from "next";
import Link from "next/link";
import { H1, P } from "@/components/ui/typography";

export const metadata: Metadata = {
  title: "Returns & Exchange Policy | Amar Gadget",
  description: "Learn about Amar Gadget's 7-day hassle-free replacement and official return policy.",
};

export default function ReturnsPage() {
  return (
    <div className="min-h-screen bg-background py-12 md:py-16">
      <div className="container mx-auto px-4 max-w-4xl space-y-8">
        <div>
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            Hassle-Free Protection
          </span>
          <H1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Returns &amp; Replacement Policy
          </H1>
          <P className="mt-2 text-muted-foreground">
            We provide a 7-day official replacement warranty for defective products and authentic brand servicing.
          </P>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-bold text-base text-foreground">1. Return Eligibility</h3>
            <p className="text-muted-foreground">
              To be eligible for a return or replacement, your gadget must be unused, in the original packaging with all warranty stickers, manuals, accessories, and the purchase invoice intact.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-base text-foreground">2. 7 Days Replacement Warranty</h3>
            <p className="text-muted-foreground">
              If your device arrives physically damaged, missing parts, or exhibits manufacturing hardware defects within 7 days of delivery, contact our customer support immediately for an express exchange.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-base text-foreground">3. Official Brand Warranty</h3>
            <p className="text-muted-foreground">
              After 7 days, products covered under official manufacturer warranty (Apple, Samsung, Sony, etc.) can be serviced at authorized service centers across Bangladesh.
            </p>
          </section>

          <div className="pt-4 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Need to initiate a return?</span>
            <Link href="/contact" className="text-primary font-bold hover:underline">
              Contact Support Team &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
