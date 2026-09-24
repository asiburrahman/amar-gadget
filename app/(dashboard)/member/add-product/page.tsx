"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createProduct, getCategories, getBrands } from "@/server/actions/product/product-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AddProductPage() {
  const router = useRouter();

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    discountPrice: "",
    stock: "10",
    imageUrl: "",
    categoryId: "",
    brandId: "",
  });

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
          imageUrl: formData.imageUrl || undefined,
          images: formData.imageUrl ? [formData.imageUrl] : [],
          categoryId: formData.categoryId || (categories[0]?.id || "default-cat"),
          brandId: formData.brandId || undefined,
          isFeatured: false,
        },
        "vendor-demo-id"
      );

      if (result.success) {
        setSuccessMsg("✓ Product successfully submitted! Sent to Admin for approval.");
        setTimeout(() => router.push("/member/dashboard"), 2000);
      } else {
        setErrorMsg(result.error || "Failed to submit product.");
      }
    } catch (err: any) {
      setErrorMsg("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

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
          <label className="font-bold block mb-1">Product Title / Name *</label>
          <Input
            required
            name="name"
            placeholder="e.g. Apple iPhone 16 Pro Max 256GB"
            value={formData.name}
            onChange={handleChange}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="font-bold block mb-1">Price (BDT) *</label>
            <Input
              required
              type="number"
              step="0.01"
              name="price"
              placeholder="e.g. 165000"
              value={formData.price}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="font-bold block mb-1">Discount Offer Price (BDT)</label>
            <Input
              type="number"
              step="0.01"
              name="discountPrice"
              placeholder="e.g. 159000 (Optional)"
              value={formData.discountPrice}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="font-bold block mb-1">Stock Quantity *</label>
            <Input
              required
              type="number"
              name="stock"
              value={formData.stock}
              onChange={handleChange}
            />
          </div>

          <div>
            <label className="font-bold block mb-1">Category</label>
            <select
              name="categoryId"
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
            <label className="font-bold block mb-1">Brand</label>
            <select
              name="brandId"
              value={formData.brandId}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-xs font-semibold"
            >
              <option value="">Select Brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="font-bold block mb-1">Product Image URL</label>
          <Input
            name="imageUrl"
            placeholder="e.g. https://images.unsplash.com/photo-..."
            value={formData.imageUrl}
            onChange={handleChange}
          />
        </div>

        <div>
          <label className="font-bold block mb-1">Detailed Description</label>
          <textarea
            name="description"
            rows={4}
            placeholder="Provide official specifications, key features, and warranty details..."
            value={formData.description}
            onChange={handleChange}
            className="w-full p-3 rounded-md border border-input bg-background text-xs"
          />
        </div>

        <Button type="submit" disabled={loading} variant="default" className="w-full h-11 font-bold text-xs">
          {loading ? "Submitting Product..." : "Submit Product For Review"}
        </Button>
      </form>
    </div>
  );
}