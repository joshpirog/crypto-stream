"use client";

import { useDemoSnapshot } from "@/lib/demo/DemoProvider";
import { DEMO_MODE } from "@/lib/demo/config";
import { useLive } from "@/lib/useLive";
import type { Anomaly, PipelineHealth, VwapMetric } from "@/lib/types";

// The panels read the gold-layer data through here rather than calling the API
// routes directly, so one build flag swaps the whole serving layer:
//
//   default            -> /api/{vwap,anomalies,health} -> Cosmos DB   (real pipeline)
//   NEXT_PUBLIC_DEMO_MODE=1 -> in-browser aggregator over the Coinbase feed
//
// Both hooks run on every render — only the key and the returned value change —
// so switching modes never reorders hooks.

export function useVwapSeries(symbol: string, limit: number): { data?: VwapMetric[] } {
  const snapshot = useDemoSnapshot();
  const live = useLive<VwapMetric[]>(
    DEMO_MODE ? null : `/api/vwap?symbol=${symbol}&limit=${limit}`
  );

  if (!DEMO_MODE) return { data: live.data };
  const series = snapshot.vwap[symbol];
  return { data: series ? series.slice(-limit) : undefined };
}

export function useAnomalyFeed(limit: number): { data?: Anomaly[] } {
  const snapshot = useDemoSnapshot();
  const live = useLive<Anomaly[]>(DEMO_MODE ? null : `/api/anomalies?limit=${limit}`);

  if (!DEMO_MODE) return { data: live.data };
  return { data: snapshot.anomalies.slice(0, limit) };
}

export function usePipelineHealth(): { data?: PipelineHealth | null } {
  const snapshot = useDemoSnapshot();
  const live = useLive<PipelineHealth | null>(DEMO_MODE ? null : "/api/health");

  if (!DEMO_MODE) return { data: live.data };
  return { data: snapshot.health };
}
