/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrderConfirmation, type ConfirmedOrder } from "../../components/checkout/order-confirmation";
import { useCartStore } from "../../stores/cart-store";

const order: ConfirmedOrder = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", total: 1050, status: "PENDING", paymentStatus: "UNPAID", paymentMethod: "STRIPE",
  trackingNumber: "AG-TEST", shippingAddress: "Test address", canViewOrders: false, needsReview: false,
  items: [{ id: "line", quantity: 1, price: 900, product: { name: "Gadget" } }],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
beforeEach(() => {
  jest.clearAllMocks();
  useCartStore.setState({ items: [{ id: "product", lineId: "line", name: "Gadget", price: 900, quantity: 2 }], couponCode: null, pendingCheckouts: {} });
  useCartStore.getState().rememberCheckout(order.id, [{ productId: "product", quantity: 1, lineId: "line" }], null);
  global.fetch = jest.fn().mockResolvedValue(response({ order }));
});
afterEach(() => { jest.useRealTimers(); });

it("shows COD amount due and a working guest tracking destination", () => {
  render(<OrderConfirmation initialOrder={{ ...order, paymentMethod: "COD", status: "PROCESSING" }} />);
  expect(screen.getByText("Amount due on delivery")).toBeTruthy();
  expect(screen.queryByText("Amount paid")).toBeNull();
  expect(screen.getByRole("link", { name: "Track this order" }).getAttribute("href")).toBe("/track-order?id=AG-TEST");
  expect(screen.queryByRole("link", { name: "View my orders" })).toBeNull();
  expect(useCartStore.getState().items[0].quantity).toBe(1);
});

it("updates all confirmation state after delayed server payment confirmation", async () => {
  jest.useFakeTimers();
  (fetch as jest.Mock).mockResolvedValueOnce(response({ order }))
    .mockResolvedValue(response({ order: { ...order, paymentStatus: "PAID", status: "PROCESSING" } }));
  render(<OrderConfirmation initialOrder={order} />);
  expect(screen.getByText("Awaiting payment confirmation")).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(2);
  await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText("Payment confirmed")).toBeTruthy();
  expect(screen.getByText("Amount paid")).toBeTruthy();
  expect(screen.getByText("PROCESSING")).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["CANCELLED", "FAILED"])("renders terminal %s without a success claim or cart removal", (state) => {
  render(<OrderConfirmation initialOrder={{ ...order, ...(state === "CANCELLED" ? { status: state } : { paymentStatus: state }) }} />);
  expect(screen.getByText(state === "CANCELLED" ? "Order cancelled" : "Payment failed")).toBeTruthy();
  expect(screen.getByText("Order total")).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("flags late payment on a cancelled order for refund review", () => {
  render(<OrderConfirmation initialOrder={{ ...order, status: "CANCELLED", paymentStatus: "PAID", needsReview: true }} />);
  expect(screen.getByText("Amount received — refund review")).toBeTruthy();
  expect(screen.getByText("Payment was received for a closed order. Contact support for refund review.")).toBeTruthy();
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("bounds pending polling to twelve checks and supports explicit refresh", async () => {
  jest.useFakeTimers();
  render(<OrderConfirmation initialOrder={order} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
  expect(fetch).toHaveBeenCalledTimes(12);
  expect(screen.getByText("Automatic status checks have stopped. You can refresh this order explicitly.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh order status" }));
  await act(async () => undefined);
  expect(fetch).toHaveBeenCalledTimes(13);
});

it("retains the initial summary on refresh failure and exposes account history only to the owner", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ message: "Order service unavailable" }, false));
  render(<OrderConfirmation initialOrder={{ ...order, paymentMethod: "COD", canViewOrders: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh order status" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Order service unavailable");
  expect(screen.getByText("Test address", { exact: false })).toBeTruthy();
  expect(screen.getByRole("link", { name: "View my orders" }).getAttribute("href")).toBe("/user/orders");
});

it("does not overwrite a newer paid response with an older pending response", async () => {
  jest.useFakeTimers();
  let resolveOld!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue(response({ order: { ...order, paymentStatus: "PAID", status: "PROCESSING" } }));
  render(<OrderConfirmation initialOrder={order} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
  fireEvent.click(screen.getByRole("button", { name: "Refresh order status" }));
  await waitFor(() => expect(screen.getByText("Payment confirmed")).toBeTruthy());
  await act(async () => { resolveOld(response({ order })); });
  expect(screen.getByText("Payment confirmed")).toBeTruthy();
});
