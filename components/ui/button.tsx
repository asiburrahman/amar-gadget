import React from "react";

interface ButtonProps {
  variant: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
  size: "sm" | "md" | "lg";
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  type?: "button" | "submit" | "reset";
}

export const Button = ({
  variant = "default",
  size = "md",
  children,
  disabled = false,
  loading = false,
  onClick,
  className = "",
  icon,
  iconPosition = "left",
  type = "button",
}: ButtonProps) => {
  // Variant configurations
  type VariantConfig = Record<ButtonProps["variant"], { bg: string; text: string; border: string; hoverBg: string; hoverText: string }>;
  const variantConfig: VariantConfig = {
    default: {
      bg: "bg-primary",
      text: "text-primary-foreground",
      border: "border-transparent",
      hoverBg: "bg-primary/90",
      hoverText: "text-primary-foreground",
    },
    secondary: {
      bg: "bg-secondary",
      text: "text-secondary-foreground",
      border: "border-transparent",
      hoverBg: "bg-secondary/90",
      hoverText: "text-secondary-foreground",
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
    destructive: {
      bg: "bg-destructive",
      text: "text-destructive-foreground",
      border: "border-transparent",
      hoverBg: "bg-destructive/90",
      hoverText: "text-destructive-foreground",
    },
    link: {
      bg: "bg-transparent",
      text: "text-primary underline-offset-4 hover:underline",
      border: "border-transparent",
      hoverBg: "bg-transparent",
      hoverText: "text-primary underline-offset-4 hover:underline",
    },
  };

  const config = variantConfig[variant];

  // Size configurations
  const sizeConfig: Record<"sm" | "md" | "lg", { height: string; px: string; text: string; icon: string }> = {
    sm: {
      height: "h-9",
      px: "px-3",
      text: "text-sm",
      icon: "h-4 w-4",
    },
    md: {
      height: "h-11",
      px: "px-4",
      text: "text-base",
      icon: "h-5 w-5",
    },
    lg: {
      height: "h-12",
      px: "px-6",
      text: "text-lg",
      icon: "h-6 w-6",
    },
  };

  const sizeProps = sizeConfig[size];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={!disabled && !loading ? onClick : undefined}
      className={`${config.bg} ${config.text} ${config.border}
        ${sizeProps.height} ${sizeProps.px} ${sizeProps.text}
        font-medium rounded-lg
        hover:${config.hoverBg} hover:${config.hoverText}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-200
        flex items-center justify-center gap-2
        ${className}
      `}
    >
      {loading ? (
        <svg
          className={`${sizeProps.icon} animate-spin`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            d="M3.636 3.636l1.414-1.414M16.764 16.764l1.414-1.414M5.196 5.196l-1.414 1.414M18.236 5.196l-1.414 1.414M7.343 7.343l1.414-1.414M13.137 13.137l1.414-1.414M10.293 10.293l-1.414 1.414M15.707 15.707l-1.414 1.414"
          />
        </svg>
      ) : null}
      {icon && iconPosition === "left" && (
        <span className={sizeProps.icon}>{icon}</span>
      )}
      <span className="flex-1">{children}</span>
      {icon && iconPosition === "right" && (
        <span className={sizeProps.icon}>{icon}</span>
      )}
    </button>
  );
};