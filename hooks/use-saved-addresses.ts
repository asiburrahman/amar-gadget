"use client";
import { useCallback, useEffect, useState } from "react";
import type { AddressPage } from "@/lib/validations/address";
export function useSavedAddresses(ownerId: string | null, page = 1) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify({ ownerId, page, revision });
  const [result, setResult] = useState<{ key: string; ownerId: string; data: AddressPage | null; error: string }>({ key: "", ownerId: "", data: null, error: "" });
  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    void fetch(`/api/user/addresses?page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.message || "Unable to load saved addresses."); if (!controller.signal.aborted) setResult({ key, ownerId, data, error: "" }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, ownerId, data: null, error: error.message || "Unable to load saved addresses." }); });
    return () => controller.abort();
  }, [key, ownerId, page]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const currentOwner = Boolean(ownerId) && result.ownerId === ownerId;
  return { data: currentOwner ? result.data : null, error: currentOwner && result.key === key ? result.error : "", loading: Boolean(ownerId) && result.key !== key, refresh };
}
