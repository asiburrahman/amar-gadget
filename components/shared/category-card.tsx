import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CategoryCardProps {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  productCount?: number;
  onClick?: () => void;
  className?: string;
}

export const CategoryCard = ({
  id,
  name,
  imageUrl,
  description,
  productCount,
  onClick,
  className = "",
}: CategoryCardProps) => {
  return (
    <Card
      className={`group ${className}`}
      hoverable
      bordered
      padded
      onClick={onClick}
    >
      <div className="space-y-4">
        {/* Category Image */}
        <div className="relative aspect-w-4 aspect-h-3 mb-4" style={{ position: 'relative' }}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={name}
              fill
              className="object-cover rounded-lg"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted rounded-lg">
              <span className="text-muted-foreground text-sm">{name[0]}</span>
            </div>
          )}
        </div>

        {/* Category Info */}
        <div className="text-center space-y-2">
          <Link href={`/categories/${id}`} className="group">
            <h3 className="text-lg font-semibold text-foreground group-hover:text-primary">
              {name}
            </h3>
          </Link>

          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}

          {productCount !== undefined && (
            <Badge variant="outline" className="mt-2">
              {productCount} products
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
};