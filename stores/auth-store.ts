import { create } from "zustand";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatar: string | null;
  phone?: string | null;
  isVerified: boolean;
  sellerStatus?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  fetchUser: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  setUser: (user) => {
    set({ user });
    if (typeof window !== "undefined" && user) {
      window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: user }));
    }
  },
  updateUser: (partial) => {
    const current = get().user;
    if (current) {
      const updated = { ...current, ...partial };
      set({ user: updated });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: updated }));
      }
    }
  },
  fetchUser: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.user) {
        set({ user: data.user, loading: false });
        return data.user;
      } else {
        set({ user: null, loading: false });
        return null;
      }
    } catch (error) {
      set({ user: null, loading: false });
      return null;
    }
  },
  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      set({ user: null });
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  },
}));