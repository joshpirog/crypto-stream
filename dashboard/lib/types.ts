export interface VwapMetric {
  id: string;
  symbol: string;
  window_start: string;
  window_end: string;
  vwap: number;
  avg_price: number;
  stddev_price: number | null;
  low: number;
  high: number;
  volume: number;
  trade_count: number;
}

export type AnomalyType = "whale" | "price_spike" | "whale+spike";

export interface Anomaly {
  id: string;
  symbol: string;
  trade_id: number;
  side: string;
  price: number;
  size: number;
  notional: number;
  zscore: number;
  anomaly_type: AnomalyType;
  event_time: string;
  detected_at: string;
}

export interface PipelineHealth {
  id: string;
  job: string;
  events_last_batch: number;
  last_event_time: string;
  updated_at: string;
}
