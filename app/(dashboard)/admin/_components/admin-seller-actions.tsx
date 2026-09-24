"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSellerStatus } from "@/server/actions/admin/admin-actions";

interface AdminSellerActionsProps {
  sellerId: string;
  currentStatus: string;
}

export function AdminSellerActions({ sellerId, currentStatus }: AdminSellerActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [message, setMessage] = useState("");

  const handleUpdateStatus = async (newStatus: "APPROVED" | "BLOCKED" | "REJECTED") => {
    setLoading(true);
    setMessage("");
    try {
      // 1. Primary: API Call for instant HTTP update
      const apiRes = await fetch("/api/admin/sellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId, sellerStatus: newStatus }),
      });

      const apiData = await apiRes.json();

      if (apiRes.ok && apiData.success) {
        setStatus(newStatus);
        setMessage(`✓ Status updated to ${newStatus}`);
        router.refresh();
        window.location.reload();
        return;
      }

      // 2. Fallback: Server Action
      const res = await updateSellerStatus(sellerId, newStatus);
      if (res.success) {
        setStatus(newStatus);
        setMessage(`✓ Status updated to ${newStatus}`);
        router.refresh();
        window.location.reload();
      } else {
        setMessage(`❌ Error: ${res.error || apiData.message || "Failed to update status"}`);
      }
    } catch (error: any) {
      console.error("Failed to update seller status:", error);
      setMessage(`❌ Exception: ${error?.message || "Failed to update"}`);
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(""), 3000);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center space-x-2">
        {status === "APPROVED" ? (
          <button
            onClick={() => handleUpdateStatus("BLOCKED")}
            disabled={loading}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {loading ? "Updating..." : "⛔ Block / Suspend Seller"}
          </button>
        ) : status === "BLOCKED" ? (
          <button
            onClick={() => handleUpdateStatus("APPROVED")}
            disabled={loading}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {loading ? "Updating..." : "✓ Unblock & Approve Seller"}
          </button>
        ) : (
          <>
            <button
              onClick={() => handleUpdateStatus("APPROVED")}
              disabled={loading}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {loading ? "Updating..." : "✓ Approve Seller Account"}
            </button>
            <button
              onClick={() => handleUpdateStatus("REJECTED")}
              disabled={loading}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {loading ? "Updating..." : "✕ Reject"}
            </button>
          </>
        )}
      </div>

      {message && (
        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 animate-in fade-in">
          {message}
        </span>
      )}
    </div>
  );
}

