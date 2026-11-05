/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Pagination } from "@/components/ui/pagination";

it("shows every small page including the formerly missing middle page", () => {
  const change = jest.fn(); render(<Pagination currentPage={2} totalPages={3} onPageChange={change} />);
  expect(screen.getByRole("button", { name: "2", current: "page" }).getAttribute("aria-current")).toBe("page");
  expect((screen.getByRole("button", { name: "2" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "3" })); expect(change).toHaveBeenLastCalledWith(3);
  fireEvent.click(screen.getByRole("button", { name: "Previous" })); expect(change).toHaveBeenLastCalledWith(1);
});

it("keeps distant boundaries and current neighbors reachable without duplicate page buttons", () => {
  const change = jest.fn(); render(<Pagination currentPage={50} totalPages={100} onPageChange={change} />);
  const pages = screen.getAllByRole("button").map((button) => button.textContent).filter((value) => /^\d+$/.test(value ?? ""));
  expect(pages).toEqual(["1", "49", "50", "51", "100"]);
  fireEvent.click(screen.getByRole("button", { name: "100" })); expect(change).toHaveBeenLastCalledWith(100);
});

it("clamps stale page inputs and disables navigation beyond the available range", () => {
  const change = jest.fn(); const view = render(<Pagination currentPage={999} totalPages={5} onPageChange={change} />);
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Previous" })); expect(change).toHaveBeenLastCalledWith(4);
  view.rerender(<Pagination currentPage={0} totalPages={5} onPageChange={change} />);
  expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<Pagination currentPage={1} totalPages={1} onPageChange={change} />);
  expect(screen.queryByRole("navigation")).toBeNull();
});
