import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { cleanHistory, recentIdsSchema, MAX_RECENT_PRODUCTS, type RecentEntry } from "@/lib/validations/recent-history";
type State = { entries: RecentEntry[]; record: (id: string) => void; clear: () => void };
export const useRecentHistoryStore = create<State>()(persist((set, get) => ({
  entries: [],
  record: (id) => { if (!recentIdsSchema.safeParse([id]).success) return; const now = Date.now(); set({ entries: [{ id, viewedAt: now }, ...cleanHistory(get().entries, now).filter((item) => item.id !== id)].slice(0, MAX_RECENT_PRODUCTS) }); },
  clear: () => set({ entries: [] }),
}), { name: "amar-gadget-recent-history", version: 1, partialize: (state) => ({ entries: state.entries }),
  merge: (saved, state) => ({ ...state, entries: cleanHistory((saved as { entries?: unknown } | null)?.entries) }),
  storage: createJSONStorage(() => ({ getItem: (key) => { try { return localStorage.getItem(key); } catch { return null; } }, setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* In-memory history remains available. */ } }, removeItem: (key) => { try { localStorage.removeItem(key); } catch { /* No history is sent to a provider. */ } } })),
}));
