"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { H1, P } from "@/components/ui/typography";

type TrackingData = {
  id: string;
  status: string;
  carrier: string | null;
  shipmentTrackingNumber: string | null;
  nextCursor: string | null;
  timeline: { id: string; step: string; date: string | null; carrier: string | null; shipmentTrackingNumber: string | null; done: boolean; current?: boolean }[];
};

export default function OrderTracking({ initialOrderId = "" }: { initialOrderId?: string }) {
  const [orderId, setOrderId] = useState(initialOrderId);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<TrackingData | null>(null);
  const [lookup, setLookup] = useState({ id: "", phone: "" });

  const loadMore = async () => {
    if (!orderData?.nextCursor || loading) return;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ phone: lookup.phone, cursor: orderData.nextCursor });
      const response = await fetch(`/api/orders/${encodeURIComponent(lookup.id)}?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load order history.");
      setOrderData((current) => current ? { ...data.order, timeline: [...current.timeline.map((event) => ({ ...event, current: false })), ...data.order.timeline] } : data.order);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load order history."); }
    finally { setLoading(false); }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId.trim() || !phone.trim()) {
      setError("Please enter your order ID and the phone number used at checkout.");
      return;
    }

    setLoading(true);
    setError(null);
    setOrderData(null);

    try {
      const query = new URLSearchParams({ phone: phone.trim() });
      const res = await fetch(
        `/api/orders/${encodeURIComponent(orderId.trim())}?${query.toString()}`, { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "No order matched those details.");
        return;
      }
      setOrderData(data.order as TrackingData);
      setLookup({ id: orderId.trim(), phone: phone.trim() });
    } catch {
      setError("Could not retrieve tracking details. Please verify your order number.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 md:py-16">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-10">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3">
            Order Status Lookup
          </span>
          <H1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Track Your Order
          </H1>
          <P className="mt-2 text-muted-foreground text-sm sm:text-base">
            Enter your order ID or tracking code and the phone number used at checkout.
            Status is checked when you submit this form; submit again to refresh.
          </P>
        </div>

        {/* Tracking Input Card */}
        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm max-w-2xl mx-auto mb-10">
          <form onSubmit={handleTrack} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="tracking-order" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Order ID *
                </label>
                <Input
                  id="tracking-order"
                  required
                  placeholder="Enter your order ID or tracking code"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="tracking-phone" className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Phone Number *
                </label>
                <Input
                  id="tracking-phone"
                  required
                  placeholder="Phone number used at checkout"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 text-xs font-semibold text-destructive bg-destructive/10 rounded-lg">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition"
            >
              {loading ? "Searching Tracking Status..." : "Track Package"}
            </Button>
          </form>
        </div>

        {/* Tracking Results */}
        {orderData && (
          <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-border gap-4">
              <div>
                <span className="text-xs uppercase font-bold text-muted-foreground">Order Tracking</span>
                <h3 className="text-xl font-extrabold text-foreground">#{orderData.id}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  {orderData.status || "In Transit"}
                </span>
              </div>
            </div>

            {/* Tracking Progress Bar */}
            <div className="py-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">
                Recorded Order History
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 relative">
                {orderData.timeline.map((step, idx) => (
                  <div key={step.id} className="flex flex-col items-center text-center space-y-2">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                        step.done
                          ? step.current
                            ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110"
                            : "bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {step.done ? "✓" : idx + 1}
                    </div>
                    <span className="text-xs font-bold text-foreground">{step.step}</span>
                    <span className="text-[10px] text-muted-foreground">{step.date ? new Date(step.date).toLocaleString() : "Exact transition time unavailable"}</span>
                    {step.carrier && step.shipmentTrackingNumber && <span className="text-xs">{step.carrier}: {step.shipmentTrackingNumber}</span>}
                  </div>
                ))}
              </div>
              {orderData.nextCursor && <Button type="button" variant="outline" disabled={loading} onClick={loadMore}>Load more history</Button>}
              {orderData.carrier && orderData.shipmentTrackingNumber && <p className="mt-4 text-sm">Current shipment: <strong>{orderData.carrier} — {orderData.shipmentTrackingNumber}</strong></p>}
            </div>

            <div className="pt-4 border-t border-border flex justify-between text-xs text-muted-foreground">
              <span>Need help with your shipment?</span>
              <Link href="/contact" className="text-primary font-bold hover:underline">
                Contact Customer Support &rarr;
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
