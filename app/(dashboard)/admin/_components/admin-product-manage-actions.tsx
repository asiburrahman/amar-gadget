"use client";

import React, { useState } from "react";
import { updateProductStatus, adminUpdateProductPrice, adminDeleteProduct } from "@/server/actions/admin/admin-actions";

interface AdminProductManageActionsProps {
  productId: string;
  currentPrice: number;
  currentDiscountPrice?: number | null;
  currentStatus: string;
}

export function AdminProductManageActions({
  productId,
  currentPrice,
  currentDiscountPrice,
  currentStatus,
}: AdminProductManageActionsProps) {
  const [loading, setLoading] = useState(false);
  const [showEditPrice, setShowEditPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(currentPrice.toString());
  const [discountPriceInput, setDiscountPriceInput] = useState(
    currentDiscountPrice ? currentDiscountPrice.toString() : ""
  );

  const handleUpdateStatus = async (newStatus: "APPROVED" | "REJECTED") => {
    setLoading(true);
    try {
      await updateProductStatus(productId, newStatus);
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    const newPrice = parseFloat(priceInput);
    if (isNaN(newPrice) || newPrice <= 0) return;

    const newDiscount = discountPriceInput.trim() !== "" ? parseFloat(discountPriceInput) : null;

    setLoading(true);
    try {
      const res = await adminUpdateProductPrice(productId, newPrice, newDiscount);
      if (res.success) {
        setShowEditPrice(false);
      }
    } catch (error) {
      console.error("Failed to update price:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete/remove this product permanently?")) return;
    setLoading(true);
    try {
      await adminDeleteProduct(productId);
    } catch (error) {
      console.error("Failed to delete product:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
        {currentStatus === "PENDING_APPROVAL" && (
          <button
            onClick={() => handleUpdateStatus("APPROVED")}
            disabled={loading}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-md transition cursor-pointer"
          >
            ✓ Approve
          </button>
        )}

        {currentStatus === "APPROVED" && (
          <button
            onClick={() => handleUpdateStatus("REJECTED")}
            disabled={loading}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-md transition cursor-pointer"
          >
            ✕ Reject
          </button>
        )}

        <button
          onClick={() => setShowEditPrice(!showEditPrice)}
          disabled={loading}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-md transition cursor-pointer"
        >
          ✏️ Edit Price
        </button>

        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-md transition cursor-pointer"
        >
          🗑️ Delete
        </button>
      </div>

      {showEditPrice && (
        <form onSubmit={handleSavePrice} className="p-3 bg-muted/40 border border-border rounded-lg space-y-2 text-xs animate-in fade-in">
          <div className="flex gap-2">
            <div>
              <label className="block text-[10px] font-bold text-muted-foreground uppercase">Price (৳)</label>
              <input
                type="number"
                step="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-24 p-1.5 border border-border rounded bg-background text-xs font-bold"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted-foreground uppercase">Discount Price</label>
              <input
                type="number"
                step="0.01"
                value={discountPriceInput}
                placeholder="Optional"
                onChange={(e) => setDiscountPriceInput(e.target.value)}
                className="w-24 p-1.5 border border-border rounded bg-background text-xs font-bold"
              />
            </div>
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setShowEditPrice(false)}
              className="px-2 py-1 text-slate-500 hover:text-foreground text-[11px] font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-1 bg-primary text-primary-foreground text-[11px] font-bold rounded"
            >
              Save Price
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
