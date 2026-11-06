"use client";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
export function useNotificationRequests(ownerId: string, ownerRole: string, accessLost: () => void) {
  const active = useRef(false), controllers = useRef(new Set<AbortController>());
  useEffect(() => { active.current = true; const pending = controllers.current; return () => { active.current = false; for (const controller of pending) controller.abort(); pending.clear(); }; }, []);
  const current = () => { const user = useAuthStore.getState().user; return active.current && user?.id === ownerId && user.role === ownerRole && user.isVerified; };
  function invalidate() { accessLost(); void useAuthStore.getState().fetchUser().catch(() => undefined); }
  async function request(path: string, body?: unknown) {
    const controller = new AbortController(); controllers.current.add(controller); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal, headers: { "X-Notification-Owner": ownerId, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let value: Record<string, unknown>;
      try { const parsed: unknown = await response.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid response shape"); value = parsed as Record<string, unknown>; }
      catch { if (current() && [401, 403].includes(response.status)) invalidate(); throw new Error("The notification response could not be read. Reload the saved inbox."); }
      if (!current() || controller.signal.aborted) throw new Error("The active inbox account changed. Reload this page.");
      if (!response.ok || !value.success) {
        if ([401, 403].includes(response.status) || value.code === "NOTIFICATION_OWNER_CHANGED" || value.code === "NOTIFICATION_ACCOUNT_CHANGED") invalidate();
        throw new Error(typeof value.message === "string" ? value.message : "The notification request could not be confirmed.");
      }
      if (value.ownerId !== ownerId || (typeof value.ownerRole === "string" && value.ownerRole !== ownerRole)) { invalidate(); throw new Error("The notification response belongs to another account or role. Reload this page."); }
      return value;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }
  return { current, request };
}
