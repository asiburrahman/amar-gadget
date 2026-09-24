import React from "react";

interface UserProps {
  className?: string;
  size?: number;
}

export const User = ({ className = "", size }: UserProps) => (
  <svg
    width={size}
    height={size}
    className={className || "w-4 h-4"}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
  </svg>
);