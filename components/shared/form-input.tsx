import React, { useId } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const FormInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const defaultId = useId();
    const inputId = id || defaultId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const describedBy = [
      error ? errorId : null,
      helperText ? helperId : null,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="flex flex-col gap-1.5 w-full">
        <label
          htmlFor={inputId}
          className="text-sm font-medium tracking-wide text-foreground font-sans cursor-pointer select-none"
        >
          {label}
        </label>
        <input
          id={inputId}
          ref={ref}
          aria-describedby={describedBy || undefined}
          aria-invalid={!!error}
          className={cn(
            "flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-inter transition-colors",
            error ? "border-red-500 focus-visible:ring-red-500" : "border-input",
            className
          )}
          {...props}
        />
        {helperText && !error && (
          <span
            id={helperId}
            className="text-xs text-muted-foreground font-sans"
          >
            {helperText}
          </span>
        )}
        {error && (
          <span
            id={errorId}
            className="text-xs font-semibold text-red-500 font-sans"
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
    );
  }
);
FormInput.displayName = "FormInput";
