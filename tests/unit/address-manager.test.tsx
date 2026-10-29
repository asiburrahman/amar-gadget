/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddressManager } from "@/components/account/address-manager";
import type { SavedAddress } from "@/lib/validations/address";
const address: SavedAddress = { id: "11111111-1111-4111-8111-111111111111", version: 3, fullName: "Home recipient", phone: "01700000000", street: "Home road 12", city: "Dhaka", district: "Dhaka", zipCode: "1200", isDefault: true };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn().mockResolvedValue(response({ success: true, addresses: [address], defaultAddress: address, page: 1, total: 1, totalPages: 1 })); });
it("edits an actual selected row with its revision and preserves the form when the server rejects a stale save", async () => {
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => Promise.resolve(init.method ? response({ success: false, message: "Address changed. Reload first." }, false) : response({ success: true, addresses: [address], defaultAddress: address, page: 1, total: 1, totalPages: 1 })));
  render(<AddressManager ownerId="owner" />); fireEvent.click(await screen.findByRole("button", { name: "Edit address for Home recipient" }));
  fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "Changed road 23" } }); fireEvent.click(screen.getByRole("button", { name: "Save address changes" }));
  await screen.findByText("Address changed. Reload first."); expect(screen.getByLabelText("Street address")).toHaveProperty("value", "Changed road 23");
  const [, request] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "PUT"); expect(JSON.parse(request.body)).toMatchObject({ id: address.id, version: 3, fields: { street: "Changed road 23" } });
  expect(screen.queryByText("Address saved.")).toBeNull();
});
it("requires inline removal confirmation, sends only the owned row revision and reloads after success", async () => {
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => Promise.resolve(response(init.method ? { success: true, address: null } : { success: true, addresses: [address], defaultAddress: address, page: 1, total: 1, totalPages: 1 })));
  render(<AddressManager ownerId="owner" />); fireEvent.click(await screen.findByRole("button", { name: "Remove address for Home recipient" }));
  expect((fetch as jest.Mock).mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" })); await screen.findByText("Address removed. Your other saved addresses remain available.");
  const [, request] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "DELETE"); expect(JSON.parse(request.body)).toEqual({ id: address.id, version: 3 });
  await waitFor(() => expect((fetch as jest.Mock).mock.calls.filter(([, init]) => !init.method).length).toBeGreaterThan(1));
});
it("creates an explicit address/default request and clears the draft only after server success", async () => {
  (fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => Promise.resolve(response(init.method ? { success: true, address } : { success: true, addresses: [], defaultAddress: null, page: 1, total: 0, totalPages: 0 })));
  render(<AddressManager ownerId="owner" />); await screen.findByText("No saved addresses. Enter your shipping details below.");
  for (const [label, value] of [["Full name", "New recipient"], ["Phone number", "01700000000"], ["Street address", "New road 12"], ["City", "Dhaka"], ["District / Division", "Dhaka"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText("Make this my default address")); fireEvent.click(screen.getByRole("button", { name: "Add address" }));
  await screen.findByText("Address saved."); expect(screen.getByLabelText("Street address")).toHaveProperty("value", "");
  const [, request] = (fetch as jest.Mock).mock.calls.find(([, init]) => init.method === "POST"); expect(JSON.parse(request.body)).toMatchObject({ makeDefault: true, fields: { fullName: "New recipient", street: "New road 12" } });
});
