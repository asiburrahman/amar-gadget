import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSyncExternalStore } from "react";

export interface CartItem {
  lineId?: string;
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
  pendingCheckouts: Record<string, { items: { productId: string; quantity: number; lineId?: string }[]; couponCode: string | null }>;
  rememberCheckout: (orderId: string, items: { productId: string; quantity: number; lineId?: string }[], couponCode: string | null) => void;
  completeCheckout: (orderId: string) => void;
  forgetCheckout: (orderId: string) => void;
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
      pendingCheckouts: {},
      forgetCheckout: (orderId) => set((state) => {
        const pendingCheckouts = { ...state.pendingCheckouts };
        delete pendingCheckouts[orderId];
        return { pendingCheckouts };
      }),
      rememberCheckout: (orderId, items, couponCode) => set((state) => state.pendingCheckouts[orderId] ? state : ({
        pendingCheckouts: { ...state.pendingCheckouts, [orderId]: {
          items: items.map((item) => ({ ...item, lineId: "lineId" in item ? item.lineId : state.items.find((line) => line.id === item.productId)?.lineId })), couponCode,
        } },
      })),
      completeCheckout: (orderId) => set((state) => {
        const pending = state.pendingCheckouts[orderId];
        if (!pending) return state;
        const pendingCheckouts = { ...state.pendingCheckouts };
        delete pendingCheckouts[orderId];
        let changed = false;
        const items = state.items.flatMap((item) => {
            const purchased = pending.items.find((line) => line.productId === item.id && line.lineId === item.lineId)?.quantity ?? 0;
            if (purchased) changed = true;
            const remaining = item.quantity - purchased;
            return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
        });
        return {
          pendingCheckouts, items,
          ...(changed && state.couponCode === pending.couponCode ? { couponCode: null, discountPercentage: 0 } : {}),
        };
      }),
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
          return { items: [...state.items, { ...newItem, lineId: globalThis.crypto.randomUUID() }] };
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

const subscribeHydration = () => () => undefined;

export function useHydratedStore<T, F>(
  store: (selector: (state: T) => F) => F,
  selector: (state: T) => F
): F | undefined {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const value = store(selector);
  return hydrated ? value : undefined;
}
