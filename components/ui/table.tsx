import React from "react";

const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <div className="overflow-x-auto">
      <table ref={ref} className={`${className} min-w-full divide-y divide-border`} {...props} />
    </div>
  );
});

Table.displayName = "Table";

const TableHead = React.forwardRef<
  HTMLTableSectionElement,
  React.TableHTMLAttributes<HTMLTableSectionElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <thead
      ref={ref}
      className={`${className} bg-muted text-left text-xs font-medium text-muted-foreground uppercase tracking-wider`}
      {...props}
    />
  );
});

TableHead.displayName = "TableHead";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.TableHTMLAttributes<HTMLTableSectionElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <tbody ref={ref} className={`${className} bg-background divide-y divide-border`} {...props} />
  );
});

TableBody.displayName = "TableBody";

const TableFoot = React.forwardRef<
  HTMLTableSectionElement,
  React.TableHTMLAttributes<HTMLTableSectionElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <tfoot
      ref={ref}
      className={`${className} bg-muted text-left text-xs font-medium text-muted-foreground uppercase tracking-wider`}
      {...props}
    />
  );
});

TableFoot.displayName = "TableFoot";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & {
    className?: string;
    hoverable?: boolean;
  }
>(({ className, hoverable = true, ...props }, ref) => {
  return (
    <tr
      ref={ref}
      className={`${className} ${hoverable ? "hover:bg-muted/50" : ""} bg-background`}
      {...props}
    />
  );
});

TableRow.displayName = "TableRow";

const TableHeader = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <th
      ref={ref}
      scope="col"
      className={`${className} p-3 text-left text-sm`}
      {...props}
    />
  );
});

TableHeader.displayName = "TableHeader";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & {
    className?: string;
  }
>(({ className, ...props }, ref) => {
  return (
    <td ref={ref} className={`${className} p-3 text-left text-sm`} {...props} />
  );
});

TableCell.displayName = "TableCell";

export { Table, TableHead, TableBody, TableFoot, TableRow, TableHeader, TableCell };