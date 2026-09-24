"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateProductStatus } from "@/server/actions/admin/admin-actions";

interface AdminProductActionsProps {
  productId: string;
}

export function AdminProductActions({ productId }: AdminProductActionsProps) {
  const [loading, setLoading] = useState(false);
  const [statusState, setStatusState] = useState<string | null>(null);

  const handleAction = async (status: "APPROVED" | "REJECTED") => {
    setLoading(true);
    try {
      const res = await updateProductStatus(productId, status);
      if (res.success) {
        setStatusState(status);
      }
    } catch (err) {
      console.error(err);
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
