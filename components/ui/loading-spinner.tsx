import React from "react";

interface LoadingSpinnerProps {
  message?: string;
  subMessage?: string;
  fullScreen?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}

export function LoadingSpinner({
  message = "Loading Amar Gadget...",
  subMessage = "Fetching latest gadgets & verified deals",
  fullScreen = false,
  size = "lg",
}: LoadingSpinnerProps) {
  const sizeMap = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
    xl: "w-20 h-20",
  };

  const spinnerSize = sizeMap[size] || sizeMap.lg;

  const content = (
    <div className="flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in duration-300">
      {/* Brand Glowing Spinner Ring */}
      <div className="relative flex items-center justify-center">
        {/* Soft background pulse glow */}
        <div className={`absolute ${spinnerSize} rounded-full bg-[#fed700]/25 blur-xl animate-pulse`} />
        
        {/* Outer rotating gradient ring */}
        <svg
          className={`animate-spin ${spinnerSize} text-[#fed700]`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-20"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3.5"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>

        {/* Inner center gadget icon / dot */}
        <div className="absolute w-3 h-3 rounded-full bg-[#fed700] shadow-[0_0_12px_#fed700] animate-ping" />
        <div className="absolute w-2 h-2 rounded-full bg-[#333e48] dark:bg-white" />
      </div>

      {/* Loading Label and Subtext */}
      {message && (
        <div className="mt-5 space-y-1">
          <p className="text-sm md:text-base font-extrabold text-foreground tracking-tight">
            {message}
          </p>
          {subMessage && (
            <p className="text-xs text-muted-foreground font-medium animate-pulse">
              {subMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center bg-transparent">
      {content}
    </div>
  );
}
