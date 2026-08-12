import { Metadata } from "next";
import { H1, H2, P } from "@/components/ui/typography";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "About Us | Amar Gadget",
    description: "Learn about Amar Gadget, Bangladesh's leading multi-vendor marketplace for genuine electronics and flagship tech.",
  };
}

export default function AboutPage() {
  const stats = [
    { label: "Verified Gadgets", value: "1,500+" },
    { label: "Happy Customers", value: "48,500+" },
    { label: "Official Partners", value: "25+" },
    { label: "Delivery Cities", value: "64 Districts" },
  ];

  const values = [
    {
      icon: "🛡️",
      title: "100% Genuine Warranty",
      description: "Every smartphone, laptop, and accessory comes backed by official brand warranty.",
    },
    {
      icon: "⚡",
      title: "Express 24h Delivery",
      description: "Fast nationwide delivery across Dhaka, Chittagong, Sylhet, and all 64 districts.",
    },
    {
      icon: "💎",
      title: "Multi-Vendor Ecosystem",
      description: "Empowering authorized sellers and vendors with seamless storefront tools.",
    },
    {
      icon: "🔒",
      title: "Secure Payments",
      description: "Encrypted credit card checkout, bKash, Nagad, and Cash on Delivery options.",
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Hero Banner */}
      <section className="border-b bg-gradient-to-b from-primary/10 via-background to-background py-16 lg:py-24">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-4">
            Our Mission & Vision
          </span>
          <H1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            Connecting Bangladesh to Next-Gen Tech
          </H1>
          <P className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Amar Gadget is built to solve Bangladesh's gadget market challenges by providing a trusted multi-vendor marketplace for genuine electronics.
          </P>
        </div>
      </section>

      {/* Stats Counter */}
      <section className="py-12 border-b bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            {stats.map((s) => (
              <div key={s.label} className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-1">
                <div className="text-3xl sm:text-4xl font-extrabold text-primary">{s.value}</div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <H2 className="text-3xl font-extrabold">Why Choose Amar Gadget</H2>
          <P className="mt-2 text-muted-foreground">Built on trust, speed, and authentic consumer technology.</P>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {values.map((v) => (
            <div key={v.title} className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-3">
              <span className="text-3xl p-2 rounded-xl bg-primary/10 inline-block">{v.icon}</span>
              <h3 className="text-xl font-bold text-foreground">{v.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{v.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}