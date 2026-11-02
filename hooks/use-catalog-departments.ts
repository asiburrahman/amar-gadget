"use client";
import { useEffect, useState } from "react";
type Department = { id: string; name: string; slug: string; parentId: string | null };
export function useCatalogDepartments(enabled: boolean) {
  const [rows, setRows] = useState<Department[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false; const controller = new AbortController();
    const load = async () => {
      setBusy(true); setError(""); setRows([]); const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch("/api/categories", { cache: "no-store", signal: controller.signal }); const value = await response.json();
        if (!response.ok || !value.success || !Array.isArray(value.categories) || value.categories.some((row: Department) => typeof row.id !== "string" || typeof row.name !== "string" || typeof row.slug !== "string")) throw new Error("Categories are temporarily unavailable.");
        if (!cancelled && !controller.signal.aborted) setRows(value.categories.filter((row: Department) => row.parentId == null).slice(0, 10));
      } catch { if (!cancelled) setError("Categories are temporarily unavailable. Reload the department list or browse all categories."); }
      finally { clearTimeout(timeout); if (!cancelled) setBusy(false); }
    };
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; controller.abort(); };
  }, [enabled, attempt]);
  return { rows, busy, error, reload: () => setAttempt((value) => value + 1) };
}
