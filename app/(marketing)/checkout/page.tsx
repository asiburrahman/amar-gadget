import { notFound } from "next/navigation";
import { z } from "zod";
import CheckoutForm from "@/components/checkout/checkout-form";
import { PaymentRecovery } from "@/components/checkout/payment-recovery";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const { resume } = await searchParams;
  if (resume && !z.string().uuid().safeParse(resume).success) notFound();
  return resume ? <PaymentRecovery orderId={resume} /> : <CheckoutForm />;
}
