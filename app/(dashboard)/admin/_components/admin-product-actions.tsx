"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateProductStatus } from "@/server/actions/admin/admin-actions";
import { useRouter } from "next/navigation";

interface AdminProductActionsProps {
  productId: string;
  version: number;
}

export function AdminProductActions({ productId, version }: AdminProductActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusState, setStatusState] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleAction = async (status: "APPROVED" | "REJECTED") => {
    setLoading(true);
    setError("");
    try {
      const res = await updateProductStatus(productId, status, version);
      if (res.success) {
        setStatusState(status);
        router.refresh();
      } else {
        setError(res.error || "The moderation decision was not confirmed. Reload this review.");
      }
    } catch {
      setError("The moderation decision was not confirmed. Reload this review.");
    } finally {
      setLoading(false);
    }
  };

  if (statusState === "APPROVED") {
    return <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded">✓ APPROVED</span>;
  }

  if (statusState === "REJECTED") {
    return <span className="text-xs font-bold text-destructive bg-destructive/10 px-3 py-1.5 rounded">✕ REJECTED</span>;
  }

  return (
    <div className="flex gap-2">
      {error && <div><p role="alert">{error}</p><button type="button" onClick={() => router.refresh()}>Reload saved review</button></div>}
      <Button
        onClick={() => handleAction("APPROVED")}
        disabled={loading}
        size="sm"
        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-8"
      >
        Approve
      </Button>

      <Button
        onClick={() => handleAction("REJECTED")}
        disabled={loading}
        variant="destructive"
        size="sm"
        className="text-xs font-bold h-8"
      >
        Reject
      </Button>
    </div>
  );
}
