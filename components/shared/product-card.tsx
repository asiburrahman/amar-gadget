"use client";

import React from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatter";
import Link from "next/link";
import { ShoppingCart } from "@/components/icons/ShoppingCart";

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  imageUrl?: string;
  category?: string;
  rating?: number;
  onAddToCart?: (productId: string) => void;
  onAddToWishlist?: (productId: string) => void;
  className?: string;
}

export const ProductCard = ({
  id,
  name,
  description,
  price,
  stock,
  imageUrl,
  category,
  onAddToCart,
  onAddToWishlist,
  className = "",
}: ProductCardProps) => {
  return (
    <Card
      className={`group overflow-hidden rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between ${className}`}
    >
      <div className="space-y-3 p-4">
        {/* Product Image Container */}
        <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-muted/30">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs font-medium">
              No Image Available
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
            {stock === 0 ? (
              <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                Out of Stock
              </Badge>
            ) : stock < 5 ? (
              <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                Only {stock} Left
              </Badge>
            ) : null}
          </div>

          {category && (
            <Badge variant="outline" className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm text-[10px] font-semibold z-10">
              {category}
            </Badge>
          )}
        </div>

        {/* Product Info */}
        <div className="space-y-1.5">
          <Link href={`/products/${id}`} className="block group-hover:text-primary transition-colors">
            <h3 className="font-semibold text-base text-foreground line-clamp-1 leading-snug">
              {name}
            </h3>
          </Link>

          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Footer Price & Actions */}
      <div className="p-4 pt-0 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-extrabold text-foreground tracking-tight">
            {formatCurrency(price)}
          </span>
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            In Stock
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => onAddToCart && onAddToCart(id)}
            disabled={stock === 0}
            className="flex-1 h-9 text-xs font-semibold"
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
            {stock === 0 ? "Out of Stock" : "Add to Cart"}
          </Button>

          {onAddToWishlist && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddToWishlist(id)}
              className="h-9 px-2 text-xs"
            >
              ♥
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};