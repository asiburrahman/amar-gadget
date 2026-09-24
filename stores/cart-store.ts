import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect, useRef } from "react";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  discountPrice?: number | null;
  imageUrl?: string | null;
  stock?: number;
  category?: string;
  brand?: string;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  couponCode: string | null;
  discountPercentage: number;
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  applyCoupon: (code: string, discountPct: number) => void;
  removeCoupon: () => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getDiscountAmount: () => number;
  getTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      couponCode: null,
      discountPercentage: 0,
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
      applyCoupon: (code, discountPct) =>
        set({ couponCode: code, discountPercentage: discountPct }),
      removeCoupon: () => set({ couponCode: null, discountPercentage: 0 }),
      clearCart: () => set({ items: [], couponCode: null, discountPercentage: 0 }),
      getSubtotal: () => {
        return get().items.reduce((sum, item) => {
          const effectivePrice = item.discountPrice || item.price;
          return sum + effectivePrice * item.quantity;
        }, 0);
      },
      getDiscountAmount: () => {
        const subtotal = get().getSubtotal();
        return (subtotal * get().discountPercentage) / 100;
      },
      getTotal: () => {
        const subtotal = get().getSubtotal();
        const discount = get().getDiscountAmount();
        return Math.max(0, subtotal - discount);
      },
    }),
    { name: "amar-gadget-cart" }
  )
);

export function useHydratedStore<T, F>(
  store: (selector: (state: T) => F) => F,
  selector: (state: T) => F
): F | undefined {
  const [data, setData] = useState<F>();
  const selectorRef = useRef(selector);
  
  useEffect(() => {
    selectorRef.current = selector;
  });

  useEffect(() => {
    const value = store((state) => selectorRef.current(state));
    setData(value);
  }, [store]);

  return data;
}