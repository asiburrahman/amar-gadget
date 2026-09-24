"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistStore } from "@/stores/wishlist-store";
import { ShoppingCart } from "@/components/icons/ShoppingCart";
import { useRouter } from "next/navigation";

interface ProductDetailActionsProps {
  product: {
    id: string;
    name: string;
    price: number;
    discountPrice?: number | null;
    imageUrl?: string | null;
    stock: number;
    category?: string;
  };
}

export function ProductDetailActions({ product }: ProductDetailActionsProps) {
  const [quantity, setQuantity] = useState(1);
  const [addedNotice, setAddedNotice] = useState(false);
  const router = useRouter();

  const addItem = useCartStore((state) => state.addItem);
  const { addItem: addWishlist, isInWishlist, removeItem: removeWishlist } = useWishlistStore();

  const isWishlisted = isInWishlist(product.id);

  const handleAddToCart = () => {
    if (product.stock === 0) return;
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      discountPrice: product.discountPrice,
      imageUrl: product.imageUrl,
      stock: product.stock,
      category: product.category,
      quantity,
    });
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 2500);
  };

  const handleBuyNow = () => {
    handleAddToCart();
    router.push("/checkout");
  };

  const toggleWishlist = () => {
    if (isWishlisted) {
      removeWishlist(product.id);
    } else {
      addWishlist({
        id: product.id,
        name: product.name,
        price: product.price,
        discountPrice: product.discountPrice,
        imageUrl: product.imageUrl,
        category: product.category,
      });
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      {addedNotice && (
        <div className="p-3 text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between">
          <span>✓ Added {quantity} item(s) to your shopping cart!</span>
          <a href="/cart" className="underline font-bold">View Cart</a>
        </div>
      )}

      {/* Quantity & Stock Selector */}
      <div className="flex items-center space-x-4">
        <span className="text-xs font-semibold text-muted-foreground uppercase">Quantity:</span>
        <div className="flex items-center border border-border rounded-lg bg-background">
          <button
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1 || product.stock === 0}
            className="px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-muted rounded-l-lg transition"
          >
            -
          </button>
          <span className="px-4 text-sm font-extrabold text-foreground">{quantity}</span>
          <button
            onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
            disabled={quantity >= product.stock || product.stock === 0}
            className="px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-muted rounded-r-lg transition"
          >
            +
          </button>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleAddToCart}
          disabled={product.stock === 0}
          variant="default"
          size="lg"
          className="flex-1 font-bold text-sm h-12"
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          {product.stock === 0 ? "Out of Stock" : "Add to Cart"}
        </Button>

        <Button
          onClick={handleBuyNow}
          disabled={product.stock === 0}
          variant="secondary"
          size="lg"
          className="flex-1 font-bold text-sm h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Buy Now
        </Button>

        <Button
          onClick={toggleWishlist}
          variant="outline"
          size="lg"
          className={`h-12 px-4 ${isWishlisted ? "text-red-500 border-red-500 bg-red-50 dark:bg-red-950/20" : ""}`}
        >
          {isWishlisted ? "♥ Saved" : "♡ Wishlist"}
        </Button>
      </div>
    </div>
  );
}
