import React from "react";
import { cn } from "@/lib/utils";

export type SourceStatus = "loaded" | "stale" | "unavailable" | "error";

const STATUS_CLASSES: Record<SourceStatus, string> = {
  loaded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  stale: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  unavailable: "border-muted-foreground/25 bg-secondary/70 text-muted-foreground",
  error: "border-destructive/35 bg-destructive/10 text-destructive",
};

interface SourceStatusBadgeProps {
  status: SourceStatus;
  className?: string;
}

export function SourceStatusBadge({ status, className }: SourceStatusBadgeProps) {
  return (
    <span
      aria-label={`source ${status}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded border px-1.5 font-mono text-[9px] font-bold uppercase leading-none tracking-wider",
        STATUS_CLASSES[status],
        className
      )}
    >
      {status}
    </span>
  );
}

export function formatContextDate(value: string | null | undefined): string {
  if (!value) {
    return "N/D";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
