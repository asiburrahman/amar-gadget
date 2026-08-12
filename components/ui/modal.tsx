import React, { useEffect, useRef, useState, useLayoutEffect } from "react";

interface ModalProps {
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
}: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (isOpen) {
      setMounted(true);
    } else {
      timer = setTimeout(() => setMounted(false), 300);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    let cleanup: (() => void) | undefined;

    if (isOpen && mounted) {
      // Save the previously focused element
      const previouslyFocusedElement = document.activeElement as HTMLElement | null;

      // Focus the modal when it opens
      modalRef.current?.focus({ preventScroll: true });

      // Trap focus inside the modal
      const handleKeyDown = (e: KeyboardEvent) => {
        if (closeOnEsc && e.key === "Escape") {
          onClose();
          return;
        }

        if (e.key === "Tab") {
          const focusableElements = getFocusableElements(modalRef.current!);
          if (focusableElements.length === 0) return;

          const first = focusableElements[0];
          const last = focusableElements[focusableElements.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first) {
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

      // Prevent scroll when modal is open
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      cleanup = () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = originalOverflow;
        // Return focus to the previously focused element
        if (previouslyFocusedElement) {
          previouslyFocusedElement.focus();
        }
      };
    }

    return cleanup;
  }, [isOpen, mounted, closeOnEsc, onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && closeOnBackdropClick) {
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
        className={`fixed inset-0 z-50 flex items-center justify-center
          bg-black/50 backdrop-blur-sm
          ${backdropClassName}
          opacity-0 transition-opacity duration-200
          ${isOpen ? "opacity-100" : "opacity-0"}
          pointer-events-${isOpen ? "auto" : "none"}
        `}
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
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