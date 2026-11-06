import { z } from "zod";
import { cartCouponSchema } from "@/lib/validations/cart";
import { catalogIdSchema } from "@/lib/validations/product";
import { LEGACY_CART_KEY, GuestCartError } from "@/lib/client/guest-cart";

const quantitySchema = z.number().int().min(1).max(100);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export type LegacyCartRow = { index: number; productId: string | null; quantity: number | null; problem: string | null };
export type LegacyCartSummary = {
  present: boolean; invalid: boolean; rows: LegacyCartRow[]; pendingOrderIds: string[]; invalidPending: boolean;
  couponCode: string | null; totalRows: number;
};
export type LegacyCartRead = { raw: string | null; summary: LegacyCartSummary };
const emptySummary = (): LegacyCartSummary => ({ present: false, invalid: false, rows: [], pendingOrderIds: [], invalidPending: false, couponCode: null, totalRows: 0 });

/** Old ownerless cache is quarantined until explicit review. Its names, prices,
 * images and personal fields never become a public UI DTO or API payload. */
export function inspectLegacyCart(raw: string | null): LegacyCartSummary {
  if (raw === null) return emptySummary();
  const invalid = () => ({ ...emptySummary(), present: true, invalid: true });
  if (raw.length > 1_048_576) return invalid();
  try {
    const root: unknown = JSON.parse(raw);
    if (!object(root) || !object(root.state) || !Array.isArray(root.state.items) || root.state.items.length > 10_000) return invalid();
    const rows: LegacyCartRow[] = root.state.items.map((value, index) => {
      const id = z.string().uuid().safeParse(object(value) ? value.id : undefined), quantity = quantitySchema.safeParse(object(value) ? value.quantity : undefined);
      return { index, productId: id.success ? id.data : null, quantity: quantity.success ? quantity.data : null,
        problem: !id.success ? "This saved row has no valid product ID. It was retained for review or explicit discard." : !quantity.success ? "Choose a whole quantity from 1 to 100 before importing this row." : null };
    });
    const pending = root.state.pendingCheckouts;
    const pendingOrderIds = object(pending) ? Object.keys(pending).filter((id) => z.string().uuid().safeParse(id).success) : [];
    const invalidPending = pending !== undefined && (!object(pending) || Object.keys(pending).length > 20 || pendingOrderIds.length !== Object.keys(pending).length);
    const coupon = cartCouponSchema.safeParse(root.state.couponCode ?? null);
    return { present: true, invalid: false, rows, totalRows: rows.length, pendingOrderIds, invalidPending, couponCode: coupon.success ? coupon.data : null };
  } catch { return invalid(); }
}
type Dependencies = { storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined; lock?: <T>(work: () => Promise<T>) => Promise<T> };
export function createLegacyCartRepository(deps: Dependencies) {
  const read = (): LegacyCartRead => {
    try {
      const storage = deps.storage(); if (!storage) throw new Error();
      const raw = storage.getItem(LEGACY_CART_KEY); return { raw, summary: inspectLegacyCart(raw) };
    } catch { throw new GuestCartError("Older browser cart storage could not be read. Enable browser storage to review it."); }
  };
  async function locked<T>(work: () => Promise<T>) {
    if (!deps.lock) return work();
    let entered = false;
    try { return await deps.lock(() => { entered = true; return work(); }); }
    catch (error) { if (!entered) return work(); throw error; }
  }
  function matches(snapshot: LegacyCartRead) {
    if (read().raw !== snapshot.raw) throw new GuestCartError("Older browser cart changed in another tab. Refresh its review before retrying.");
  }
  async function edit(snapshot: LegacyCartRead, transform: (root: { state: Record<string, unknown> & { items: unknown[] } }) => void) {
    return locked(async () => {
      matches(snapshot);
      if (snapshot.raw === null || snapshot.summary.invalid) throw new GuestCartError("This older cart cannot be edited automatically. Its data was retained for explicit review or discard.");
      const root = JSON.parse(snapshot.raw); transform(root);
      try {
        const storage = deps.storage(); if (!storage) throw new Error();
        storage.setItem(LEGACY_CART_KEY, JSON.stringify(root));
      } catch { throw new GuestCartError("Older browser cart could not be updated. Keep its data and review before retrying."); }
      return read();
    });
  }
  return {
    read, matches,
    importable: (snapshot: LegacyCartRead, indices: number[]) => {
      matches(snapshot);
      if (snapshot.summary.invalid || snapshot.summary.invalidPending || snapshot.summary.pendingOrderIds.length) throw new GuestCartError("Confirm or close every older checkout receipt before importing its cart.");
      if (!indices.length || indices.length > 100 || new Set(indices).size !== indices.length) throw new GuestCartError("Choose up to 100 distinct saved rows at a time.");
      return indices.map((index) => {
        const row = snapshot.summary.rows[index];
        if (!row?.productId || row.quantity === null) throw new GuestCartError("Repair or leave invalid saved rows before importing the selected items.");
        return { index, productId: row.productId, quantity: row.quantity };
      });
    },
    repairQuantity: (snapshot: LegacyCartRead, index: number, quantity: number) => edit(snapshot, (root) => {
      quantitySchema.parse(quantity);
      const row = root.state.items[index];
      if (!object(row) || !z.string().uuid().safeParse(row.id).success) throw new GuestCartError("This row needs a valid product reference. It was retained for review.");
      row.quantity = quantity;
    }),
    /** Call only after the modern guest write is durable. Cleanup failure
     * leaves old rows intact; max-quantity import is safe to repeat. */
    removeImportedRows: (snapshot: LegacyCartRead, indices: number[], consumeCoupon = false) => edit(snapshot, (root) => {
      if (snapshot.summary.pendingOrderIds.length || snapshot.summary.invalidPending) throw new GuestCartError("An older checkout needs review before its rows can be imported.");
      const selected = new Set(indices);
      root.state.items = root.state.items.filter((_, index) => !selected.has(index));
      if (consumeCoupon) root.state.couponCode = null;
    }),
    /** The caller must obtain this order through the existing authorized
     * checkout API first. Product ID alone is never fabricated into lineage. */
    settleReceipt: (snapshot: LegacyCartRead, order: { id: string; status: string; paymentStatus: string; paymentMethod: string }) => edit(snapshot, (root) => {
      const pending = root.state.pendingCheckouts;
      if (!object(pending) || !Object.hasOwn(pending, order.id)) return;
      const closed = order.status === "CANCELLED" || order.paymentStatus === "FAILED";
      const purchased = !closed && (order.paymentStatus === "PAID" || (order.paymentMethod === "COD" && ["PROCESSING", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(order.status)));
      if (!closed && !purchased) throw new GuestCartError("This checkout is still pending. Resume or close it before importing the older cart.");
      const receipt = pending[order.id], selected = object(receipt) && Array.isArray(receipt.items) ? receipt.items : [];
      if (purchased) root.state.items = root.state.items.flatMap((row) => {
        if (!object(row) || !quantitySchema.safeParse(row.quantity).success || !catalogIdSchema.safeParse(row.lineId).success) return [row];
        const captured = selected.find((entry) => object(entry) && entry.productId === row.id && entry.lineId === row.lineId && quantitySchema.safeParse(entry.quantity).success);
        if (!object(captured)) return [row];
        const remaining = Number(row.quantity) - Number(captured.quantity);
        return remaining > 0 ? [{ ...row, quantity: remaining }] : [];
      });
      // Old coupons have no intent revision. Preserve them for explicit review
      // rather than clearing a potentially re-applied identical code.
      delete pending[order.id];
    }),
    discard: (snapshot: LegacyCartRead) => locked(async () => {
      matches(snapshot);
      try { const storage = deps.storage(); if (!storage) throw new Error(); storage.removeItem(LEGACY_CART_KEY); }
      catch { throw new GuestCartError("Could not remove older browser cart storage."); }
      return read();
    }),
  };
}
