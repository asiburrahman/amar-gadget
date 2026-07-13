import React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <label
          htmlFor={id}
          className="text-sm font-medium tracking-wide text-foreground font-sans cursor-pointer"
        >
          {label}
        </label>
        <input
          id={id}
          ref={ref}
          className={cn(
            "flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-inter",
            error ? "border-red-500" : "border-input",
            className
          )}
          {...props}
        />
        {error && (
          <span className="text-xs font-semibold text-red-500 font-sans">
            {error}
          </span>
        )}
      </div>
    );
  }
);
FormInput.displayName = "FormInput";
