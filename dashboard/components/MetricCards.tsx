"use client";

import { Card, Text, Metric, Flex } from "@tremor/react";
import { useLive } from "@/lib/useLive";
import type { VwapMetric } from "@/lib/types";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

const usd = (n?: number | null) =>
  n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function SymbolCard({ symbol }: { symbol: string }) {
  const { data } = useLive<VwapMetric[]>(`/api/vwap?symbol=${symbol}&limit=1`);
  const m = data?.[data.length - 1];

  return (
    <Card>
      <Text>{symbol}</Text>
      <Metric>{usd(m?.vwap)}</Metric>
      <Flex className="mt-4">
        <Text>Volatility σ {usd(m?.stddev_price)}</Text>
        <Text>{m?.trade_count ?? 0} trades</Text>
      </Flex>
      <Text className="mt-1">
        Volume {m?.volume != null ? m.volume.toFixed(4) : "—"}
      </Text>
    </Card>
  );
}

export default function MetricCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {SYMBOLS.map((s) => (
        <SymbolCard key={s} symbol={s} />
      ))}
    </div>
  );
}
