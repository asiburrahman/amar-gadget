"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownProps {
  children: React.ReactNode;
  /** Trigger label/content; the component supplies the accessible button. */
  trigger: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  sideOffset?: number;
  paddingOffset?: number;
  collisionPadding?: number;
}

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const spacing = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 4;

export function Dropdown({ children, trigger, className = "", triggerClassName = "", contentClassName = "",
  align = "start", disabled = false, onOpenChange, sideOffset = 4, paddingOffset = 4, collisionPadding = 4,
}: DropdownProps) {
  const [requestedOpen, setOpen] = useState(false);
  const open = requestedOpen && !disabled;
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight?: number }>({ left: 0, top: 0 });
  if (disabled && requestedOpen) setOpen(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const gap = spacing(sideOffset);
  const padding = spacing(collisionPadding);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const button = triggerRef.current;
      const content = contentRef.current;
      if (!button || !content) return;
      const anchor = button.getBoundingClientRect();
      const bounds = content.getBoundingClientRect();
      const naturalHeight = Math.max(bounds.height, content.scrollHeight + content.offsetHeight - content.clientHeight);
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - padding);
      const above = Math.max(0, anchor.top - gap - padding);
      const placeAbove = naturalHeight > below && above > below;
      const maxHeight = placeAbove ? above : below;
      const desiredLeft = align === "end" ? anchor.right - bounds.width
        : align === "center" ? anchor.left + (anchor.width - bounds.width) / 2 : anchor.left;
      const left = Math.max(padding, Math.min(desiredLeft, window.innerWidth - padding - bounds.width));
      const top = placeAbove ? Math.max(padding, anchor.top - gap - Math.min(naturalHeight, maxHeight)) : anchor.bottom + gap;
      setPosition((old) => old.left === left && old.top === top && old.maxHeight === maxHeight ? old : { left, top, maxHeight });
    };
    measure();
    const content = contentRef.current;
    (content?.querySelector<HTMLElement>(focusable) ?? content)?.focus();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (content) observer?.observe(content);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, align, gap, padding]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !contentRef.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); close(); triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  return <div className={`relative inline-block text-left ${className}`}>
    <button type="button" ref={triggerRef} id={`${id}-trigger`} disabled={disabled}
      className={`inline-flex rounded-md bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed ${triggerClassName}`}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" && !disabled) { event.preventDefault(); setOpen(true); }
      }} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-content` : undefined}>
      {trigger}
    </button>
    {open && createPortal(<div ref={contentRef} id={`${id}-content`} role="dialog" aria-labelledby={`${id}-trigger`} tabIndex={-1}
      className={`fixed z-50 w-56 overflow-y-auto bg-background border border-border rounded-md shadow-lg ${contentClassName}`}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight,
        maxWidth: `calc(100vw - ${padding * 2}px)`, padding: spacing(paddingOffset) }}>
      {children}
    </div>, document.body)}
  </div>;
}
