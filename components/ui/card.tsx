import React from "react";

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  skeleton?: boolean;
  hoverable?: boolean;
  bordered?: boolean;
  padded?: boolean;
  onClick?: () => void;
}

export const Card = ({
  children,
  className = "",
  skeleton = false,
  hoverable = true,
  bordered = true,
  padded = true,
  onClick,
}: CardProps) => {
  const baseClasses = `
    rounded-xl
    bg-background
    transition-all duration-200
    ${bordered ? "border border-border" : ""}
    ${padded ? "p-6" : "p-4"}
    ${hoverable
      ? "hover:bg-muted/50 hover:shadow-md"
      : ""
    }
  `;

  if (skeleton) {
    return (
      <div className={`${baseClasses} ${className} animate-pulse`}>
        {/* Skeleton content - placeholder for children */}
        <div className="h-4 w-full mb-2 rounded"></div>
        <div className="h-4 w-full mb-2 rounded"></div>
        <div className="h-4 w-full mb-2 rounded"></div>
      </div>
    );
  }

  return (
    <div
      className={`${baseClasses} ${className}`}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      {children}
    </div>
  );
};