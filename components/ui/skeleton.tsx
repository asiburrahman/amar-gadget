import React from "react";

interface SkeletonProps {
  /**
   * The type of skeleton to render.
   * @default "text"
   */
  type?: "text" | "rect" | "circle" | "image";
  /**
   * The width of the skeleton.
   * @default "full"
   */
  width?: string | number;
  /**
   * The height of the skeleton.
   * @default "16"
   */
  height?: string | number;
  /**
   * The number of lines for text type (only applicable when type="text").
   * @default 3
   */
  count?: number;
  /**
   * Additional className for custom styling.
   */
  className?: string;
}

export const Skeleton = ({
  type = "text",
  width = "full",
  height = "16",
  count = 3,
  className = "",
}: SkeletonProps) => {
  // Convert width and height to string if they are numbers
  const w = typeof width === "number" ? `${width}px` : width;
  const h = typeof height === "number" ? `${height}px` : height;

  // Base classes for the skeleton
  const baseClasses = `
    bg-muted
    animate-pulse
    rounded
    ${className}
  `;

  if (type === "text") {
    return (
      <div className={`${baseClasses} w-${w} h-${h}`}>
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className={`h-4 w-full mb-2 rounded
              ${index === count - 1 ? "w-2/3" : "w-full"}
            `}
          />
        ))}
      </div>
    );
  }

  if (type === "rect") {
    return (
      <div className={`${baseClasses} w-${w} h-${h}`} />
    );
  }

  if (type === "circle") {
    return (
      <div className={`${baseClasses} w-${w} h-${h} rounded-full`} />
    );
  }

  if (type === "image") {
    return (
      <div className={`${baseClasses} w-${w} h-${h} rounded-lg`} />
    );
  }

  // Fallback to rect
  return (
    <div className={`${baseClasses} w-${w} h-${h}`} />
  );
};