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

const dispatchUserUpdate = (user: AuthUser | null) => {
  if (typeof window !== "undefined") {
    try {
      if (user) {
        localStorage.setItem("amar_gadget_user", JSON.stringify(user));
      } else {
        localStorage.removeItem("amar_gadget_user");
      }
      window.dispatchEvent(new CustomEvent("amar_gadget_user_updated", { detail: user }));
    } catch (e) {
      console.error("Failed to dispatch user update:", e);
    }
  }
};

const getInitialUser = (): AuthUser | null => {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("amar_gadget_user");
      if (stored) return JSON.parse(stored);
    } catch (e) {}
  }
  return null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: getInitialUser(),
  loading: true,
  setUser: (user) => {
    set({ user });
    dispatchUserUpdate(user);
  },
  updateUser: (partial) => {
    const current = get().user;
    const updated: AuthUser = current
      ? { ...current, ...partial }
      : {
          id: "",
          name: partial.name || null,
          email: partial.email || "",
          role: partial.role || "USER",
          avatar: partial.avatar !== undefined ? partial.avatar : null,
          phone: partial.phone || null,
          isVerified: partial.isVerified ?? false,
          sellerStatus: partial.sellerStatus || null,
          ...partial,
        };

    set({ user: updated });
    dispatchUserUpdate(updated);
  },
  fetchUser: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.user) {
        set({ user: data.user, loading: false });
        dispatchUserUpdate(data.user);
        return data.user;
      } else {
        set({ user: null, loading: false });
        dispatchUserUpdate(null);
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
      dispatchUserUpdate(null);
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  },
}));