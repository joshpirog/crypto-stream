"use client";

import { usePipelineHealth } from "@/lib/dataSource";

function parseUtcMs(s: string): number {
  let iso = s.includes("T") ? s : s.replace(" ", "T");
  if (!iso.endsWith("Z")) iso += "Z";
  return new Date(iso).getTime();
}

export default function HealthPanel() {
  const { data } = usePipelineHealth();

  const updatedAgo = data
    ? Math.max(0, Math.round((Date.now() - parseUtcMs(data.updated_at)) / 1000))
    : null;
  const hasEvent = data?.last_event_time && data.last_event_time !== "None";
  // Clamped at 0: a negative processing lag is meaningless, and the two timestamps
  // come from different clocks (Coinbase stamps the event, we stamp the write), so
  // any skew between them can push the difference below zero.
  const lagSec =
    data && hasEvent
      ? Math.max(
          0,
          Math.round((parseUtcMs(data.updated_at) - parseUtcMs(data.last_event_time)) / 1000)
        )
      : null;

  const dotClass =
    updatedAgo == null
      ? "live-dot amber"
      : updatedAgo < 30
        ? "live-dot"
        : updatedAgo < 120
          ? "live-dot amber"
          : "live-dot down";
  const lagColor =
    lagSec == null
      ? "var(--text-dim)"
      : lagSec < 60
        ? "var(--up)"
        : lagSec < 600
          ? "var(--amber)"
          : "var(--down)";

  return (
    <div className="panel flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <span className="tag">
          [ <b>PIPELINE</b> · health ]
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={dotClass} />
          <span className="tag text-[var(--text-dim)]">
            {updatedAgo == null ? "no signal" : `${updatedAgo}s ago`}
          </span>
        </span>
      </div>

      <div className="mt-5">
        <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-faint)]">
          events / batch
        </div>
        <div
          className="tnum text-4xl font-bold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {data ? data.events_last_batch.toLocaleString() : "—"}
        </div>
      </div>

      <div className="mt-auto space-y-2 pt-4">
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            processing lag
          </span>
          <span className="tnum text-sm" style={{ color: lagColor }}>
            {lagSec == null ? "—" : `${lagSec}s`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            last event
          </span>
          <span className="tnum truncate pl-2 text-[11px] text-[var(--text-faint)]">
            {data?.last_event_time ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
