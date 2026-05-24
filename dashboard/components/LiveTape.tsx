"use client";

import type { Trade } from "@/lib/useTradeTape";

const COLS = "grid-cols-[68px_72px_52px_1fr_1fr]";

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return "--:--:--";
  }
};
const fmtPrice = (p: number) =>
  p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSize = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 6 });

export default function LiveTape({ trades }: { trades: Trade[] }) {
  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="tag">
          [ <b>TAPE</b> · raw coinbase stream ]
        </span>
        <span className="tag text-[var(--text-faint)]">{trades.length} ROWS</span>
      </div>

      <div
        className={`grid ${COLS} gap-2 border-y border-[var(--border)] px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]`}
      >
        <span>Time</span>
        <span>Symbol</span>
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {trades.map((t) => {
          const up = t.side === "buy";
          const color = up ? "var(--up)" : "var(--down)";
          return (
            <div
              key={t.id}
              className={`grid ${COLS} gap-2 px-4 py-[5px] text-[12.5px] ${
                up ? "row-in-up" : "row-in-down"
              }`}
            >
              <span className="tnum text-[var(--text-faint)]">{fmtTime(t.time)}</span>
              <span className="text-[var(--text-dim)]">{t.symbol}</span>
              <span style={{ color }}>{up ? "BUY" : "SELL"}</span>
              <span className="tnum text-right" style={{ color }}>
                {fmtPrice(t.price)}
              </span>
              <span className="tnum text-right text-[var(--text-dim)]">{fmtSize(t.size)}</span>
            </div>
          );
        })}
        {trades.length === 0 && (
          <div className="px-4 py-8 text-center text-[var(--text-faint)]">
            <span className="tag blink">awaiting stream…</span>
          </div>
        )}
      </div>
    </div>
  );
}
