import { renderToStaticMarkup } from "react-dom/server";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import UnauthorizedPage from "@/app/(auth)/unauthorized/page";
import OrderSuccessEntryPage from "@/app/(marketing)/order-success/page";
import { POST as customerPortal } from "@/app/api/stripe/customer-portal/route";
import { getCurrentUser } from "@/lib/session";

jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`); } }));
beforeEach(() => { jest.clearAllMocks(); (getCurrentUser as jest.Mock).mockResolvedValue(null); });

it("redirects only a single valid email to the actual OTP flow with encoded query values", async () => {
  await expect(VerifyEmailPage({ searchParams: Promise.resolve({ email: "owner+shop@example.invalid" }) })).rejects.toThrow("REDIRECT:/verify-otp?email=owner%2Bshop%40example.invalid");
  for (const email of [undefined, "https://other.invalid", ["first@example.invalid", "second@example.invalid"]]) {
    const html = renderToStaticMarkup(await VerifyEmailPage({ searchParams: Promise.resolve({ email }) }));
    expect(html).toContain('action="/verify-email"'); expect(html).toContain("Opening this page does not verify an account or send an email.");
    expect(html).toContain('href="/register"');
  }
});

it("routes legacy order IDs to the protected confirmation page without trusting client payment claims", async () => {
  const id = "fb13b340-261c-4b42-a3b8-f50a6009f0ee";
  for (const query of [{ id }, { orderId: id }]) {
    await expect(OrderSuccessEntryPage({ searchParams: Promise.resolve({ ...query, paid: "true", status: "PAID" }) })).rejects.toThrow(`REDIRECT:/order-success/${id}`);
  }
  for (const query of [{}, { id: "../private" }, { id: [id, id] }, { id, orderId: id }, { paid: "true" }]) {
    const html = renderToStaticMarkup(await OrderSuccessEntryPage({ searchParams: Promise.resolve(query) }));
    expect(html).toContain("It does not confirm that an order was placed or paid."); expect(html).toContain('href="/track-order"');
  }
});

it.each([["ADMIN", "/admin"], ["MEMBER", "/member/dashboard"], ["USER", "/user/dashboard"]])("offers only the current %s role's dashboard", async (role, path) => {
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: "private-user-id", email: "private@example.invalid", role });
  const html = renderToStaticMarkup(await UnauthorizedPage());
  expect(html).toContain(`href="${path}"`); expect(html).not.toContain("private@example.invalid"); expect(html).not.toContain("private-user-id");
});

it("provides sign-in help without treating an authentication service failure as an anonymous session", async () => {
  expect(renderToStaticMarkup(await UnauthorizedPage())).toContain("Sign in with the account");
  (getCurrentUser as jest.Mock).mockRejectedValue(Error("Session service unavailable"));
  await expect(UnauthorizedPage()).rejects.toThrow("Session service unavailable");
});

it("returns an explicit retired customer-portal contract with actual order and support destinations", async () => {
  const result = await customerPortal(); expect(result.status).toBe(410);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.json()).toMatchObject({ success: false, code: "CUSTOMER_PORTAL_UNSUPPORTED", ordersPath: "/user/orders", supportPath: "/contact" });
});
