"use client";

import type { TapeStatus } from "@/lib/useTradeTape";

export default function LiveBadge({ status }: { status: TapeStatus }) {
  const label = status === "live" ? "LIVE" : status === "connecting" ? "SYNC" : "DOWN";
  const dotClass =
    status === "live" ? "live-dot" : status === "connecting" ? "live-dot amber" : "live-dot down";
  const color =
    status === "live" ? "var(--up)" : status === "connecting" ? "var(--amber)" : "var(--down)";

  return (
    <span className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1">
      <span className={dotClass} />
      <span className={`tag ${status === "live" ? "blink" : ""}`} style={{ color }}>
        {label}
      </span>
    </span>
  );
}
