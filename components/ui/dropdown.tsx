import React, { useState, useRef, useEffect } from "react";

interface DropdownProps {
  children: React.ReactNode;
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

export const Dropdown = ({
  children,
  trigger,
  className = "",
  triggerClassName = "",
  contentClassName = "",
  align = "start",
  disabled = false,
  onOpenChange,
  sideOffset = 4,
  paddingOffset = 4,
  collisionPadding = 4,
}: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onOpenChange) onOpenChange(open);
  }, [open, onOpenChange]);

  const toggle = () => setOpen((prev) => !prev);
  const close = () => setOpen(false);
  const openDropdown = () => setOpen(true);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        open &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, close]);

  return (
    <div className="relative inline-block text-left">
      <div
        ref={triggerRef}
        className={`inline-flex rounded-md bg-background text-sm font-medium
          focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
          hover:bg-muted
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${triggerClassName}
        `}
        onClick={disabled ? undefined : toggle}
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
      >
        {trigger}
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className={`absolute z-50 mt-2 w-56 origin-top-right bg-background border border-border rounded-md shadow-lg ${contentClassName}`}
          style={{
            left: align === "start" ? 0 : align === "end" ? "auto" : "50%",
            transform: align === "start" ? "translateX(0)" : align === "end" ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          <div className="py-1">{children}</div>
        </div>
      )}
    </div>
  );
};