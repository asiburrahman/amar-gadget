import React from "react";

interface XProps {
  className?: string;
  size?: number;
}

export const X = ({ className = "", size }: XProps) => (
  <svg
    width={size}
    height={size}
    className={className || "w-4 h-4"}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M18 6L6 18M6 6l12 12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);