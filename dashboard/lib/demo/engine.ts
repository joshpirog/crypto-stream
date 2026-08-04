import type { Anomaly, AnomalyType, PipelineHealth, VwapMetric } from "@/lib/types";
import type { Trade } from "@/lib/useTradeTape";
import type { Seed } from "./candles";
import {
  BASELINE_MS,
  BASELINE_SAMPLE_MS,
  EVENT_HISTORY_MS,
  MAX_ANOMALIES,
  MAX_WINDOWS,
  SYNTHETIC_LAG_JITTER_MS,
  SYNTHETIC_LAG_MS,
  WHALE_NOTIONAL,
  WHALE_NOTIONAL_DEFAULT,
  WINDOW_GRACE_MS,
  WINDOW_MS,
  Z_THRESHOLD,
} from "./config";

export interface EngineSnapshot {
  /** Chronological (oldest first), matching what `/api/vwap` returns. */
  vwap: Record<string, VwapMetric[]>;
  /** Newest first, matching what `/api/anomalies` returns. */
  anomalies: Anomaly[];
  health: PipelineHealth | null;
}

/** Welford accumulator — numerically stable mean/variance in a single pass. */
interface Accum {
  startMs: number;
  n: number;
  mean: number;
  m2: number;
  sumPxSz: number;
  sumSz: number;
  low: number;
  high: number;
}

interface SymState {
  open: Map<number, Accum>;
  sealed: Map<number, VwapMetric>;
  /** Trailing price samples backing the z-score baseline. */
  baseline: { t: number; price: number }[];
  lastSampleAt: number;
  stats: { mean: number; std: number } | null;
  statsDirty: boolean;
  seriesDirty: boolean;
  series: VwapMetric[];
}

const newSymState = (): SymState => ({
  open: new Map(),
  sealed: new Map(),
  baseline: [],
  lastSampleAt: 0,
  stats: null,
  statsDirty: true,
  seriesDirty: true,
  series: [],
});

const sampleStd = (n: number, m2: number): number | null =>
  n > 1 ? Math.sqrt(m2 / (n - 1)) : null;

/**
 * The health panel prints `last_event_time` verbatim, and the real sink writes it
 * as `str(<spark timestamp>)` — space-separated, no trailing Z. Match that shape
 * exactly so demo mode is visually indistinguishable from the live pipeline.
 */
const sparkTimestamp = (iso: string): string => iso.replace("T", " ").replace("Z", "");

/**
 * Reimplements the gold layer (`databricks/notebooks/gold_aggregate.py`) over the
 * browser's Coinbase socket: 1-minute tumbling VWAP windows, plus z-score and
 * whale anomaly detection against a trailing 30-minute baseline.
 *
 * Trades arrive faster than React should render, so everything accumulates here
 * and is published on `tick()` — the analogue of the pipeline's processing-time
 * trigger. Nothing in this class touches React.
 */
export class DemoEngine {
  private syms = new Map<string, SymState>();
  private anomalies: Anomaly[] = [];
  private anomalyIds = new Set<string>();
  private batchCount = 0;
  /** Ascending event times of recent trades, so `tick` can look back by the lag. */
  private eventTimes: number[] = [];
  private anomaliesDirty = false;
  /** Last published copy; kept so an unchanged feed doesn't re-render consumers. */
  private anomaliesOut: Anomaly[] = [];

  private sym(symbol: string): SymState {
    let s = this.syms.get(symbol);
    if (!s) {
      s = newSymState();
      this.syms.set(symbol, s);
    }
    return s;
  }

  /** Backfill a symbol with real recent history from the candles endpoint. */
  seed(symbol: string, seed: Seed): void {
    const s = this.sym(symbol);
    for (const w of seed.windows) {
      const startMs = Date.parse(w.window_start);
      // Live-computed windows are exact, so never let a seed overwrite one.
      if (!s.sealed.has(startMs)) s.sealed.set(startMs, w);
    }
    if (s.baseline.length === 0) s.baseline = [...seed.prices];
    s.seriesDirty = true;
    s.statsDirty = true;
  }

  ingest(trade: Trade): void {
    const s = this.sym(trade.symbol);
    const eventMs = Date.parse(trade.time);
    if (!Number.isFinite(eventMs) || !Number.isFinite(trade.price)) return;

    this.batchCount += 1;
    this.eventTimes.push(eventMs);
    if (eventMs - this.eventTimes[0] > EVENT_HISTORY_MS) {
      const cutoff = eventMs - EVENT_HISTORY_MS;
      this.eventTimes = this.eventTimes.filter((t) => t >= cutoff);
    }

    // --- windowed aggregation (F.window(event_time, "1 minute")) ---
    const startMs = Math.floor(eventMs / WINDOW_MS) * WINDOW_MS;
    let acc = s.open.get(startMs);
    if (!acc) {
      acc = {
        startMs,
        n: 0,
        mean: 0,
        m2: 0,
        sumPxSz: 0,
        sumSz: 0,
        low: trade.price,
        high: trade.price,
      };
      s.open.set(startMs, acc);
    }
    acc.n += 1;
    const d = trade.price - acc.mean;
    acc.mean += d / acc.n;
    acc.m2 += d * (trade.price - acc.mean);
    acc.sumPxSz += trade.price * trade.size;
    acc.sumSz += trade.size;
    if (trade.price < acc.low) acc.low = trade.price;
    if (trade.price > acc.high) acc.high = trade.price;

    // --- baseline sampling (throttled; the pipeline reads every silver row) ---
    if (eventMs - s.lastSampleAt >= BASELINE_SAMPLE_MS) {
      s.lastSampleAt = eventMs;
      s.baseline.push({ t: eventMs, price: trade.price });
      const cutoff = eventMs - BASELINE_MS;
      if (s.baseline[0].t < cutoff) {
        s.baseline = s.baseline.filter((p) => p.t >= cutoff);
      }
      s.statsDirty = true;
    }

    this.score(s, trade, eventMs);
  }

