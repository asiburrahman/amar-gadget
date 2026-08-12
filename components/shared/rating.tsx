import React from "react";
import { Star } from "@/components/icons/Star";

interface RatingProps {
  rating: number; // 0 to 5
  className?: string;
  size?: number;
}

export const Rating = ({ rating, className = "", size = 20 }: RatingProps) => {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return (
    <div className={`${className} flex items-center space-x-1`}>
      {/* Full stars */}
      {[...Array(fullStars)].map((_, i) => (
        <Star key={i} size={size} filled />
      ))}
      {/* Half star if needed */}
      {hasHalfStar && (
        <Star key="half" size={size} filled={true} />
      )}
      {/* Empty stars */}
      {[...Array(emptyStars)].map((_, i) => (
        <Star key={`empty${i}`} size={size} filled={false} />
      ))}
    </div>
  );
};