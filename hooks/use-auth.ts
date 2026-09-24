"use client";

import { useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatar: string | null;
  isVerified: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, loading, logout, refreshUser: fetchUser };
}