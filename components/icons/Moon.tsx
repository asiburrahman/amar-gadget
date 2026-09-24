import React from "react";

interface MoonProps {
  className?: string;
  size?: number;
}

export const Moon = ({ className = "", size }: MoonProps) => (
  <svg
    width={size}
    height={size}
    className={className || "w-4 h-4"}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);