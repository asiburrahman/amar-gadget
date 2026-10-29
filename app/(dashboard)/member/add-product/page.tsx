"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createProduct, getCategories, getBrands } from "@/server/actions/product/product-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { ProductImagePicker, type ProductImageSelection } from "@/components/forms/product-image-picker";

export default function AddProductPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    discountPrice: "",
    stock: "10",
    categoryId: "",
    brandId: "",
  });

  const [media, setMedia] = useState<ProductImageSelection>({ keys: [], ready: false });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    async function loadData() {
      const [catRes, brandRes] = await Promise.all([getCategories(), getBrands()]);
      if (catRes.success && catRes.data) setCategories(catRes.data);
      if (brandRes.success && brandRes.data) setBrands(brandRes.data);
    }
    loadData();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !media.ready || authLoading || !user) return;
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const result = await createProduct(
        {
          name: formData.name,
          description: formData.description,
          price: parseFloat(formData.price),
          discountPrice: formData.discountPrice ? parseFloat(formData.discountPrice) : undefined,
          stock: parseInt(formData.stock, 10),
          uploadKeys: media.keys,
          images: [],
          categoryId: formData.categoryId,
          brandId: formData.brandId || undefined,
          isFeatured: false,
        }
      );

      if (result.success) {
        setSuccessMsg("✓ Product successfully submitted! Sent to Admin for approval.");
        setTimeout(() => router.push("/member/dashboard"), 2000);
      } else {
        setErrorMsg(result.error || "Failed to submit product.");
      }
    } catch {
      setErrorMsg("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <p role="status" className="p-6">Loading seller account...</p>;
  if (!user) return <p role="alert" className="p-6">Sign in to add products.</p>;
  const isApproved = user.role.toUpperCase() === "ADMIN" || user.sellerStatus === "APPROVED";
  const isBlocked = user ? user.sellerStatus === "BLOCKED" : false;

  if (user && !isApproved) {
    return (
      <div className="min-h-screen bg-background p-6 md:p-10 max-w-2xl mx-auto space-y-6">
        <div className="p-6 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive space-y-3 text-center">
          <span className="text-4xl block">⛔</span>
          <h2 className="text-xl font-extrabold">Product Creation Restricted</h2>
          <p className="text-xs text-muted-foreground">
            {isBlocked
              ? "Your seller account has been suspended or blocked by Admin. You cannot add products."
              : "Your seller account is currently pending Admin Approval. Product creation will be unlocked once approved."}
          </p>
          <div className="pt-2">
            <button
              onClick={() => router.push("/member/dashboard")}
              className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg"
            >
              Return to Seller Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl font-extrabold text-foreground">Add New Product</h1>
        <p className="text-xs text-muted-foreground">List a new smartphone, laptop, audio gadget or accessory in the Amar Gadget marketplace.</p>
      </div>

      {errorMsg && <div className="p-3 text-xs font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">{errorMsg}</div>}
      {successMsg && <div className="p-3 text-xs font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">{successMsg}</div>}

      <form onSubmit={handleSubmit} className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4 text-xs">
        <div>
          <label htmlFor="product-name" className="font-bold block mb-1">Product Title / Name *</label>
          <Input
            required
            name="name"
            id="product-name"
            placeholder="e.g. Apple iPhone 16 Pro Max 256GB"
            value={formData.name}
            onChange={handleChange}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="product-price" className="font-bold block mb-1">Price (BDT) *</label>
            <Input
              required
              type="number"
              step="0.01"
              name="price"
              id="product-price"
              placeholder="e.g. 165000"
              value={formData.price}
              onChange={handleChange}
            />
          </div>

          <div>
            <label htmlFor="product-discount" className="font-bold block mb-1">Discount Offer Price (BDT)</label>
            <Input
              type="number"
              step="0.01"
              name="discountPrice"
              id="product-discount"
              placeholder="e.g. 159000 (Optional)"
              value={formData.discountPrice}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="product-stock" className="font-bold block mb-1">Stock Quantity *</label>
            <Input
              required
              type="number"
              name="stock"
              id="product-stock"
              value={formData.stock}
              onChange={handleChange}
            />
          </div>

          <div>
            <label htmlFor="product-category" className="font-bold block mb-1">Category *</label>
            <select
              required
              name="categoryId"
              id="product-category"
              value={formData.categoryId}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-xs font-semibold"
            >
              <option value="">Select Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="product-brand" className="font-bold block mb-1">Brand</label>
            <select
              name="brandId"
              id="product-brand"
              value={formData.brandId}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-xs font-semibold"
            >
              <option value="">Select Brand (Optional)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <ProductImagePicker disabled={loading || Boolean(successMsg)} onChange={setMedia} />

        <div>
          <label htmlFor="product-description" className="font-bold block mb-1">Detailed Description</label>
          <textarea
            name="description"
            id="product-description"
            rows={4}
            placeholder="Provide official specifications, key features, and warranty details..."
            value={formData.description}
            onChange={handleChange}
            className="w-full p-3 rounded-md border border-input bg-background text-xs"
          />
        </div>

        <Button type="submit" disabled={loading || !media.ready || Boolean(successMsg)} variant="default" className="w-full h-11 font-bold text-xs">
          {loading ? "Submitting Product..." : "Submit Product For Admin Approval"}
        </Button>
      </form>
    </div>
  );
}
