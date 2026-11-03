/** @jest-environment jsdom */
jest.mock("@/lib/support-contact", () => ({ readPublicSupportContact: jest.fn() }));
import { render, screen } from "@testing-library/react";
import { PublicContactDetails } from "@/components/support/public-contact-details";
import { readPublicSupportContact } from "@/lib/support-contact";
beforeEach(() => { jest.clearAllMocks(); });
it("shows the saved public values as escaped text and safe mail/telephone destinations", async () => {
  (readPublicSupportContact as jest.Mock).mockResolvedValue({ email: "support@example.invalid", phone: "+880 (1700) 123456", address: "Office <script>private()</script>", hours: "Sunday to Thursday", published: true });
  const view = render(await PublicContactDetails({}));
  expect(screen.getByRole("link", { name: "support@example.invalid" }).getAttribute("href")).toBe("mailto:support%40example.invalid");
  expect(screen.getByRole("link", { name: "+880 (1700) 123456" }).getAttribute("href")).toBe("tel:+8801700123456"); expect(view.container.querySelector("script")).toBeNull(); expect(screen.getByText(/Office <script>/)).toBeTruthy(); expect(screen.getByText("Sunday to Thursday")).toBeTruthy();
});
it("omits unpublished/unconfigured values and gives the footer a working contact destination", async () => {
  (readPublicSupportContact as jest.Mock).mockResolvedValue(null); expect(await PublicContactDetails({})).toBeNull(); render(await PublicContactDetails({ compact: true })); expect(screen.getByRole("link", { name: "Send a support inquiry" }).getAttribute("href")).toBe("/contact");
});
it("reports unavailable details without a fake contact or raw diagnostics", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { (readPublicSupportContact as jest.Mock).mockRejectedValue(Error("private database configuration")); render(await PublicContactDetails({})); expect(screen.getByRole("alert")).toBeTruthy(); expect(JSON.stringify(log.mock.calls)).not.toContain("private database configuration"); }
  finally { log.mockRestore(); }
});
