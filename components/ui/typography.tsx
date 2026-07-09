import React from "react";
import { cn } from "@/lib/utils";

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export interface ParagraphProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export interface SpanProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export function H1({ children, className, ...props }: HeadingProps) {
  return (
    <h1
      className={cn("scroll-m-20 text-4xl font-bold tracking-tight lg:text-5xl font-sans", className)}
      {...props}
    >
      {children}
    </h1>
  );
}

export function H2({ children, className, ...props }: HeadingProps) {
  return (
    <h2
      className={cn(
        "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0 font-sans",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function H3({ children, className, ...props }: HeadingProps) {
  return (
    <h3
      className={cn("scroll-m-20 text-2xl font-semibold tracking-tight font-sans", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function H4({ children, className, ...props }: HeadingProps) {
  return (
    <h4
      className={cn("scroll-m-20 text-xl font-semibold tracking-tight font-sans", className)}
      {...props}
    >
      {children}
    </h4>
  );
}

export function P({ children, className, ...props }: ParagraphProps) {
  return (
    <p
      className={cn("leading-relaxed [&:not(:first-child)]:mt-6 font-inter text-base", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function Muted({ children, className, ...props }: SpanProps) {
  return (
    <span
      className={cn("text-sm text-muted-foreground font-inter", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function Code({ children, className, ...props }: CodeProps) {
  return (
    <code
      className={cn(
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </code>
  );
}
