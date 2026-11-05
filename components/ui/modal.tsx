"use client";

import React, { useEffect, useRef, useState, useLayoutEffect } from "react";

interface ModalProps extends Pick<React.HTMLAttributes<HTMLDivElement>, "aria-label" | "aria-labelledby" | "aria-describedby"> {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
}

export const Modal = ({
  isOpen,
  onClose,
  children,
  className = "",
  backdropClassName = "",
  closeOnBackdropClick = true,
  closeOnEsc = true,
  "aria-label": ariaLabel = "Dialog",
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [presence, setPresence] = useState({ open: isOpen, mounted: isOpen });
  // Opening is derived from the current prop during render; only delayed
  // removal needs an effect so the closing animation can finish.
  if (presence.open !== isOpen) setPresence({ open: isOpen, mounted: isOpen || presence.mounted });
  const mounted = isOpen || presence.mounted;

  useEffect(() => {
    if (isOpen) return;
    const timer = setTimeout(() => setPresence((current) => current.open ? current : { ...current, mounted: false }), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !mounted) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.focus({ preventScroll: true });
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalOverflow; };
  }, [isOpen, mounted]);

  useEffect(() => {
    if (!isOpen) return;
    const target = returnFocus.current;
    // Restore after DOM mutation/selection restoration. Layout cleanup alone
    // can be overwritten while the outgoing animated dialog is still mounted.
    return () => { if (target?.isConnected) target.focus({ preventScroll: true }); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !mounted) return;
    const handleKeyDown = (e: KeyboardEvent) => {
        if (closeOnEsc && e.key === "Escape") {
          onClose();
          return;
        }

        if (e.key === "Tab") {
          const focusableElements = getFocusableElements(modalRef.current!);
          if (focusableElements.length === 0) { e.preventDefault(); modalRef.current?.focus(); return; }

          const first = focusableElements[0];
          const last = focusableElements[focusableElements.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first || document.activeElement === modalRef.current) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, mounted, closeOnEsc, onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isOpen && e.target === e.currentTarget && closeOnBackdropClick) {
      onClose();
    }
  };

  if (!mounted && !isOpen) {
    return null;
  }

  return (
    <>
      <div
        ref={backdropRef}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={`fixed inset-0 z-50 flex items-center justify-center
          bg-black/50 backdrop-blur-sm
          ${backdropClassName}
          opacity-0 transition-opacity duration-200
          ${isOpen ? "opacity-100" : "opacity-0"}
          ${isOpen ? "pointer-events-auto" : "pointer-events-none"}
        `}
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal={isOpen || undefined}
          aria-label={labelledBy ? undefined : ariaLabel}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          className={`relative z-50 max-w-2xl w-full mx-4
            rounded-xl bg-background shadow-lg
            ${className}
            scale-95 opacity-0 transition-transform transition-opacity duration-300
            ${isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}
          `}
        >
          {children}
        </div>
      </div>
    </>
  );
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'area[href]',
    'input:not([disabled]):not([type="hidden"]):not([aria-hidden])',
    'select:not([disabled]):not([aria-hidden])',
    'textarea:not([disabled]):not([aria-hidden])',
    'button:not([disabled]):not([aria-hidden])',
    'iframe',
    'object',
    'embed',
    '[tabindex]:not([tabindex="-1"]):not([aria-hidden])',
    '[contenteditable]:not([contenteditable="false"]):not([aria-hidden])',
  ];
  const elements = container.querySelectorAll<HTMLElement>(focusableSelectors.join(","));
  return Array.from(elements).filter(
    (el) => !el.hasAttribute("disabled") && !el.hasAttribute("aria-hidden")
  );
}
