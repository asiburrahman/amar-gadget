"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createProduct, getCategories, getBrands } from "@/server/actions/product/product-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";

export default function AddProductPage() {
  const router = useRouter();
  const { user } = useAuth();

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

  const [imagePreview, setImagePreview] = useState<string | null>(null);
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

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("Image file size must be less than 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setImagePreview(result);
      setFormData((prev) => ({ ...prev, imageUrl: result }));
      setErrorMsg("");
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const sellerId = user?.id || "seller-demo-id";

      const result = await createProduct(
        {
          name: formData.name,
          description: formData.description,
          price: parseFloat(formData.price),
          discountPrice: formData.discountPrice ? parseFloat(formData.discountPrice) : undefined,
          stock: parseInt(formData.stock, 10),
          imageUrl: formData.imageUrl || undefined,
          images: formData.imageUrl ? [formData.imageUrl] : [],
          categoryId: formData.categoryId || (categories[0]?.id || ""),
          brandId: formData.brandId || undefined,
          isFeatured: false,
        },
        sellerId
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
            <label className="font-bold block mb-1">Category *</label>
            <select
              required
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
              <option value="">Select Brand (Optional)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Direct Image File Upload Section */}
        <div className="space-y-2 border-t border-border pt-3">
          <label className="font-bold block">Upload Product Image *</label>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageFileChange}
              className="block w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
            />

            {(imagePreview || formData.imageUrl) && (
              <div className="relative w-20 h-20 rounded-xl bg-white border border-border p-1 overflow-hidden shrink-0 flex items-center justify-center">
                <img
                  src={imagePreview || formData.imageUrl}
                  alt="Product preview"
                  className="w-full h-full object-contain rounded-lg"
                />
              </div>
            )}
          </div>

          <div className="pt-2">
            <span className="text-[11px] text-muted-foreground">Or paste direct Image URL:</span>
            <Input
              name="imageUrl"
              placeholder="https://..."
              value={formData.imageUrl}
              onChange={handleChange}
              className="mt-1"
            />
          </div>
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
          {loading ? "Submitting Product..." : "Submit Product For Admin Approval"}
        </Button>
      </form>
    </div>
  );
}