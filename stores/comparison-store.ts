import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { comparisonIdsSchema, comparisonIdSchema, MAX_COMPARISON_PRODUCTS } from "@/lib/validations/comparison";

type State = { ids: string[]; add: (id: string) => boolean; remove: (id: string) => void; replace: (ids: string[]) => void };
export const useComparisonStore = create<State>()(persist((set, get) => ({
  ids: [],
  add: (id) => {
    if (!comparisonIdSchema.safeParse(id).success) return false;
    const ids = get().ids; if (ids.includes(id)) return true;
    if (ids.length >= MAX_COMPARISON_PRODUCTS) return false;
    set({ ids: [...ids, id] }); return true;
  },
  remove: (id) => set({ ids: get().ids.filter((item) => item !== id) }),
  replace: (ids) => { const parsed = comparisonIdsSchema.safeParse(ids); if (parsed.success) set({ ids: parsed.data }); },
}), {
  name: "amar-gadget-comparison", version: 1,
  partialize: (state) => ({ ids: state.ids }),
  merge: (saved, current) => { const parsed = comparisonIdsSchema.safeParse((saved as { ids?: unknown } | null)?.ids); return { ...current, ids: parsed.success ? parsed.data : [] }; },
  storage: createJSONStorage(() => ({
    getItem: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* Keep in-memory selection when storage is unavailable. */ } },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch { /* In-memory selection is still cleared. */ } },
  })),
}));
