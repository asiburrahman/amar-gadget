"use client";

import { useEffect } from "react";
import { useAuthStore, AuthUser, safeAuthUser } from "@/stores/auth-store";

export type { AuthUser };

export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const setUser = useAuthStore((state) => state.setUser);
  const updateUser = useAuthStore((state) => state.updateUser);
  const fetchUser = useAuthStore((state) => state.fetchUser);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUserUpdated = (e: Event) => {
      if (e instanceof CustomEvent && e.detail) {
        useAuthStore.setState({ user: safeAuthUser(e.detail) });
      }
    };

    window.addEventListener("amar_gadget_user_updated", handleUserUpdated);
    return () => {
      window.removeEventListener("amar_gadget_user_updated", handleUserUpdated);
    };
  }, []);

  return {
    user,
    loading,
    logout,
    refreshUser: fetchUser,
    updateUser,
    setUser,
  };
}
