/** @jest-environment jsdom */
import { webcrypto } from "node:crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaymentRecovery } from "../../components/checkout/payment-recovery";
import { useCartStore } from "../../stores/cart-store";
import { seedClientCart } from "@/tests/helpers/client-cart-fixture";
import type { CartCheckoutContext } from "@/lib/validations/cart";
jest.mock("@/stores/cart-store", () => ({ useCartStore: jest.requireActual("@/tests/helpers/client-cart-fixture").useFixtureCartStore }));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const productId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", item = { id: productId, name: "Test product", price: 900, quantity: 3 };
const order = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", total: 1050, status: "PENDING", paymentStatus: "UNPAID", paymentMethod: "STRIPE", shippingAddress: "Test shipping address", reservationExpiresAt: null, needsReview: false, items: [{ productId, name: "Test product", quantity: 1, price: 900 }], cartSnapshot: undefined as CartCheckoutContext | undefined };
let cartFixture: Awaited<ReturnType<typeof seedClientCart>>;
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

beforeEach(async () => {
  jest.clearAllMocks();
  cartFixture = await seedClientCart([item]);
  order.cartSnapshot = useCartStore.getState().getCheckoutContext(); order.cartSnapshot.lines[0].quantity = 1;
  await useCartStore.getState().rememberCheckout(order.id, order.cartSnapshot.lines, null, order.cartSnapshot);
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

it("preserves items removed and re-added during payment", async () => {
  const state = useCartStore.getState();
  await state.removeItem(productId);
  await state.addItem({ ...item, quantity: 2 });
  await state.completeCheckout(order.id, order.cartSnapshot);
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("preserves the purchased snapshot across a storage reload", async () => {
  await seedClientCart([], { existing: new Map(cartFixture.values), catalog: [item] });
  expect(useCartStore.getState().pendingCheckouts[order.id].items[0].quantity).toBe(1);
  await useCartStore.getState().completeCheckout(order.id, order.cartSnapshot);
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("does not associate a replacement line with an order response arriving late", async () => {
  await seedClientCart([item]);
  const initial = useCartStore.getState().items[0];
  const context = useCartStore.getState().getCheckoutContext(); context.lines[0].quantity = 1;
  const snapshot = [{ productId: initial.id, quantity: 1, lineId: initial.lineId }];
  await useCartStore.getState().removeItem(initial.id);
  await useCartStore.getState().addItem({ ...item, quantity: 2 });
  await useCartStore.getState().rememberCheckout(order.id, snapshot, null, context);
  await useCartStore.getState().completeCheckout(order.id, context);
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});
