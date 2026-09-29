"use client";

import clsx from "clsx";
import { Check, CircleHelp, Loader2, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { VerdictStatus } from "@/lib/verify";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand text-white hover:brightness-110",
        variant === "secondary" && "border border-border bg-panel text-text hover:bg-panel-2",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-text",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className ?? "size-3.5")} />;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx("flex gap-1 border-b border-border", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            value === it.value ? "border-brand text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const STATUS_STYLE: Record<VerdictStatus, { text: string; bg: string; label: string }> = {
  verified: { text: "text-ok", bg: "bg-ok-soft", label: "Verified" },
  contradicted: { text: "text-bad", bg: "bg-bad-soft", label: "Contradicted" },
  unverifiable: { text: "text-warn", bg: "bg-warn-soft", label: "Unverifiable" },
};

export function StatusIcon({ status, className }: { status: VerdictStatus; className?: string }) {
  const cls = clsx(STATUS_STYLE[status].text, className ?? "size-3");
  if (status === "verified") return <Check className={cls} strokeWidth={3} />;
  if (status === "contradicted") return <X className={cls} strokeWidth={3} />;
  return <CircleHelp className={cls} strokeWidth={2.5} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-panel-2 px-1 py-px font-mono text-[10px] text-muted">{children}</kbd>
  );
}
