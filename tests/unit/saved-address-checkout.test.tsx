/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutForm from "@/components/checkout/checkout-form";
import { useCartStore } from "@/stores/cart-store";
import { createOrder } from "@/server/actions/order/order-actions";
import type { AuthUser } from "@/hooks/use-auth";
import type { SavedAddress, AddressPage } from "@/lib/validations/address";
let user: AuthUser | null;
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user, loading: false }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/server/actions/order/order-actions", () => ({ createOrder: jest.fn() }));
jest.mock("@/lib/checkout-attempt", () => ({ getCheckoutAttempt: jest.fn().mockResolvedValue({ token: "a".repeat(64), fingerprint: "fixture" }) }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const first: SavedAddress = { id: "11111111-1111-4111-8111-111111111111", version: 1, fullName: "Home recipient", phone: "01700000000", street: "House 12, Home road", city: "Dhaka", district: "Dhaka", zipCode: "1200", isDefault: true };
const second: SavedAddress = { ...first, id: "22222222-2222-4222-8222-222222222222", fullName: "Office recipient", street: "Office road 21", city: "Sylhet", district: "Sylhet", zipCode: "3100", isDefault: false };
const quote = { currency: "BDT", subtotal: 100, discountAmount: 0, shippingFee: 150, total: 250, coupon: null, items: [{ productId: id, name: "Gadget", quantity: 1, unitPrice: 100, lineTotal: 100 }], fingerprint: "1".repeat(64) };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const page = (rows = [first, second]): AddressPage => ({ addresses: rows, defaultAddress: rows.find((row) => row.isDefault) ?? null, page: 1, total: rows.length, totalPages: rows.length ? 1 : 0 });
beforeEach(() => {
  jest.clearAllMocks(); user = { id: "owner", name: "Account name", phone: "01800000000", email: "owner@example.invalid", avatar: null, role: "USER", isVerified: true };
  useCartStore.setState({ items: [{ id, lineId: "line", name: "Gadget", price: 100, quantity: 1 }], pendingCheckouts: {}, couponCode: null });
  (createOrder as jest.Mock).mockResolvedValue({ success: false, error: "Checkout fixture retained" });
  global.fetch = jest.fn().mockImplementation((url: string) => Promise.resolve(response(url.startsWith("/api/checkout/quote") ? { quote } : { success: true, ...page() })));
});
it("prefills the real default and submits the displayed shipping snapshot rather than owner/address identifiers", async () => {
  const view = render(<CheckoutForm />);
  await waitFor(() => expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", first.street));
  expect(screen.getByLabelText("Full Name *")).toHaveProperty("value", first.fullName); expect(screen.getByLabelText("Postal code (optional)")).toHaveProperty("value", "1200");
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  const body = (createOrder as jest.Mock).mock.calls[0][0]; expect(body).toMatchObject({ street: first.street, fullName: first.fullName, city: first.city, phone: first.phone, quoteFingerprint: quote.fingerprint });
  expect(body.userId).toBeUndefined(); expect(body.addressId).toBeUndefined();
});
it("selects another saved address including postal code and clears shipping fields for explicit manual entry", async () => {
  render(<CheckoutForm />); await screen.findByRole("option", { name: /Office recipient/ });
  fireEvent.change(screen.getByLabelText("Saved shipping address"), { target: { value: second.id } });
  expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", second.street); expect(screen.getByLabelText("Postal code (optional)")).toHaveProperty("value", "3100");
  fireEvent.change(screen.getByLabelText("Saved shipping address"), { target: { value: "manual" } });
  for (const label of ["Street Address *", "City *", "District / Division *", "Postal code (optional)"]) expect(screen.getByLabelText(label)).toHaveProperty("value", "");
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init.method && init.method !== "POST")).toHaveLength(0);
});
it("does not overwrite a manual draft when the default-address response arrives late", async () => {
  let finish!: (value: Response) => void;
  (fetch as jest.Mock).mockImplementation((url: string) => url.startsWith("/api/checkout/quote") ? Promise.resolve(response({ quote })) : new Promise<Response>((resolve) => { finish = resolve; }));
  render(<CheckoutForm />);
  fireEvent.change(screen.getByLabelText("Street Address *"), { target: { value: "Customer typed road" } });
  await act(async () => finish(response({ success: true, ...page() })));
  expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", "Customer typed road"); expect(screen.getByLabelText("City *")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Full Name *")).toHaveProperty("value", "Account name");
});
it("drops the previous account's selected address and ignores its late response on an account transition", async () => {
  let finish!: (value: Response) => void, addressReads = 0;
  (fetch as jest.Mock).mockImplementation((url: string) => url.startsWith("/api/checkout/quote") ? Promise.resolve(response({ quote })) : ++addressReads === 1 ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(response({ success: true, ...page([{ ...second, isDefault: true }]) })));
  const view = render(<CheckoutForm />);
  user = { ...user!, id: "another-owner", name: "Other account" }; view.rerender(<CheckoutForm />);
  await waitFor(() => expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", second.street));
  await act(async () => finish(response({ success: true, ...page([first]) })));
  expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", second.street); expect(screen.queryByRole("option", { name: /Home recipient/ })).toBeNull();
});
it("permits manual entry after an address outage and never silently inserts a sample street/city", async () => {
  (fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.startsWith("/api/checkout/quote") ? response({ quote }) : response({ success: false, message: "Saved addresses unavailable" }, false)));
  const view = render(<CheckoutForm />); await screen.findByRole("alert");
  for (const [label, value] of [["Street Address *", "Manual road 12"], ["City *", "Khulna"], ["District / Division *", "Khulna"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ street: "Manual road 12", city: "Khulna" })));
});
it("leaves a guest's address blank and rejects an empty submission before an order call", async () => {
  user = null; const view = render(<CheckoutForm />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm & Place Order" })).toHaveProperty("disabled", false));
  expect(screen.getByLabelText("Street Address *")).toHaveProperty("value", ""); expect(screen.getByLabelText("City *")).toHaveProperty("value", "");
  fireEvent.submit(view.container.querySelector("form")!); await screen.findByRole("alert"); expect(createOrder).not.toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls.every(([url]) => url === "/api/checkout/quote")).toBe(true);
});
