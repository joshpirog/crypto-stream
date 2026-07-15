"use client";

import { useLive } from "@/lib/useLive";
import type { Anomaly, AnomalyType } from "@/lib/types";

const COLS = "grid-cols-[68px_70px_110px_1fr_1fr_64px]";

const accent = (t: AnomalyType): string =>
  t === "whale" ? "var(--amber)" : t === "price_spike" ? "var(--down)" : "var(--cyan)";

const fmtTime = (iso: string) => {
  try {
    return new Date(iso.endsWith("Z") ? iso : `${iso}Z`).toISOString().slice(11, 19);
  } catch {
    return "--:--:--";
  }
};
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function AnomalyFeed() {
  const { data } = useLive<Anomaly[]>("/api/anomalies?limit=25");
  const rows = data ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between pb-3">
        <span className="tag">
          [ <b>ANOMALIES</b> · z-score &amp; whale detection ]
        </span>
      </div>

      {/* Dense 6-col grid can't fit a phone; scroll it sideways as one unit
          (header + rows share the min-width) while rows keep vertical scroll. */}
      <div className="overflow-x-auto">
        <div className="min-w-[540px]">
          <div
            className={`grid ${COLS} gap-2 border-y border-[var(--border)] py-1.5 text-[10px] uppercase tracking-[0.15em] text-[var(--text-faint)]`}
          >
            <span>Time</span>
            <span>Symbol</span>
            <span>Type</span>
            <span className="text-right">Price</span>
            <span className="text-right">Notional</span>
            <span className="text-right">Z</span>
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            {rows.map((a) => {
              const c = accent(a.anomaly_type);
              return (
                <div
                  key={a.id}
                  className={`grid ${COLS} items-center gap-2 border-b border-[var(--border)] py-2 text-[12.5px]`}
                >
                  <span className="tnum text-[var(--text-faint)]">{fmtTime(a.event_time)}</span>
                  <span className="text-[var(--text-dim)]">{a.symbol}</span>
                  <span
                    className="justify-self-start rounded-[2px] border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.1em]"
                    style={{ color: c, borderColor: c }}
                  >
                    {a.anomaly_type}
                  </span>
                  <span className="tnum text-right text-[var(--text)]">{usd(a.price)}</span>
                  <span className="tnum text-right text-[var(--text-dim)]">{usd(a.notional)}</span>
                  <span className="tnum text-right" style={{ color: c }}>
                    {a.zscore?.toFixed(1)}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="py-8 text-center">
                <span className="tag text-[var(--text-faint)]">no anomalies detected yet</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
