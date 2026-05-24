"use client";

import { useState } from "react";
import { Card, Title, LineChart, Select, SelectItem, Flex } from "@tremor/react";
import { useLive } from "@/lib/useLive";
import type { VwapMetric } from "@/lib/types";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function VwapChart() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const { data } = useLive<VwapMetric[]>(`/api/vwap?symbol=${symbol}&limit=60`);

  const chartData = (data ?? []).map((d) => ({
    time: new Date(
      d.window_start.endsWith("Z") ? d.window_start : `${d.window_start}Z`
    ).toLocaleTimeString(),
    VWAP: d.vwap,
  }));

  return (
    <Card>
      <Flex>
        <Title>VWAP — 1-minute windows</Title>
        <div className="w-40">
          <Select value={symbol} onValueChange={setSymbol}>
            {SYMBOLS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </Select>
        </div>
      </Flex>
      <LineChart
        className="mt-6 h-72"
        data={chartData}
        index="time"
        categories={["VWAP"]}
        colors={["blue"]}
        valueFormatter={usd}
        showLegend={false}
        yAxisWidth={72}
        autoMinValue
        noDataText="Waiting for VWAP windows…"
      />
    </Card>
  );
}
