import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/stripe";

export async function POST(req: Request) {
  try {
    const { items, orderId } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, message: "Cart items required for Stripe Checkout." }, { status: 400 });
    }

    const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const lineItems = items.map((item: any) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          images: item.imageUrl ? [item.imageUrl] : [],
        },
        unit_amount: Math.max(100, Math.round((item.discountPrice || item.price) * 100)),
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${origin}/order-success/${orderId || "demo"}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout`,
      metadata: {
        orderId: orderId || "",
      },
    });

    return NextResponse.json({ success: true, url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to create Stripe Checkout session" },
      { status: 500 }
    );
  }
}