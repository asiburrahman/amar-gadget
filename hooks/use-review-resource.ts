"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { currentReviewScope, fetchReviewJson } from "@/lib/client/review-client";
export function useReviewResource<T>(url: string, ownerId: string) {
  const accountScope = useAuthStore((state) => !state.loading && state.user?.id === ownerId ? `${state.user.id}:${state.user.role}:${state.user.sellerStatus ?? ""}` : "loading");
  const [revision, setRevision] = useState(0), [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const key = JSON.stringify({ url, ownerId, revision, accountScope });
  useEffect(() => {
    if (accountScope === "loading") return;
    const controller = new AbortController(); let active = true;
    void fetchReviewJson<T>(url, { signal: controller.signal }, ownerId)
      .then((data) => { if (active && !controller.signal.aborted && currentReviewScope(ownerId) === accountScope) setResult({ key, data, error: "" }); })
      .catch((error) => { if (active && !controller.signal.aborted) setResult({ key, data: null, error: error instanceof Error ? error.message : "Unable to load reviews." }); });
    return () => { active = false; controller.abort(); };
  }, [url, ownerId, key, accountScope]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const current = key === result.key;
  return { data: current ? result.data : null, error: current ? result.error : "", loading: accountScope === "loading" || !current, refresh };
}
