"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useLive } from "@/lib/useLive";
import type { VwapMetric } from "@/lib/types";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

interface TooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[3px] border border-[var(--border-glow)] bg-[var(--bg-2)] px-3 py-2 shadow-lg">
      <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-faint)]">{label}</div>
      <div className="tnum text-sm text-[var(--amber)]">{usd(payload[0].value)}</div>
    </div>
  );
}

export default function VwapChart() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const { data } = useLive<VwapMetric[]>(`/api/vwap?symbol=${symbol}&limit=60`);

  const chart = (data ?? []).map((d) => ({
    t: new Date(d.window_start.endsWith("Z") ? d.window_start : `${d.window_start}Z`)
      .toISOString()
      .slice(11, 16),
    vwap: d.vwap,
  }));

  return (
    <div className="panel flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <span className="tag">
          [ <b>VWAP</b> · 1m windows ]
        </span>
        <div className="flex gap-1">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded-[3px] border px-2 py-1 text-[10px] tracking-[0.1em] transition ${
                symbol === s
                  ? "border-[var(--amber-dim)] text-[var(--amber)]"
                  : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
              }`}
            >
              {s.split("-")[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="vwapFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffb000" stopOpacity={0.26} />
                <stop offset="100%" stopColor="#ffb000" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1a232f" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "#45525f", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#1a232f" }}
              minTickGap={44}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "#45525f", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={66}
              tickFormatter={(v) => usd(v as number)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#28384a" }} />
            <Area
              type="monotone"
              dataKey="vwap"
              stroke="#ffb000"
              strokeWidth={1.6}
              fill="url(#vwapFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
