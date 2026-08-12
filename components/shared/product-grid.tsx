"use client";

import React from "react";
import { ProductCard } from "./product-card";
import { Skeleton } from "@/components/ui/skeleton";

interface ProductGridProps {
  products: Array<{
    id: string;
    name: string;
    description?: string;
    price: number;
    stock: number;
    imageUrl?: string;
    category?: string;
    rating?: number;
  }>;
  loading?: boolean;
  onAddToCart?: (productId: string) => void;
  onAddToWishlist?: (productId: string) => void;
  className?: string;
}

export const ProductGrid = ({
  products,
  loading = false,
  onAddToCart,
  onAddToWishlist,
  className = "",
}: ProductGridProps) => {
  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 ${className}`}>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
            <Skeleton type="rect" width="100%" height={200} className="rounded-lg" />
            <Skeleton type="text" width="80%" height={20} />
            <Skeleton type="text" width="40%" height={16} />
            <Skeleton type="rect" width="100%" height={36} className="rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-16 px-4 bg-muted/20 rounded-2xl border border-dashed">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold">
          📦
        </div>
        <h3 className="text-xl font-bold text-foreground mb-1">No products available</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          We couldn't find any products matching your selection. Check back soon for new arrivals!
        </p>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 ${className}`}>
      {products.map((product) => (
        <ProductCard
          key={product.id}
          {...product}
          onAddToCart={onAddToCart}
          onAddToWishlist={onAddToWishlist}
        />
      ))}
    </div>
  );
};