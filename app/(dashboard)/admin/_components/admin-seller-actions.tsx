"use client";

import React, { useState } from "react";
import { updateSellerStatus } from "@/server/actions/admin/admin-actions";

interface AdminSellerActionsProps {
  sellerId: string;
  currentStatus: string;
}

export function AdminSellerActions({ sellerId, currentStatus }: AdminSellerActionsProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(currentStatus);

  const handleUpdateStatus = async (newStatus: "APPROVED" | "BLOCKED" | "REJECTED") => {
    setLoading(true);
    try {
      const res = await updateSellerStatus(sellerId, newStatus);
      if (res.success) {
        setStatus(newStatus);
      }
    } catch (error) {
      console.error("Failed to update seller status:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center space-x-2 shrink-0">
      {status === "APPROVED" ? (
        <button
          onClick={() => handleUpdateStatus("BLOCKED")}
          disabled={loading}
          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Updating..." : "⛔ Block / Suspend Seller"}
        </button>
      ) : status === "BLOCKED" ? (
        <button
          onClick={() => handleUpdateStatus("APPROVED")}
          disabled={loading}
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Updating..." : "✓ Unblock & Approve Seller"}
        </button>
      ) : (
        <>
          <button
            onClick={() => handleUpdateStatus("APPROVED")}
            disabled={loading}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Updating..." : "✓ Approve Seller Account"}
          </button>
          <button
            onClick={() => handleUpdateStatus("REJECTED")}
            disabled={loading}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Updating..." : "✕ Reject"}
          </button>
        </>
      )}
    </div>
  );
}
