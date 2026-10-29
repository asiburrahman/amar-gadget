"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateProductStatus, adminUpdateProductPrice, adminDeleteProduct } from "@/server/actions/admin/admin-actions";
import { productPriceUpdateSchema, MAX_PRODUCT_PRICE } from "@/lib/validations/product";

type Props = { productId: string; currentPrice: number; currentDiscountPrice?: number | null; currentStatus: string };
export function AdminProductManageActions({ productId, currentPrice, currentDiscountPrice, currentStatus }: Props) {
  const router = useRouter();
  const priceId = useId(), discountId = useId();
  const [loading, setLoading] = useState(false);
  const [showEditPrice, setShowEditPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(currentPrice));
  const [discountInput, setDiscountInput] = useState(currentDiscountPrice == null ? "" : String(currentDiscountPrice));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const begin = () => { setLoading(true); setError(""); setMessage(""); };
  const changeStatus = async (status: "APPROVED" | "REJECTED") => {
    if (loading) return; begin();
    try {
      const result = await updateProductStatus(productId, status);
      if (!result.success) { setError(result.error ?? "Unable to change product status."); return; }
      setMessage(`Product ${status.toLowerCase()}.`); router.refresh();
    } catch { setError("Unable to change product status. Try again."); }
    finally { setLoading(false); }
  };
  const savePrice = async (event: FormEvent) => {
    event.preventDefault(); if (loading) return;
    setError(""); setMessage("");
    const parsed = productPriceUpdateSchema.safeParse({ productId, price: Number(priceInput), discountPrice: discountInput.trim() ? Number(discountInput) : null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the prices."); return; }
    begin();
    try {
      const result = await adminUpdateProductPrice(productId, parsed.data.price, parsed.data.discountPrice);
      if (!result.success || !result.data) { setError(result.error ?? "Unable to save product price."); return; }
      setPriceInput(String(result.data.price)); setDiscountInput(result.data.discountPrice == null ? "" : String(result.data.discountPrice));
      setShowEditPrice(false); setMessage("Price saved."); router.refresh();
    } catch { setError("Unable to save product price. Try again."); }
    finally { setLoading(false); }
  };
  const remove = async () => {
    if (loading || !window.confirm("Permanently delete this product? Products referenced by other records cannot be deleted.")) return;
    begin();
    try {
      const result = await adminDeleteProduct(productId);
      if (!result.success) { setError(result.error ?? "Unable to delete product."); return; }
      setMessage("Product deleted."); router.refresh();
    } catch { setError("Unable to delete product. Try again."); }
    finally { setLoading(false); }
  };
  return <div className="flex flex-col gap-2 shrink-0">
    <div className="flex flex-wrap gap-2">
      {currentStatus !== "APPROVED" && <button type="button" disabled={loading} onClick={() => void changeStatus("APPROVED")} className="px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-bold">Approve</button>}
      {currentStatus !== "REJECTED" && <button type="button" disabled={loading} onClick={() => void changeStatus("REJECTED")} className="px-3 py-1 rounded-md bg-amber-600 text-white text-xs font-bold">Reject</button>}
      <button type="button" disabled={loading} onClick={() => setShowEditPrice(!showEditPrice)} className="px-3 py-1 rounded-md bg-slate-800 text-white text-xs font-bold">Edit Price</button>
      <button type="button" disabled={loading} onClick={() => void remove()} className="px-3 py-1 rounded-md bg-red-600 text-white text-xs font-bold">Delete</button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {message && <p role="status" className="text-xs">{message}</p>}
    {showEditPrice && <form onSubmit={savePrice} aria-label="Edit product price" className="p-3 bg-muted/40 border border-border rounded-lg space-y-2 text-xs">
      <fieldset disabled={loading} className="flex flex-wrap gap-2">
        <div><label htmlFor={priceId} className="block font-bold">Price (BDT)</label><input id={priceId} type="number" required min={0.01} max={MAX_PRODUCT_PRICE} step="0.01" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} className="w-28 p-2 border rounded" /></div>
        <div><label htmlFor={discountId} className="block font-bold">Discount Price</label><input id={discountId} type="number" min={0.01} max={MAX_PRODUCT_PRICE} step="0.01" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} className="w-28 p-2 border rounded" /></div>
        <button type="button" onClick={() => setShowEditPrice(false)}>Cancel</button><button type="submit">{loading ? "Saving..." : "Save Price"}</button>
      </fieldset>
    </form>}
  </div>;
}
