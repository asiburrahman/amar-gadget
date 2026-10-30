import { create } from "zustand";
import { avatarKeyFromUrl } from "@/lib/avatar-policy";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  avatar: string | null;
  avatarVersion?: number;
  phone?: string | null;
  isVerified: boolean;
  sellerStatus?: string | null;
}

export function safeAuthUser(user: AuthUser | null): AuthUser | null {
  if (!user || typeof user.id !== "string" || !user.id || typeof user.email !== "string" || typeof user.role !== "string") return null;
  const version = Number.isSafeInteger(user.avatarVersion) && (user.avatarVersion ?? 0) > 0 ? user.avatarVersion! : 0;
  return { id: user.id, name: typeof user.name === "string" ? user.name.slice(0, 120) : null, email: user.email, role: user.role, avatar: version && typeof user.avatar === "string" && avatarKeyFromUrl(user.avatar, user.id) ? user.avatar : null, avatarVersion: version, phone: user.phone, isVerified: user.isVerified === true, sellerStatus: user.sellerStatus };
}
let authRequestEpoch = 0;

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
      if (stored && stored.length <= 32 * 1024) return safeAuthUser(JSON.parse(stored));
      if (stored) localStorage.removeItem("amar_gadget_user");
    } catch { /* A corrupt or unavailable cache never supplies a photo. */ }
  }
  return null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: getInitialUser(),
  loading: true,
  setUser: (user) => {
    authRequestEpoch++;
    user = safeAuthUser(user);
    const current = get().user;
    if (user && current?.id === user.id && (current.avatarVersion ?? 0) > (user.avatarVersion ?? 0)) user = { ...user, avatar: current.avatar, avatarVersion: current.avatarVersion };
    set({ user, loading: false });
    dispatchUserUpdate(user);
  },
  updateUser: (partial) => {
    const current = get().user;
    if (!current || (partial.id !== undefined && partial.id !== current.id)) return;
    authRequestEpoch++;
    if (partial.avatarVersion !== undefined && partial.avatarVersion < (current.avatarVersion ?? 0)) partial = { ...partial, avatar: current.avatar, avatarVersion: current.avatarVersion };
    const updated = safeAuthUser({ ...current, ...partial });

    set({ user: updated });
    dispatchUserUpdate(updated);
  },
  fetchUser: async () => {
    const ticket = ++authRequestEpoch;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      if (ticket !== authRequestEpoch) return get().user;
      if (data.success && data.user) {
        let user = safeAuthUser(data.user);
        const current = get().user;
        if (user && current?.id === user.id && (current.avatarVersion ?? 0) > (user.avatarVersion ?? 0)) user = { ...user, avatar: current.avatar, avatarVersion: current.avatarVersion };
        set({ user, loading: false });
        dispatchUserUpdate(user);
        return user;
      } else {
        set({ user: null, loading: false });
        dispatchUserUpdate(null);
        return null;
      }
    } catch {
      if (ticket !== authRequestEpoch) return get().user;
      set({ user: null, loading: false });
      return null;
    }
  },
  logout: async () => {
    authRequestEpoch++;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      authRequestEpoch++;
      set({ user: null });
      dispatchUserUpdate(null);
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Logout deliberately reloads all private client state after expiring the cookie.
        window.location.href = "/login";
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  },
}));
