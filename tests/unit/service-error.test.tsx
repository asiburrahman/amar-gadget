/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import AppError from "@/app/error";
import MarketingError from "@/app/(marketing)/error";
import ProductError from "@/app/(marketing)/products/[slug]/error";
const reference = "fb13b340-261c-4b42-a3b8-f50a6009f0ee";
it("uses Next's refetching retry contract and displays a safe reference instead of original error data", () => {
  const retry = jest.fn(), error = Object.assign(new Error("private SQL and password"), { digest: reference }); render(<AppError error={error} retry={retry} />);
  expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.getByText(reference)).toBeTruthy(); expect(screen.queryByText(/private SQL/)).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalledTimes(1); expect(screen.getByRole("link").getAttribute("href")).toBe("/");
});
it("provides marketing recovery without dumping malformed exception values", () => {
  const retry = jest.fn(); render(<MarketingError error={{ digest: "private-token", message: "credentials" }} retry={retry} />); expect(screen.queryByText("private-token")).toBeNull(); expect(screen.queryByText("credentials")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalledTimes(1);
});
it("keeps product navigation and refetch recovery available during a service failure", () => {
  const retry = jest.fn(); render(<ProductError error={{ digest: "12345678" }} retry={retry} />); expect(screen.getByRole("heading", { name: "Product temporarily unavailable" })).toBeTruthy(); expect(screen.getByRole("link", { name: "Browse products" }).getAttribute("href")).toBe("/products"); fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(retry).toHaveBeenCalledTimes(1);
});
