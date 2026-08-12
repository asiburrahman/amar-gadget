import { Metadata } from "next";
import { H1, H2, P } from "@/components/ui/typography";
import { generateFAQSchema } from "@/lib/seo/schema";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Frequently Asked Questions (FAQ) | Amar Gadget",
    description: "Find answers regarding warranty claims, delivery timelines, payment options, and vendor registration on Amar Gadget.",
  };
}

export default function FAQPage() {
  const faqs = [
    {
      question: "Are all products sold on Amar Gadget 100% genuine?",
      answer: "Yes, absolutely! Every product listed on Amar Gadget is sourced directly from official brand distributors or verified authorized vendors with manufacturer warranty.",
    },
    {
      question: "How long does delivery take across Bangladesh?",
      answer: "Inside Dhaka city, delivery takes 24 to 48 hours. For outside Dhaka across all 64 districts, delivery typically arrives within 2 to 4 business days.",
    },
    {
      question: "What payment methods do you support?",
      answer: "We support Credit/Debit Cards (Visa, Mastercard, Amex), Mobile Financial Services (bKash, Nagad, Rocket), and Cash on Delivery (COD).",
    },
    {
      question: "How do I claim official brand warranty?",
      answer: "Your order invoice serves as your official warranty card. You can visit any authorized brand service center across Bangladesh or contact our support team for warranty processing.",
    },
    {
      question: "Can I register as a seller/vendor on Amar Gadget?",
      answer: "Yes! Authorized tech retailers and official distributors can sign up for a Member/Seller account to list their products on our multi-vendor platform.",
    },
  ];

  const faqSchema = generateFAQSchema(faqs);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="min-h-screen bg-background pb-16">
        {/* Header */}
        <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
          <div className="container mx-auto px-4 text-center max-w-3xl">
            <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
              Help Center & Guide
            </span>
            <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
              Frequently Asked Questions
            </H1>
            <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
              Find fast answers to common questions about orders, shipping, warranty, and seller onboarding.
            </P>
          </div>
        </section>

        {/* FAQ Accordion List */}
        <section className="container mx-auto px-4 py-12 max-w-3xl">
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <details
                key={index}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-200 [&[open]]:ring-1 [&[open]]:ring-primary/30"
              >
                <summary className="flex cursor-pointer items-center justify-between font-bold text-base text-foreground list-none">
                  <span>{faq.question}</span>
                  <span className="ml-4 transition-transform group-[open]:rotate-180 text-primary">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-xs sm:text-sm text-muted-foreground leading-relaxed pt-2 border-t border-border/50">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}