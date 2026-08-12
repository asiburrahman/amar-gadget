import React from "react";

interface StarProps {
  className?: string;
  size?: number;
  filled?: boolean;
}

export const Star = ({ className = "", size = 24, filled = false }: StarProps) => (
  <svg
    className={`h-${size} w-${size} ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22l-6.09-1.91L2 18.1l5-4.86L8.91 8.26 12 2z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);