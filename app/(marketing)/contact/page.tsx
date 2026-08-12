import { Metadata } from "next";
import { H1, P } from "@/components/ui/typography";
import { FormInput } from "@/components/shared/form-input";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Contact & Support | Amar Gadget",
    description: "Get in touch with Amar Gadget customer support team for order inquiries, warranty claims, and seller partnerships.",
  };
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Header */}
      <section className="border-b bg-gradient-to-b from-muted/40 via-background to-background py-12 lg:py-16">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            24/7 Customer Support
          </span>
          <H1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Get in Touch With Us
          </H1>
          <P className="mt-3 text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Have questions about an order, warranty claims, or vendor onboarding? We're here to help!
          </P>
        </div>
      </section>

      {/* Grid */}
      <section className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Support Info */}
          <div className="space-y-6">
            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-2">
              <div className="text-xl">📞</div>
              <h3 className="font-bold text-base text-foreground">Phone Support</h3>
              <p className="text-xs text-muted-foreground">+880 1700 000000</p>
              <p className="text-xs text-muted-foreground">+880 1800 000000</p>
            </div>

            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-2">
              <div className="text-xl">✉️</div>
              <h3 className="font-bold text-base text-foreground">Email Inquiries</h3>
              <p className="text-xs text-muted-foreground">support@amargadget.com</p>
              <p className="text-xs text-muted-foreground">sellers@amargadget.com</p>
            </div>

            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-2">
              <div className="text-xl">📍</div>
              <h3 className="font-bold text-base text-foreground">Headquarters</h3>
              <p className="text-xs text-muted-foreground">
                Level 12, Amar Gadget Tower, Banani C/A, Dhaka-1213, Bangladesh.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-2 p-6 sm:p-8 rounded-2xl border border-border bg-card shadow-sm space-y-6">
            <h3 className="text-xl font-bold text-foreground border-b pb-3">
              Send Us a Message
            </h3>

            <form className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Your Name" placeholder="Rahim Uddin" required />
                <FormInput label="Email Address" type="email" placeholder="rahim@example.com" required />
              </div>
              <FormInput label="Subject / Order Number" placeholder="Query about Order #AG-10492" required />
              
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Message</label>
                <textarea
                  rows={5}
                  placeholder="How can we assist you today?"
                  className="w-full rounded-md border border-input bg-background p-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  required
                />
              </div>

              <button
                type="submit"
                className="h-11 px-8 rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Send Message
              </button>
            </form>
          </div>

        </div>
      </section>
    </div>
  );
}