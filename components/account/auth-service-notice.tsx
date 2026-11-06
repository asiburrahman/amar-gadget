"use client";
import { useAuthStore } from "@/stores/auth-store";
export function AuthServiceNotice() {
  const error = useAuthStore((state) => state.error), reference = useAuthStore((state) => state.reference), retry = useAuthStore((state) => state.fetchUser);
  if (!error) return null;
  return <aside role="alert" className="border-b bg-background p-4 text-sm"><p>{error}</p>{reference && <p>Reference: {reference}</p>}<button type="button" className="underline" onClick={() => void retry()}>Retry session verification</button></aside>;
}
