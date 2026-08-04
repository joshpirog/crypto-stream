"use client";

import { useEffect, useRef, useState } from "react";

export interface Trade {
  id: string;
  /** Coinbase's numeric match id, kept separately for anomaly records. */
  tradeId: number;
  symbol: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  time: string;
}

export type TapeStatus = "connecting" | "live" | "down";

export interface LastPrice {
  price: number;
  dir: 1 | -1 | 0;
}

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const MAX_ROWS = 40;

// Connects the browser straight to Coinbase's public match feed — the same raw
// firehose the pipeline ingests, shown unprocessed and live. Independent of the
// Cosmos-backed panels (which show the processed VWAP/anomaly/health data),
// except in demo mode, where `onTrade` also feeds the in-browser aggregator.
//
// `onTrade` sees EVERY match; the returned `trades` array is only the visible
// tape (capped at MAX_ROWS). It's held in a ref so a caller passing an inline
// function can't tear down the socket on re-render.
export function useTradeTape(onTrade?: (t: Trade) => void) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [status, setStatus] = useState<TapeStatus>("connecting");
  const [last, setLast] = useState<Record<string, LastPrice>>({});
  const lastPriceRef = useRef<Record<string, number>>({});
  const onTradeRef = useRef(onTrade);
  onTradeRef.current = onTrade;

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setStatus("live");
        ws?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: PRODUCTS,
            channels: ["matches"],
          })
        );
      };

      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type !== "match" && m.type !== "last_match") return;
        if (!m.price || !m.product_id) return;

        const price = parseFloat(m.price);
        const symbol: string = m.product_id;
        const trade: Trade = {
          id: `${m.trade_id}-${symbol}`,
          tradeId: Number(m.trade_id),
          symbol,
          price,
          size: parseFloat(m.size),
          side: m.side === "sell" ? "sell" : "buy",
          time: m.time,
        };

        const prev = lastPriceRef.current[symbol];
        const dir: 1 | -1 | 0 =
          prev == null ? 0 : price > prev ? 1 : price < prev ? -1 : 0;
        lastPriceRef.current[symbol] = price;

        // last_match is the per-product snapshot Coinbase sends on subscribe;
        // seed prices from it but don't spam the visible tape with it, and
        // don't let it double-count into the aggregator's batch numbers.
        if (m.type === "match") {
          setTrades((prevTrades) => [trade, ...prevTrades].slice(0, MAX_ROWS));
          onTradeRef.current?.(trade);
        }
        setLast((prevLast) => ({ ...prevLast, [symbol]: { price, dir } }));
      };

      ws.onclose = () => {
        if (stopped) return;
        setStatus("down");
        retry = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { trades, status, last };
}
