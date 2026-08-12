import React from "react";

interface MenuProps {
  className?: string;
  size?: number;
}

export const Menu = ({ className = "", size = 24 }: MenuProps) => (
  <svg
    className={`h-${size} w-${size} ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 6h18M3 12h18M3 18h18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);