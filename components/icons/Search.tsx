import React from "react";

interface SearchProps {
  className?: string;
  size?: number;
}

export const Search = ({ className = "", size }: SearchProps) => (
  <svg
    width={size}
    height={size}
    className={className || "w-4 h-4"}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);