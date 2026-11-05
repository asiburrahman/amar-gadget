/** @jest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/toast";

const firstClosed = jest.fn(), replacementClosed = jest.fn();
function Controls() {
  const { toast } = useToast();
  return <>
    <button onClick={() => toast({ title: "Saved changes", duration: 100, onClose: firstClosed })}>Notify</button>
    <button onClick={() => toast({ title: "Replacement message", duration: 200, onClose: replacementClosed })}>Replace</button>
    <button onClick={() => toast({ title: "Close callback source", onClose: () => toast({ title: "Newer callback message" }) })}>Notify with callback</button>
  </>;
}
function view() { return render(<React.StrictMode><ToastProvider><Controls /></ToastProvider></React.StrictMode>); }
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

it("shares notifications with the provider and dismisses them once", () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "Notify" }));
  expect(screen.getByRole("alert").textContent).toContain("Saved changes");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).toBeNull();
  act(() => jest.advanceTimersByTime(500));
  expect(firstClosed).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it("replaces a notification without allowing its old timer to close the newer one", () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "Notify" }));
  act(() => jest.advanceTimersByTime(50)); fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(firstClosed).toHaveBeenCalledTimes(1); expect(screen.getAllByRole("alert")).toHaveLength(1);
  act(() => jest.advanceTimersByTime(50)); expect(screen.getByRole("alert").textContent).toContain("Replacement message");
  act(() => jest.advanceTimersByTime(150)); expect(screen.queryByRole("alert")).toBeNull(); expect(replacementClosed).toHaveBeenCalledTimes(1);
});

it("clears owned timers on unmount without inventing a dismissal callback", () => {
  const rendered = view(); fireEvent.click(screen.getByRole("button", { name: "Notify" }));
  expect(jest.getTimerCount()).toBe(1); rendered.unmount();
  expect(jest.getTimerCount()).toBe(0); expect(firstClosed).not.toHaveBeenCalled();
});

it("keeps a newer notification emitted by a replacement callback", () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "Notify with callback" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(screen.getAllByRole("alert")).toHaveLength(1); expect(screen.getByRole("alert").textContent).toContain("Newer callback message");
  act(() => jest.advanceTimersByTime(500)); expect(screen.getByRole("alert").textContent).toContain("Newer callback message");
});
