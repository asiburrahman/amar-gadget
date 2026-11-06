"use client";

import React, { createContext, useContext, useId, useState } from "react";

interface ChildrenProps { className?: string; children: React.ReactNode }
interface TabsProps extends ChildrenProps { defaultIndex?: number; onValueChange?: (index: number) => void }
interface TabProps extends ChildrenProps { disabled?: boolean; index?: number }
interface PanelProps extends ChildrenProps { index?: number }
const TabsContext = createContext<{ id: string; value: number; select: (index: number) => void } | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tab components require a Tabs parent");
  return context;
}

function flatten(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<ChildrenProps>(child) && child.type === React.Fragment
      ? flatten(child.props.children) : [child],
  );
}

function findControls(children: React.ReactNode): React.ReactElement<TabProps>[] {
  for (const child of flatten(children)) {
    if (!React.isValidElement<ChildrenProps>(child) || child.type === Tabs) continue;
    if (child.type === TabList) return flatten(child.props.children).filter((tab): tab is React.ReactElement<TabProps> =>
      React.isValidElement<TabProps>(tab) && tab.type === Tab,
    );
    const found = findControls(child.props.children);
    if (found.length) return found;
  }
  return [];
}

export function Tabs({ children, className = "", defaultIndex = 0, onValueChange }: TabsProps) {
  const id = useId();
  const [selected, setSelected] = useState(defaultIndex);
  const controls = findControls(children);
  const value = controls[selected] && !controls[selected].props.disabled
    ? selected : controls.findIndex((tab) => !tab.props.disabled);
  const select = (index: number) => {
    if (!controls[index] || controls[index].props.disabled || index === value) return;
    setSelected(index);
    onValueChange?.(index);
  };
  return <TabsContext.Provider value={{ id, value, select }}><div className={className}>{children}</div></TabsContext.Provider>;
}

export function TabList({ children, className = "" }: ChildrenProps) {
  const tabs = flatten(children).filter((child): child is React.ReactElement<TabProps> =>
    React.isValidElement<TabProps>(child) && child.type === Tab,
  );
  return <div role="tablist" className={`flex items-center border-b border-background ${className}`}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const enabled = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
      const current = enabled.indexOf(event.target as HTMLButtonElement);
      if (current < 0 || !enabled.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next].focus(); enabled[next].click();
    }}>
    {tabs.map((tab, index) => React.cloneElement(tab, { index }))}
  </div>;
}

export function Tab({ children, className = "", disabled = false, index }: TabProps) {
  const tabs = useTabs();
  if (index === undefined) throw new Error("Tab requires a TabList parent");
  const active = tabs.value === index;
  return <button type="button" role="tab" id={`${tabs.id}-tab-${index}`} aria-controls={`${tabs.id}-panel-${index}`}
    aria-selected={active} disabled={disabled} tabIndex={active ? 0 : -1} onClick={() => tabs.select(index)}
    className={`inline-flex items-center justify-center rounded-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border-b-2 ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground"} ${className}`}>
    {children}
  </button>;
}

export function TabPanels({ children, className = "" }: ChildrenProps) {
  const panels = flatten(children).filter((child): child is React.ReactElement<PanelProps> =>
    React.isValidElement<PanelProps>(child) && child.type === TabPanel,
  );
  return <div className={className}>{panels.map((panel, index) => React.cloneElement(panel, { index }))}</div>;
}

export function TabPanel({ children, className = "", index }: PanelProps) {
  const tabs = useTabs();
  if (index === undefined) throw new Error("TabPanel requires a TabPanels parent");
  const hidden = tabs.value !== index;
  return <div role="tabpanel" id={`${tabs.id}-panel-${index}`} aria-labelledby={`${tabs.id}-tab-${index}`}
    tabIndex={0} hidden={hidden} inert={hidden} style={hidden ? { display: "none" } : undefined} className={className}>{children}</div>;
}
