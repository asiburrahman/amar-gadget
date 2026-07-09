import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect, useRef } from "react";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (newItem) =>
        set((state) => {
          const exists = state.items.find((item) => item.id === newItem.id);
          if (exists) {
            return {
              items: state.items.map((item) =>
                item.id === newItem.id
                  ? { ...item, quantity: item.quantity + newItem.quantity }
                  : item
              ),
            };
          }
          return { items: [...state.items, newItem] };
        }),
      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),
      updateQuantity: (id, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item
          ),
        })),
      clearCart: () => set({ items: [] }),
    }),
    { name: "cart-storage" }
  )
);

/**
 * Hydration helper hook to prevent SSR hydration errors in Next.js.
 * Utilizes a React ref to store the selector, preventing infinite render loops
 * caused by inline anonymous selector functions.
 */
export function useHydratedStore<T, F>(
  store: (selector: (state: T) => F) => F,
  selector: (state: T) => F
): F | undefined {
  const [data, setData] = useState<F>();

  // Hold the selector in a mutable ref to prevent execution loops on dependency updates
  const selectorRef = useRef(selector);
  
  useEffect(() => {
    selectorRef.current = selector;
  });

  useEffect(() => {
    // Safely retrieve the current selector value once on mount
    const value = store((state) => selectorRef.current(state));
    setData(value);
  }, [store]);

  return data;
}