import { getMailTransport } from "@/lib/mail/nodemailer";
import { readApplicationOrigin, readMailSender } from "@/config/runtime";
import { newsletterMailLinks, NewsletterError, type NewsletterTokenSubject } from "@/lib/newsletter-policy";
import { newsletterSubscribeSchema } from "@/lib/validations/newsletter";

export async function sendNewsletterConfirmation(email: string, subject: NewsletterTokenSubject, requestId: string, alreadySubscribed = false) {
  const input = newsletterSubscribeSchema.parse({ email, requestId, consent: true });
  const links = newsletterMailLinks(subject, readApplicationOrigin()), from = readMailSender();
  const transport = getMailTransport();
  try {
    const result = await transport.sendMail({
      from, to: input.email, subject: alreadySubscribed ? "Amar Gadget: manage your newsletter preference" : "Amar Gadget: confirm your newsletter subscription",
      messageId: `<newsletter-${input.requestId}@${new URL(readApplicationOrigin()).hostname}>`,
      text: alreadySubscribed
        ? `An active newsletter preference was found when these instructions were prepared. To unsubscribe, open this link and select Unsubscribe:\n\n${links.unsubscribe}\n\nIf you did not request this message, you can ignore it. This message does not change your preference. The link controls your newsletter preference; do not share or forward it.`
        : `Confirm that you want Amar Gadget product news and offers by opening this link and selecting Confirm subscription:\n\n${links.confirmation}\n\nThis confirmation expires at ${subject.confirmationExpiresAt.toISOString()} (UTC). You are not subscribed until you confirm. If you did not request this message, ignore it.\n\nTo decline this request or unsubscribe, open this link and select Unsubscribe:\n\n${links.unsubscribe}\n\nThese links control your newsletter preference. Do not share or forward them.`,
    });
    if (!result.accepted?.some((recipient: unknown) => {
      const address = typeof recipient === "string" ? recipient : recipient && typeof recipient === "object" && "address" in recipient ? recipient.address : null;
      return typeof address === "string" && address.toLowerCase() === input.email;
    })) throw new NewsletterError("The mail provider did not accept this confirmation. Retry later.", 503, "NEWSLETTER_DELIVERY_REJECTED");
  } finally { transport.close(); }
}
