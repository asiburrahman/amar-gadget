import React from "react";

interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  required?: boolean;
  autoComplete?: string;
}

export const Input = ({
  type = "text",
  placeholder = "",
  value = "",
  onChange,
  disabled = false,
  error = false,
  className = "",
  icon,
  iconPosition = "left",
  required = false,
  autoComplete = "off",
}: InputProps) => {
  return (
    <div className="relative w-full">
      {icon && iconPosition === "left" && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-muted-foreground">
          {icon}
        </div>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        className={`w-full rounded-lg border border-border bg-background
          px-4 py-3 text-sm
          ${icon ? "pl-10" : "pl-4"}
          ${iconPosition === "right" && "pr-10"}
          focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
          ${error ? "border-destructive" : ""}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          transition-all duration-200
          ${className}
        `}
      />
      {icon && iconPosition === "right" && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-muted-foreground">
          {icon}
        </div>
      )}
    </div>
  );
};