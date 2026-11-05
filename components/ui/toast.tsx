"use client";

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success" | "warning";
  duration?: number | null;
  action?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

type ToastVariant = "default" | "destructive" | "success" | "warning";

function useToastController() {
  const [toasts, setToasts] = useState<ToastProps[]>([]);
  const prefix = useId(), sequence = useRef(0);
  const records = useRef(new Map<string, ToastProps>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: string) => {
    const record = records.current.get(id);
    if (!record) return;
    records.current.delete(id);
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((previous) => previous.filter((entry) => entry.id !== id));
    record.onClose?.();
  }, []);
  const toast = useCallback((props: Omit<ToastProps, "id">) => {
    const replaced = [...records.current.values()];
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear(); records.current.clear();
    const id = `${prefix}-${++sequence.current}`, record = { ...props, id };
    records.current.set(id, record); setToasts([record]);
    if (typeof props.duration === "number" && Number.isFinite(props.duration)) {
      timers.current.set(id, setTimeout(() => dismiss(id), Math.min(2_147_483_647, Math.max(0, props.duration))));
    }
    // Publish the replacement first: an onClose callback may itself emit a
    // newer notification, which must remain the last visible notification.
    for (const entry of replaced) entry.onClose?.();
    return { id, dismiss: () => dismiss(id) };
  }, [dismiss, prefix]);
  useEffect(() => {
    const activeTimers = timers.current, activeRecords = records.current;
    return () => { for (const timer of activeTimers.values()) clearTimeout(timer); activeTimers.clear(); activeRecords.clear(); };
  }, []);
  return { toast, toasts, dismiss };
}

const ToastContext = createContext<ReturnType<typeof useToastController> | null>(null);

export const useToast = () => {
  const controller = useContext(ToastContext);
  if (!controller) throw new Error("useToast requires a ToastProvider.");
  return controller;
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const controller = useToastController();

  return (
    <ToastContext.Provider value={controller}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse space-y-4 pointer-events-none">
        {controller.toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            title={toast.title}
            description={toast.description}
            variant={toast.variant}
            duration={toast.duration}
            action={toast.action}
            onClose={() => controller.dismiss(toast.id)}
            className="pointer-events-auto"
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const Toast = ({
  id,
  title,
  description,
  variant = "default",
  action,
  onClose,
  className = "",
}: ToastProps) => {
  // Variant configurations
  const variantConfig: Record<
    ToastVariant,
    { bg: string; text: string; border: string }
  > = {
    default: {
      bg: "bg-background",
      text: "text-foreground",
      border: "border-border",
    },
    destructive: {
      bg: "bg-destructive/90",
      text: "text-destructive",
      border: "border-destructive",
    },
    success: {
      bg: "bg-success/90",
      text: "text-success",
      border: "border-success",
    },
    warning: {
      bg: "bg-warning/90",
      text: "text-warning",
      border: "border-warning",
    },
  };

  const effectiveVariant = variant ?? "default";
  const config = variantConfig[effectiveVariant];

  return (
    <div
      id={`toast-${id}`}
      className={`relative flex w-full max-w-xs p-4 mb-4
        ${config.bg} ${config.text} ${config.border}
        rounded-lg shadow-lg
        flex-col items-start gap-3
        ${className}
      `}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex space-x-3">
        {/* Icon based on variant */}
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          {variant === "success" && (
            <svg className="h-4 w-4 text-success" stroke="currentColor" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 014.438 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {variant === "destructive" && (
            <svg className="h-4 w-4 text-destructive" stroke="currentColor" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M7 20a10.022 10.022 0 015.361-2.116a7 7 0 11-10.722 0A10.022 10.022 0 015.361 17.884z" />
            </svg>
          )}
          {variant === "warning" && (
            <svg className="h-4 w-4 text-warning" stroke="currentColor" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 2.666 1.732 3z" />
            </svg>
          )}
          {(!title && !description) && (
            <svg className="h-4 w-4 text-muted-foreground" stroke="currentColor" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
            </svg>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {title && <h3 className="font-medium">{title}</h3>}
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && (
        <div className="flex items-center space-x-2 mt-2">
          {action}
        </div>
      )}
      {onClose && <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 rounded-sm hover:bg-muted/50 p-1"
        aria-label="Dismiss"
      >
        <svg className="h-4 w-4" stroke="currentColor" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>}
    </div>
  );
};
