import Link from "next/link";
import { readPublicSupportContact } from "@/lib/support-contact";

export async function PublicContactDetails({ compact = false }: { compact?: boolean }) {
  let contact;
  try { contact = await readPublicSupportContact(); }
  catch {
    console.error("Public support details unavailable; configuration and database diagnostics were not logged.");
    return <div className="space-y-2"><p role="alert">Support contact details are temporarily unavailable. Reload to try again.</p>{compact && <Link href="/contact" className="underline">Send a support inquiry</Link>}</div>;
  }
  if (!contact) return compact ? <Link href="/contact" className="underline">Send a support inquiry</Link> : null;
  return <section aria-label="Published support contact" className="space-y-2 rounded border p-4">
    <h2 className={compact ? "font-semibold" : "text-xl font-semibold"}>Support contact</h2>
    {contact.email && <p><span className="font-medium">Email: </span><a href={`mailto:${encodeURIComponent(contact.email)}`} className="underline break-words">{contact.email}</a></p>}
    {contact.phone && <p><span className="font-medium">Phone: </span><a href={`tel:${contact.phone.replace(/[ ()-]/g, "")}`} className="underline">{contact.phone}</a></p>}
    {contact.address && <p className="break-words"><span className="font-medium">Address: </span>{contact.address}</p>}
    {contact.hours && <p className="break-words"><span className="font-medium">Support hours: </span>{contact.hours}</p>}
    {compact && <Link href="/contact" className="underline">Send a support inquiry</Link>}
  </section>;
}
