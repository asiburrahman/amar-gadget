import React from "react";

interface ChevronDownProps {
  className?: string;
  size?: number;
}

export const ChevronDown = ({ className = "", size = 24 }: ChevronDownProps) => (
  <svg
    className={`h-${size} w-${size} ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6 9l6 6 6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);