import React from "react";

interface BadgeProps {
  variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" | "ghost";
  children: React.ReactNode;
  className?: string;
}

export const Badge = ({
  variant = "default",
  children,
  className = "",
}: BadgeProps) => {
  // Variant configurations
  const variantConfig: Record<
    BadgeProps["variant"],
    { bg: string; text: string; border: string; hoverBg?: string; hoverText?: string }
  > = {
    default: {
      bg: "bg-primary",
      text: "text-primary-foreground",
      border: "border-transparent",
    },
    secondary: {
      bg: "bg-secondary",
      text: "text-secondary-foreground",
      border: "border-transparent",
    },
    success: {
      bg: "bg-success",
      text: "text-success-foreground",
      border: "border-transparent",
    },
    warning: {
      bg: "bg-warning",
      text: "text-warning-foreground",
      border: "border-transparent",
    },
    destructive: {
      bg: "bg-destructive",
      text: "text-destructive-foreground",
      border: "border-transparent",
    },
    outline: {
      bg: "bg-transparent",
      text: "text-primary",
      border: "border-border",
      hoverBg: "bg-muted",
      hoverText: "text-primary",
    },
    ghost: {
      bg: "bg-transparent",
      text: "text-muted-foreground",
      border: "border-transparent",
      hoverBg: "bg-muted",
      hoverText: "text-muted-foreground",
    },
  };

  const config = variantConfig[variant];

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium
        ${config.bg} ${config.text} ${config.border}
        ${variant === "outline" || variant === "ghost"
          ? `hover:${config.hoverBg} hover:${config.hoverText}`
          : ""
        }
        transition-all duration-200
        ${className}
      `}
    >
      {children}
    </span>
  );
};