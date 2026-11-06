/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Dropdown } from "@/components/ui/dropdown";

it("opens from the keyboard, focuses content and returns focus on Escape", () => {
  const change = jest.fn(); render(<Dropdown trigger="Actions" onOpenChange={change}><button>Download</button></Dropdown>);
  const trigger = screen.getByRole("button", { name: "Actions" }); trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download" }));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("dialog", { name: "Actions" }).id).toBe(trigger.getAttribute("aria-controls"));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(change.mock.calls.map(([value]) => value)).toEqual([false, true, false]);
});

it("dismisses on outside pointer or focus without stealing focus and honors disabled", () => {
  const view = render(<><Dropdown trigger="Actions"><button>Download</button></Dropdown><button>Outside</button></>);
  const trigger = screen.getByRole("button", { name: "Actions" }); const outside = screen.getByRole("button", { name: "Outside" });
  fireEvent.click(trigger); fireEvent.pointerDown(outside); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger); act(() => outside.focus()); expect(document.activeElement).toBe(outside);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Dropdown trigger="Actions" disabled><button>Download</button></Dropdown>);
  fireEvent.click(screen.getByRole("button", { name: "Actions" })); expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Dropdown trigger="Actions"><button>Download</button></Dropdown>);
  fireEvent.click(screen.getByRole("button", { name: "Actions" })); expect(screen.getByRole("dialog")).toBeTruthy();
  view.rerender(<Dropdown trigger="Actions" disabled><button>Download</button></Dropdown>);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Dropdown trigger="Actions"><button>Download</button></Dropdown>);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("uses offsets, flips above an anchor near the bottom and clamps horizontal overflow", () => {
  const rect = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return (this.tagName === "BUTTON"
      ? { left: 980, right: 1020, top: 700, bottom: 740, width: 40, height: 40 }
      : { left: 0, right: 224, top: 0, bottom: 120, width: 224, height: 120 }) as DOMRect;
  });
  try {
    render(<Dropdown trigger="Actions" align="end" sideOffset={8} collisionPadding={12} paddingOffset={6} className="custom-root"><button>Download</button></Dropdown>);
    const trigger = screen.getByRole("button", { name: "Actions" }); fireEvent.click(trigger);
    const content = screen.getByRole("dialog");
    expect(content.style.left).toBe("788px"); expect(content.style.top).toBe("572px");
    expect(content.style.padding).toBe("6px"); expect(trigger.parentElement?.className).toContain("custom-root");
    expect(content.parentElement).toBe(document.body);
  } finally { rect.mockRestore(); }
});
