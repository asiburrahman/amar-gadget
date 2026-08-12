import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BrandCardProps {
  id: string;
  name: string;
  logoUrl?: string;
  description?: string;
  productCount?: number;
  onClick?: () => void;
  className?: string;
}

export const BrandCard = ({
  id,
  name,
  logoUrl,
  description,
  productCount,
  onClick,
  className = "",
}: BrandCardProps) => {
  return (
    <Card
      className={`group ${className}`}
      hoverable
      bordered
      padded
      onClick={onClick}
    >
      <div className="space-y-4">
        {/* Brand Logo */}
        <div className="relative aspect-w-1 aspect-h-1 mb-4" style={{ position: 'relative' }}>
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`${name} logo`}
              fill
              className="object-contain rounded-lg"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted rounded-lg">
              <span className="text-muted-foreground text-sm">{name[0]}</span>
            </div>
          )}
        </div>

        {/* Brand Info */}
        <div className="text-center space-y-2">
          <Link href={`/brands/${id}`} className="group">
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