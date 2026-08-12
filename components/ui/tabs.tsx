import React, { useState } from "react";

interface TabsProps {
  className?: string;
  children: React.ReactNode;
  defaultIndex?: number;
  onValueChange?: (index: number) => void;
}

interface TabListProps {
  className?: string;
  children: React.ReactNode;
}

interface TabProps {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

interface TabPanelsProps {
  className?: string;
  children: React.ReactNode;
}

interface TabPanelProps {
  className?: string;
  children: React.ReactNode;
}

export const Tabs = ({
  className = "",
  children,
  defaultIndex = 0,
  onValueChange,
}: TabsProps) => {
  const [value, setValue] = useState(defaultIndex);

  const handleValueChange = (index: number) => {
    setValue(index);
    onValueChange?.(index);
  };

  return (
    <div className={className}>
      <TabList className="flex border-b border-background">{children}</TabList>
      <TabPanels className="mt-4">
        {React.Children.map(children, (child, index) => {
          if (React.isValidElement(child) && child.type === Tab) {
            const tabChild = child as React.ReactElement<TabProps>;
            return index === value ? (
              <TabPanel className="block">{tabChild.props.children}</TabPanel>
            ) : (
              <TabPanel className="hidden">{tabChild.props.children}</TabPanel>
            );
          }
          return null;
        })}
      </TabPanels>
    </div>
  );
};

Tabs.displayName = "Tabs";

const TabList = ({ className = "", children }: TabListProps) => {
  return (
    <div
      role="tablist"
      className={`${className} flex-1 flex items-center justify-center whitespace-nowrap rounded-md`}
    >
      {children}
    </div>
  );
};

TabList.displayName = "TabList";

const Tab = ({
  className = "",
  children,
  disabled = false,
}: TabProps) => {
  return (
    <button
      role="tab"
      aria-selected={false}
      aria-disabled={disabled ? "true" : undefined}
      disabled={disabled}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium
        focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
        hover:bg-muted
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-200
        text-muted-foreground
        border-b-2 border-transparent
        ${className}
      `}
    >
      {children}
    </button>
  );
};

Tab.displayName = "Tab";

const TabPanels = ({ className = "", children }: TabPanelsProps) => {
  return <div className={className}>{children}</div>;
};

TabPanels.displayName = "TabPanels";

const TabPanel = ({ className = "", children }: TabPanelProps) => {
  return <div className={className}>{children}</div>;
};

TabPanel.displayName = "TabPanel";