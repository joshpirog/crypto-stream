import type { VwapMetric } from "@/lib/types";
import { MAX_WINDOWS, WINDOW_MS } from "./config";

// Coinbase's public candles endpoint — no auth, and it answers with
// `access-control-allow-origin: *`, so the browser can call it directly.
// Response is newest-first: [ time(sec), low, high, open, close, volume ].
const CANDLES_URL = (symbol: string) =>
  `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=60`;

type Candle = [number, number, number, number, number, number];

export interface Seed {
  windows: VwapMetric[];
  /** Closing price per minute, oldest first — seeds the z-score baseline. */
  prices: { t: number; price: number }[];
}

/**
 * Seeds the chart and the anomaly baseline with real recent history, so a fresh
 * page load isn't a blank panel waiting a minute for its first window to close.
 *
 * Caveat, deliberately not hidden: a 1-minute OHLCV candle does not carry the
 * per-trade detail the pipeline aggregates, so seeded windows use the standard
 * typical-price proxy `(high + low + close) / 3` for VWAP and a range estimate
 * for the std dev. Windows sealed from the live socket after load are computed
 * exactly as the gold layer computes them. `trade_count: 0` marks a seeded row.
 */
export async function fetchSeed(symbol: string, signal?: AbortSignal): Promise<Seed> {
  const res = await fetch(CANDLES_URL(symbol), { signal });
  if (!res.ok) throw new Error(`candles ${symbol}: ${res.status}`);

  const raw = (await res.json()) as Candle[];
  if (!Array.isArray(raw)) throw new Error(`candles ${symbol}: unexpected payload`);

  // Oldest first for charting; trim to the window cap.
  const candles = [...raw].sort((a, b) => a[0] - b[0]).slice(-MAX_WINDOWS);

  const windows: VwapMetric[] = candles.map(([t, low, high, open, close, volume]) => {
    const startMs = t * 1000;
    const window_start = new Date(startMs).toISOString();
    return {
      id: `${symbol}-${window_start}`,
      symbol,
      window_start,
      window_end: new Date(startMs + WINDOW_MS).toISOString(),
      vwap: (high + low + close) / 3,
      avg_price: (open + high + low + close) / 4,
      // Range-based sigma estimate; the live path uses the true sample std dev.
      stddev_price: (high - low) / 4,
      low,
      high,
      volume,
      trade_count: 0,
    };
  });

  const prices = candles.map(([t, , , , close]) => ({ t: t * 1000, price: close }));

  return { windows, prices };
}
