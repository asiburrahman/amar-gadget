/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabList, Tab, TabPanels, TabPanel } from "@/components/ui/tabs";

function Example({ change, defaultIndex = 0 }: { change?: (index: number) => void; defaultIndex?: number }) {
  return <Tabs defaultIndex={defaultIndex} onValueChange={change}>
    <TabList><Tab>Overview</Tab><Tab disabled>Unavailable</Tab><Tab>Details</Tab></TabList>
    <TabPanels><TabPanel><input aria-label="Draft" /></TabPanel><TabPanel>Disabled content</TabPanel><TabPanel>Technical details</TabPanel></TabPanels>
  </Tabs>;
}

it("selects the linked panel and preserves drafts across switches", () => {
  const change = jest.fn(); render(<Example change={change} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "Keep this" } });
  const details = screen.getByRole("tab", { name: "Details" }); fireEvent.click(details);
  expect(screen.getByRole("tabpanel", { name: "Details" }).id).toBe(details.getAttribute("aria-controls"));
  expect(details.getAttribute("aria-selected")).toBe("true"); expect(screen.queryByRole("textbox")).toBeNull();
  expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
  expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Keep this");
});

it("wraps arrow navigation, skips disabled tabs and supports Home and End", () => {
  render(<Example />);
  const overview = screen.getByRole("tab", { name: "Overview" }); const details = screen.getByRole("tab", { name: "Details" });
  overview.focus(); fireEvent.keyDown(overview, { key: "ArrowRight" }); expect(document.activeElement).toBe(details);
  fireEvent.keyDown(details, { key: "ArrowRight" }); expect(document.activeElement).toBe(overview);
  fireEvent.keyDown(overview, { key: "End" }); expect(document.activeElement).toBe(details);
  fireEvent.keyDown(details, { key: "Home" }); expect(document.activeElement).toBe(overview);
  fireEvent.keyDown(overview, { key: "ArrowLeft" }); expect(document.activeElement).toBe(details);
});

it("uses the first enabled tab when the requested default is disabled", () => {
  render(<Example defaultIndex={1} />);
  expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeTruthy();
});
