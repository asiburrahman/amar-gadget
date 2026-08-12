import React from "react";

interface ShoppingCartProps {
  className?: string;
  size?: number;
}

export const ShoppingCart = ({ className = "", size = 24 }: ShoppingCartProps) => (
  <svg
    className={`h-${size} w-${size} ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3 3h5l.392 2H8a2 2 0 012 2v2.08A8.007 8.007 0 0011 18h2a2 2 0 002-2V7a2 2 0 114 0v9a2 2 0 01-2 2h-1.33l-.244-1H7l-.392-2H3a2 2 0 01-2-2V5c0-1.1.9-2 2-2zM15 7H9v2h6V7zm3 10a2 2 0 11-4 0 2 2 0 014 0z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);