  /** z-score + whale detection — the `detect_anomalies` foreachBatch body. */
  private score(s: SymState, trade: Trade, eventMs: number): void {
    if (s.statsDirty) {
      s.stats = baselineStats(s.baseline);
      s.statsDirty = false;
    }

    const notional = trade.price * trade.size;
    const std = s.stats?.std ?? 0;
    const zscore = std > 0 ? (trade.price - (s.stats as { mean: number }).mean) / std : 0;

    const threshold = WHALE_NOTIONAL[trade.symbol] ?? WHALE_NOTIONAL_DEFAULT;
    const isWhale = notional > threshold;
    const isSpike = Math.abs(zscore) > Z_THRESHOLD;
    if (!isWhale && !isSpike) return;

    const id = `${trade.symbol}-${trade.tradeId}`;
    if (this.anomalyIds.has(id)) return;

    const anomaly_type: AnomalyType =
      isWhale && isSpike ? "whale+spike" : isWhale ? "whale" : "price_spike";

    this.anomalyIds.add(id);
    this.anomalies.unshift({
      id,
      symbol: trade.symbol,
      trade_id: trade.tradeId,
      side: trade.side,
      price: trade.price,
      size: trade.size,
      notional,
      zscore,
      anomaly_type,
      event_time: new Date(eventMs).toISOString(),
      detected_at: new Date().toISOString(),
    });

    if (this.anomalies.length > MAX_ANOMALIES) {
      const dropped = this.anomalies.pop();
      if (dropped) this.anomalyIds.delete(dropped.id);
    }
    this.anomaliesDirty = true;
  }

  /**
   * The newest trade actually observed as of `now - lag` — what a pipeline with
   * that much transit would hold as its freshest processed event. The timestamp
   * is a real trade's; only the delay is modelled (see `SYNTHETIC_LAG_MS`).
   *
   * The jitter is re-rolled per tick because the real lag genuinely bounces: a
   * trade's wait depends on where it falls relative to each stage's trigger
   * boundary. Sub-second clock skew between the browser and Coinbase is ignored —
   * it's noise against a 12-second delay.
   */
  private freshestEventAsOfLag(now: number): string {
    if (this.eventTimes.length === 0) return "None";

    const jitter = (Math.random() * 2 - 1) * SYNTHETIC_LAG_JITTER_MS;
    const cutoff = now - (SYNTHETIC_LAG_MS + jitter);

    let pick = this.eventTimes[0];
    for (let i = this.eventTimes.length - 1; i >= 0; i--) {
      if (this.eventTimes[i] <= cutoff) {
        pick = this.eventTimes[i];
        break;
      }
    }
    return sparkTimestamp(new Date(pick).toISOString());
  }

  /**
   * Seals every window the clock has passed and publishes a snapshot. Returns a
   * new object each call (health always advances); unchanged sub-arrays keep
   * their identity so downstream memoisation still holds.
   */
  tick(now = Date.now()): EngineSnapshot {
    const vwap: Record<string, VwapMetric[]> = {};

    // Array.from before iterating: the project's tsconfig has no `target`, so
    // tsc defaults to ES5 and rejects for..of straight over a Map. It also
    // makes deleting from `open` mid-loop unambiguous.
    Array.from(this.syms.entries()).forEach(([symbol, s]) => {
      Array.from(s.open.entries()).forEach(([startMs, acc]) => {
        if (startMs + WINDOW_MS + WINDOW_GRACE_MS > now) return;
        s.open.delete(startMs);
        s.sealed.set(startMs, toMetric(symbol, acc));
        s.seriesDirty = true;
      });

      if (s.seriesDirty) {
        const sorted = Array.from(s.sealed.entries()).sort((a, b) => a[0] - b[0]);
        const trimmed = sorted.slice(-MAX_WINDOWS);
        if (trimmed.length < sorted.length) {
          s.sealed = new Map(trimmed);
        }
        s.series = trimmed.map(([, m]) => m);
        s.seriesDirty = false;
      }

      vwap[symbol] = s.series;
    });

    if (this.anomaliesDirty) {
      this.anomaliesOut = [...this.anomalies];
      this.anomaliesDirty = false;
    }

    const nowIso = new Date(now).toISOString();
    const health: PipelineHealth = {
      id: "streaming",
      job: "streaming",
      events_last_batch: this.batchCount,
      last_event_time: this.freshestEventAsOfLag(now),
      updated_at: nowIso,
    };
    this.batchCount = 0;

    return { vwap, anomalies: this.anomaliesOut, health };
  }
}

function toMetric(symbol: string, acc: Accum): VwapMetric {
  const window_start = new Date(acc.startMs).toISOString();
  return {
    id: `${symbol}-${window_start}`,
    symbol,
    window_start,
    window_end: new Date(acc.startMs + WINDOW_MS).toISOString(),
    vwap: acc.sumSz > 0 ? acc.sumPxSz / acc.sumSz : acc.mean,
    avg_price: acc.mean,
    stddev_price: sampleStd(acc.n, acc.m2),
    low: acc.low,
    high: acc.high,
    volume: acc.sumSz,
    trade_count: acc.n,
  };
}

function baselineStats(samples: { price: number }[]): { mean: number; std: number } | null {
  const n = samples.length;
  if (n < 2) return null;
  let mean = 0;
  let m2 = 0;
  let i = 0;
  for (const { price } of samples) {
    i += 1;
    const d = price - mean;
    mean += d / i;
    m2 += d * (price - mean);
  }
  return { mean, std: Math.sqrt(m2 / (n - 1)) };
}
