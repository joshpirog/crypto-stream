"use client";

import { useVwapSeries } from "@/lib/dataSource";
import type { LastPrice } from "@/lib/useTradeTape";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

const usd = (n?: number | null) =>
  n == null
    ? "—"
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-faint)]">{label}</div>
      <div className="tnum text-[13px] text-[var(--text)]">{value}</div>
    </div>
  );
}

function Tile({ symbol, live }: { symbol: string; live?: LastPrice }) {
  const { data } = useVwapSeries(symbol, 1);
  const m = data?.[data.length - 1];
  const [base, quote] = symbol.split("-");

  const dir = live?.dir ?? 0;
  const color = dir > 0 ? "var(--up)" : dir < 0 ? "var(--down)" : "var(--text)";
  const arrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "·";

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="tag">
          <b>{base}</b>
          <span className="text-[var(--text-faint)]">/{quote}</span>
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">VWAP {usd(m?.vwap)}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="tnum text-3xl font-bold"
          style={{ fontFamily: "var(--font-display)", color }}
        >
          {live ? usd(live.price) : "—"}
        </span>
        <span className="text-sm" style={{ color }}>
          {arrow}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="σ price" value={m?.stddev_price != null ? m.stddev_price.toFixed(2) : "—"} />
        <Stat label="volume" value={m?.volume != null ? m.volume.toFixed(3) : "—"} />
        {/* A real gold window always has a positive count, so 0 only ever means
            "unknown" — a window backfilled from a candle, which carries no trade
            detail. Show a dash rather than a misleading zero. */}
        <Stat label="trades" value={m?.trade_count ? String(m.trade_count) : "—"} />
      </div>
    </div>
  );
}

export default function TickerTiles({ last }: { last: Record<string, LastPrice> }) {
  return (
    <>
      {SYMBOLS.map((s) => (
        <Tile key={s} symbol={s} live={last[s]} />
      ))}
    </>
  );
}
