/** @jest-environment jsdom */
import React from "react";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "@/components/ui/modal";

beforeEach(() => { jest.useFakeTimers(); document.body.style.overflow = "scroll"; });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); document.body.style.overflow = ""; });

it("traps keyboard focus, restores the trigger and retains an inert closing animation", () => {
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  const close = jest.fn();
  const view = render(<Modal isOpen onClose={close} aria-label="Confirm operation"><button>First action</button><button>Last action</button></Modal>);
  const dialog = screen.getByRole("dialog", { name: "Confirm operation" });
  expect(document.activeElement).toBe(dialog); expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last action" }));
  fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(screen.getByRole("button", { name: "First action" }));
  fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
  view.rerender(<Modal isOpen={false} onClose={close} aria-label="Confirm operation"><button>First action</button></Modal>);
  expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe("scroll");
  expect(dialog.parentElement?.getAttribute("aria-hidden")).toBe("true"); expect(dialog.parentElement?.hasAttribute("inert")).toBe(true);
  act(() => jest.advanceTimersByTime(299)); expect(document.body.contains(dialog)).toBe(true);
  act(() => jest.advanceTimersByTime(1)); expect(document.querySelector('[role="dialog"]')).toBeNull();
  trigger.remove();
});

it("keeps an empty dialog focused and cancels delayed removal when reopened", () => {
  const close = jest.fn(), content = <p>Read this operation description.</p>;
  const view = render(<Modal isOpen={false} onClose={close}>{content}</Modal>);
  view.rerender(<Modal isOpen onClose={close}>{content}</Modal>);
  const dialog = screen.getByRole("dialog");
  const tab = createEvent.keyDown(document, { key: "Tab", cancelable: true }); fireEvent(document, tab);
  expect(tab.defaultPrevented).toBe(true); expect(document.activeElement).toBe(dialog);
  view.rerender(<Modal isOpen={false} onClose={close}>{content}</Modal>);
  act(() => jest.advanceTimersByTime(100));
  view.rerender(<Modal isOpen onClose={close}>{content}</Modal>);
  act(() => jest.advanceTimersByTime(500));
  expect(screen.getByRole("dialog")).toBe(dialog); expect(document.body.style.overflow).toBe("hidden");
  view.unmount(); expect(document.body.style.overflow).toBe("scroll"); expect(jest.getTimerCount()).toBe(0); expect(close).not.toHaveBeenCalled();
});
