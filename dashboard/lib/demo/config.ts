// Demo mode: recompute the gold-layer metrics in the browser from the Coinbase
// feed the page is already connected to, instead of reading them from Cosmos.
// Lets the portfolio dashboard stay live with the Azure pipeline torn down.
//
// The constants below mirror `databricks/notebooks/gold_aggregate.py` so the
// numbers on screen are produced by the same logic the real pipeline runs.
// Where a browser genuinely cannot match the pipeline, it is called out.

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
export type Symbol = (typeof SYMBOLS)[number];

/** Tumbling window size — matches the pipeline's `F.window(event_time, "1 minute")`. */
export const WINDOW_MS = 60_000;

/**
 * The pipeline uses a 2-minute watermark because Event Hubs partitions deliver
 * out of order. A browser reads one ordered socket, so a window is complete as
 * soon as the clock passes its end; the small grace just absorbs feed jitter.
 */
export const WINDOW_GRACE_MS = 3_000;

/** Trailing baseline for the z-score — matches `INTERVAL 30 MINUTES`. */
export const BASELINE_MS = 30 * 60_000;

/** Matches `Z_THRESHOLD` — price beyond 3 std devs of the trailing mean. */
export const Z_THRESHOLD = 3.0;

/**
 * The pipeline uses a flat $250k notional for every symbol. A browser session
 * only sees trades that arrive while the tab is open, so at $250k the ETH and
 * SOL books would emit nothing for hours. These per-symbol values target the
 * same *rarity* (roughly the top fraction of a percent of trades on each book)
 * rather than the same dollar figure.
 */
export const WHALE_NOTIONAL: Record<string, number> = {
  "BTC-USD": 250_000,
  "ETH-USD": 100_000,
  "SOL-USD": 50_000,
};
export const WHALE_NOTIONAL_DEFAULT = 250_000;

/**
 * How often derived state is published to React. Trades arrive far too fast to
 * render per-message, so the engine accumulates in refs and flushes on this
 * tick — the direct analogue of the pipeline's `trigger(processingTime=...)`.
 *
 * Pinned to 15s to match `health_sink`'s trigger in `cosmos_sink.py`, because the
 * health panel renders this interval's trade count as `events_last_batch`. At a
 * shorter tick the demo would report the same market activity as a proportionally
 * smaller number than the live pipeline does. The cost is that every panel — chart,
 * anomaly feed, tiles — also refreshes on this interval rather than a snappier one.
 */
export const TICK_MS = 15_000;

/**
 * SYNTHETIC — the one number in demo mode that is not measured.
 *
 * `HealthPanel` derives processing lag as `updated_at - last_event_time`. In the
 * real stack that spans a genuine journey: Coinbase -> Event Hubs -> bronze
 * (`trigger 10s`) -> silver (`trigger 10s`) -> health sink (`trigger 15s`), so it
 * reads in the double digits. In demo mode there is no pipeline — the true lag is
 * a few milliseconds — so without this the panel would sit at 0s while the live
 * stack shows ~15s.
 *
 * The band below is derived from those configured trigger intervals (a trade waits
 * on average half of each stage's interval), NOT calibrated against a live run —
 * the stack was down when this was written.
 *
 * What is reported stays a real trade's timestamp: the engine answers with the
 * newest trade it had actually seen as of `now - lag`, which is precisely what a
 * pipeline carrying that much transit would hold as its freshest processed event.
 * Only the choice of delay is modelled.
 */
export const SYNTHETIC_LAG_MS = 12_000;
export const SYNTHETIC_LAG_JITTER_MS = 4_000;

/** How much trade history to retain to answer the "as of now - lag" question. */
export const EVENT_HISTORY_MS = 60_000;

/** Ring-buffer caps, so a tab left open overnight doesn't grow without bound. */
export const MAX_WINDOWS = 240;
export const MAX_ANOMALIES = 50;

/** Baseline samples are throttled to at most one per symbol per this interval. */
export const BASELINE_SAMPLE_MS = 250;
