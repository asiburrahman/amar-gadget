import React, { useRef, useState } from "react";
import { ProductCard } from "./product-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ProductCarouselProps {
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
  /**
   * Number of products to visible at once
   * @default 3
   */
  visibleCount?: number;
  /**
   * Scroll amount when clicking arrows (in pixels)
   * @default 200
   */
  scrollAmount?: number;
}

export const ProductCarousel = ({
  products,
  loading = false,
  onAddToCart,
  onAddToWishlist,
  className = "",
  visibleCount = 3,
  scrollAmount = 200,
}: ProductCarouselProps) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [isScrollingLeft, setIsScrollingLeft] = useState(false);
  const [isScrollingRight, setIsScrollingRight] = useState(false);

  // Update scroll button states based on scroll position
  React.useEffect(() => {
    if (!carouselRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
    setIsScrollingLeft(scrollLeft > 0);
    setIsScrollingRight(scrollLeft + clientWidth < scrollWidth);
  }, []); // We can run this on scroll and resize, but for simplicity we'll run on mount and update via event listeners
  // Actually, we need to update on scroll and resize. Let's add event listeners.
  // We'll do it in a useEffect with cleanup.

  // We'll move the update logic to a function and call it on scroll and resize.
  const updateScrollButtons = () => {
    if (!carouselRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
    setIsScrollingLeft(scrollLeft > 0);
    setIsScrollingRight(scrollLeft + clientWidth < scrollWidth);
  };

  React.useEffect(() => {
    const handleScroll = () => requestAnimationFrame(updateScrollButtons);
    const handleResize = () => requestAnimationFrame(updateScrollButtons);

    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener("scroll", handleScroll);
      window.addEventListener("resize", handleResize);
      // Initial update
      updateScrollButtons();
    }

    return () => {
      if (carousel) {
        carousel.removeEventListener("scroll", handleScroll);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []); // Empty deps because we define the functions inside and they don't change

  const scrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -scrollAmount, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  // If loading, show skeleton loaders
  if (loading) {
    const skeletonCount = Math.min(products.length || visibleCount, visibleCount);
    return (
      <div className={`${className} relative`}>
        <Button
          variant="outline"
          size="sm"
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10"
          onClick={scrollLeft}
          disabled={!isScrollingLeft}
        >
          <svg className="h-4 w-4" stroke="currentColor" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10"
          onClick={scrollRight}
          disabled={!isScrollingRight}
        >
          <svg className="h-4 w-4" stroke="currentColor" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
        <div
          ref={carouselRef}
          className="flex-1 overflow-x-hidden whitespace-nowrap px-4"
        >
          <div className="inline-flex space-x-4">
            {Array.from({ length: skeletonCount }).map((_, index) => (
              <div key={index} className="flex-shrink-0 w-[200px]">
                <Skeleton type="rect" width="100%" height={200} className="mb-4" />
                <Skeleton type="text" width="100%" height={16} count={3} className="space-y-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If no products, show empty state
  if (products.length === 0) {
    return (
      <div className={`${className} text-center py-12`}>
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-sm">���������������������📦</span>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No products found</h3>
        <p className="text-muted-foreground">It seems there are no products matching your criteria.</p>
      </div>
    );
  }

  return (
    <div className={`${className} relative`}>
      <Button
        variant="outline"
        size="sm"
        className="absolute left-2 top-1/2 -translate-y-1/2 z-10"
        onClick={scrollLeft}
        disabled={!isScrollingLeft}
      >
        <svg className="h-4 w-4" stroke="currentColor" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10"
        onClick={scrollRight}
        disabled={!isScrollingRight}
      >
        <svg className="h-4 w-4" stroke="currentColor" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Button>
      <div
        ref={carouselRef}
        className="flex-1 overflow-x-hidden whitespace-nowrap px-4 scrollbar-thin scrollbar-thumb-muted-scrollbar-track"
      >
        <div className="inline-flex space-x-4">
          {products.map((product) => (
            <div key={product.id} className="flex-shrink-0 w-[200px]">
              <ProductCard
                {...product}
                onAddToCart={onAddToCart}
                onAddToWishlist={onAddToWishlist}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};