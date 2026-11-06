import { NewsletterForm } from "@/components/newsletter/newsletter-form";
export function NewsletterBar() {
  return <section aria-label="Newsletter" className="bg-[#fed700] py-6 text-[#333e48]">
    <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 sm:px-6 lg:flex-row lg:px-8">
      <div className="max-w-md space-y-2"><h2 className="text-lg font-extrabold">Product news and offers</h2><p>Confirm your email to subscribe. Already subscribed? Request fresh preference instructions to unsubscribe.</p></div>
      <NewsletterForm />
    </div>
  </section>;
}
