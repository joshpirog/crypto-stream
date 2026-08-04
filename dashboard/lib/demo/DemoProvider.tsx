"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Trade } from "@/lib/useTradeTape";
import { fetchSeed } from "./candles";
import { DEMO_MODE, SYMBOLS, TICK_MS } from "./config";
import { DemoEngine, type EngineSnapshot } from "./engine";

const EMPTY: EngineSnapshot = { vwap: {}, anomalies: [], health: null };
const noop = () => {};

interface DemoCtxValue {
  snapshot: EngineSnapshot;
  ingest: (t: Trade) => void;
}

const DemoCtx = createContext<DemoCtxValue>({ snapshot: EMPTY, ingest: noop });

/**
 * Owns the in-browser aggregator when `NEXT_PUBLIC_DEMO_MODE=1`. Outside demo
 * mode it's an inert passthrough — no engine, no timer, no fetches — so the
 * Cosmos-backed path is untouched and the hooks below fall through to SWR.
 */
export function DemoProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<DemoEngine | null>(null);
  if (DEMO_MODE && !engineRef.current) engineRef.current = new DemoEngine();

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY);

  const ingest = useCallback((t: Trade) => {
    engineRef.current?.ingest(t);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const ac = new AbortController();

    // Backfill from the candles endpoint so the chart has history on first
    // paint instead of waiting a minute for its first window to close.
    for (const symbol of SYMBOLS) {
      fetchSeed(symbol, ac.signal)
        .then((seed) => {
          engine.seed(symbol, seed);
          setSnapshot(engine.tick());
        })
        .catch((err) => {
          if (!ac.signal.aborted) console.warn(`history backfill failed for ${symbol}`, err);
        });
    }

    const id = setInterval(() => setSnapshot(engine.tick()), TICK_MS);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, []);

  return <DemoCtx.Provider value={{ snapshot, ingest }}>{children}</DemoCtx.Provider>;
}

/** Every trade off the socket, routed into the aggregator. No-op outside demo mode. */
export function useDemoIngest(): (t: Trade) => void {
  return useContext(DemoCtx).ingest;
}

export function useDemoSnapshot(): EngineSnapshot {
  return useContext(DemoCtx).snapshot;
}
