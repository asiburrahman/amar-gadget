/** @jest-environment jsdom */
import { webcrypto } from "node:crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaymentRecovery } from "../../components/checkout/payment-recovery";
import { useCartStore } from "../../stores/cart-store";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const order = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", total: 1050, status: "PENDING", paymentStatus: "UNPAID", paymentMethod: "STRIPE", shippingAddress: "Test shipping address", reservationExpiresAt: null, needsReview: false, items: [{ productId: "product", name: "Test product", quantity: 1, price: 900 }] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

beforeEach(() => {
  jest.clearAllMocks();
  useCartStore.setState({ items: [], couponCode: null, pendingCheckouts: {} });
  useCartStore.getState().addItem({ id: "product", name: "Test product", price: 900, quantity: 3 });
  useCartStore.getState().rememberCheckout(order.id, [{ productId: "product", quantity: 1 }], null);
  global.fetch = jest.fn();
});

it("retains the cart after a failed payment request and retries the same order", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ order })).mockRejectedValueOnce(new Error("Network unavailable"));
  render(<PaymentRecovery orderId={order.id} />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue secure card payment" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Network unavailable");
  expect(useCartStore.getState().items[0].quantity).toBe(3);
  expect((fetch as jest.Mock).mock.calls[1][0]).toBe(`/api/checkout/${order.id}`);
});

it("shows cancelled order context without losing the cart", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({ order }))
    .mockResolvedValueOnce(response({ cancelled: true }))
    .mockResolvedValueOnce(response({ order: { ...order, status: "CANCELLED", paymentStatus: "FAILED" } }));
  render(<PaymentRecovery orderId={order.id} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel reserved checkout" }));
  expect(await screen.findByText("Checkout closed")).toBeTruthy();
  expect(screen.getByText("Shipping: Test shipping address")).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(3);
});

it("removes only verified purchased quantities and ignores repeat completion", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ order: { ...order, paymentStatus: "PAID", status: "PROCESSING" } }));
  const view = render(<PaymentRecovery orderId={order.id} />);
  await screen.findByText("Payment confirmed");
  await waitFor(() => expect(useCartStore.getState().items[0].quantity).toBe(2));
  view.unmount();
  render(<PaymentRecovery orderId={order.id} />);
  await screen.findByText("Payment confirmed");
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("retains the cart for a late payment on a closed order", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ order: { ...order, paymentStatus: "PAID", status: "CANCELLED", needsReview: true } }));
  render(<PaymentRecovery orderId={order.id} />);
  expect(await screen.findByText(/Contact support for refund review/)).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(3);
});

it("preserves items removed and re-added during payment", () => {
  const state = useCartStore.getState();
  state.removeItem("product");
  state.addItem({ id: "product", name: "New purchase", price: 900, quantity: 2 });
  state.completeCheckout(order.id);
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("preserves the purchased snapshot across a storage reload", async () => {
  const saved = localStorage.getItem("amar-gadget-cart")!;
  useCartStore.setState({ items: [], pendingCheckouts: {} });
  localStorage.setItem("amar-gadget-cart", saved);
  await useCartStore.persist.rehydrate();
  expect(useCartStore.getState().pendingCheckouts[order.id].items[0].quantity).toBe(1);
  useCartStore.getState().completeCheckout(order.id);
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("does not associate a replacement line with an order response arriving late", () => {
  const initial = useCartStore.getState().items[0];
  const snapshot = [{ productId: initial.id, quantity: 1, lineId: initial.lineId }];
  useCartStore.getState().removeItem(initial.id);
  useCartStore.getState().addItem({ id: initial.id, name: "New purchase", price: 900, quantity: 2 });
  useCartStore.getState().rememberCheckout("late-order", snapshot, null);
  useCartStore.getState().completeCheckout("late-order");
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});
