/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CartPage from "../../app/(marketing)/cart/page";
import CheckoutForm from "../../components/checkout/checkout-form";
import { useCartStore } from "../../stores/cart-store";
import { createOrder } from "../../server/actions/order/order-actions";
import type { CheckoutQuote } from "../../lib/checkout-quote";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
jest.mock("@/server/actions/order/order-actions", () => ({ createOrder: jest.fn() }));
jest.mock("@/lib/checkout-attempt", () => ({ getCheckoutAttempt: jest.fn().mockResolvedValue({ token: "a".repeat(64), signature: "fixture" }), clearCheckoutAttempt: jest.fn() }));

const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const quote: CheckoutQuote = { currency: "BDT", subtotal: 900, discountAmount: 0, shippingFee: 150, total: 1050, coupon: null,
  items: [{ productId, name: "Test gadget", quantity: 1, unitPrice: 900, lineTotal: 900 }], fingerprint: "1".repeat(64) };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const requestBody = (init: RequestInit) => JSON.parse(init.body as string);

beforeEach(() => {
  jest.clearAllMocks();
  useCartStore.setState({ items: [{ id: productId, lineId: "line", name: "Test gadget", price: 9999, quantity: 1 }], couponCode: null, pendingCheckouts: {} });
  global.fetch = jest.fn().mockResolvedValue(response({ quote }));
});

it("applies an arbitrary real coupon with the server's fixed discount and current prices", async () => {
  const discounted = { ...quote, coupon: { code: "REAL125", type: "fixed", value: 125.5 }, discountAmount: 125.5, total: 924.5 };
  (fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => Promise.resolve(response({ quote: requestBody(init).couponCode ? discounted : quote })));
  render(<CartPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Proceed to Checkout" })).toHaveProperty("disabled", false));
  expect(screen.queryByText(/9,999/)).toBeNull(); // Cached product price cannot set checkout totals.
  fireEvent.change(screen.getByPlaceholderText("Enter coupon code"), { target: { value: "real125" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("Coupon Discount (REAL125)");
  expect(useCartStore.getState().couponCode).toBe("REAL125");
  expect((fetch as jest.Mock).mock.calls.some(([, init]) => requestBody(init).couponCode === "REAL125")).toBe(true);
});

it("shows an expired/minimum-spend reason and allows removal without a fake discount", async () => {
  useCartStore.setState({ couponCode: "EXPIRED" });
  (fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => Promise.resolve(requestBody(init).couponCode
    ? response({ message: "This coupon is invalid or expired." }, false) : response({ quote })));
  render(<CartPage />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This coupon is invalid or expired.");
  expect(screen.getByRole("button", { name: "Proceed to Checkout" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Remove coupon EXPIRED" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Proceed to Checkout" })).toHaveProperty("disabled", false));
  expect(useCartStore.getState().couponCode).toBeNull();
});

it("keeps checkout blocked on a quote failure and supports an explicit retry", async () => {
  (fetch as jest.Mock).mockRejectedValueOnce(new Error("Quote service unavailable"));
  render(<CheckoutForm />);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Confirm & Place Order" })).toHaveProperty("disabled", true);
  expect(createOrder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh total" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm & Place Order" })).toHaveProperty("disabled", false));
});

it("discards an old quantity quote even if its request finishes after the new one", async () => {
  let resolveOld!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue(response({ quote: { ...quote, subtotal: 1800, total: 1950, items: [{ ...quote.items[0], quantity: 2, lineTotal: 1800 }] } }));
  render(<CartPage />);
  fireEvent.click(screen.getByRole("button", { name: "+" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Proceed to Checkout" })).toHaveProperty("disabled", false));
  await act(async () => { resolveOld(response({ quote })); });
  expect(screen.queryByText(/1,050/)).toBeNull();
  expect(useCartStore.getState().items[0].quantity).toBe(2);
});

it("does not apply a coupon validated for a cart which changed during the request", async () => {
  let resolveCoupon!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => requestBody(init).couponCode
    ? new Promise<Response>((resolve) => { resolveCoupon = resolve; }) : Promise.resolve(response({ quote })));
  render(<CartPage />);
  fireEvent.change(screen.getByPlaceholderText("Enter coupon code"), { target: { value: "REAL125" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  fireEvent.click(screen.getByRole("button", { name: "+" }));
  await act(async () => { resolveCoupon(response({ quote })); });
  await screen.findByText("Your cart changed. Apply the coupon again to check the updated items.");
  expect(useCartStore.getState().couponCode).toBeNull();
});

it("sends the displayed quote fingerprint and refreshes a changed-price rejection before retry", async () => {
  (createOrder as jest.Mock).mockResolvedValue({ success: false, code: "QUOTE_CHANGED", error: "Prices changed. Review the refreshed total." });
  const view = render(<CheckoutForm />);
  const button = await screen.findByRole("button", { name: "Confirm & Place Order" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  for (const [label, value] of [["Full Name *", "Test buyer"], ["Phone Number *", "01700000000"], ["Street Address *", "House 7, Test road"], ["City *", "Dhaka"], ["District / Division *", "Dhaka"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  (fetch as jest.Mock).mockResolvedValue(response({ quote: { ...quote, total: 1100, fingerprint: "2".repeat(64) } }));
  fireEvent.submit(view.container.querySelector("form")!);
  await screen.findByText("Prices changed. Review the refreshed total.");
  expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ quoteFingerprint: quote.fingerprint }));
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ quoteFingerprint: "2".repeat(64) })));
  expect(useCartStore.getState().items).toHaveLength(1);
});
