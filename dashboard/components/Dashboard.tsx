"use client";

import { useTradeTape } from "@/lib/useTradeTape";
import { useDemoIngest } from "@/lib/demo/DemoProvider";
import LiveBadge from "./LiveBadge";
import Clock from "./Clock";
import TickerTiles from "./TickerTiles";
import VwapChart from "./VwapChart";
import HealthPanel from "./HealthPanel";
import LiveTape from "./LiveTape";
import AnomalyFeed from "./AnomalyFeed";

export default function Dashboard() {
  // One WebSocket for the whole page: raw price ticks feed the tiles + the tape,
  // and in demo mode the same stream also feeds the in-browser gold aggregator.
  const ingest = useDemoIngest();
  const { trades, status, last } = useTradeTape(ingest);

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-baseline gap-3">
          <h1
            className="text-xl font-bold tracking-[0.08em] text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            CRYPTO<span className="text-[var(--amber)]">//</span>STREAM
          </h1>
          <span className="tag hidden text-[var(--text-faint)] sm:inline">
            market intelligence terminal
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Clock />
          <LiveBadge status={status} />
        </div>
      </header>

      <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TickerTiles last={last} />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="h-[360px] lg:col-span-5">
          <VwapChart />
        </div>
        <div className="h-[360px] lg:col-span-3">
          <HealthPanel />
        </div>
        <div className="h-[360px] lg:col-span-4">
          <LiveTape trades={trades} />
        </div>
      </section>

      <section className="mt-4">
        <AnomalyFeed />
      </section>

      <footer className="mt-6 border-t border-[var(--border)] pt-3">
        <span className="tag text-[var(--text-faint)]">
          coinbase ws → event hubs → databricks medallion → cosmos db → next.js
        </span>
      </footer>
    </div>
  );
}
