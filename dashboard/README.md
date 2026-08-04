This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Demo mode

`NEXT_PUBLIC_DEMO_MODE=1` runs the dashboard with **no Azure dependency at all** — for
keeping the portfolio link alive while the pipeline is torn down.

The panels read their data through `lib/dataSource.ts`, which picks a serving layer at
build time:

| | Serving layer |
|---|---|
| default | `/api/{vwap,anomalies,health}` → Cosmos DB (the real pipeline) |
| `NEXT_PUBLIC_DEMO_MODE=1` | `lib/demo/engine.ts` — the gold layer recomputed in the browser |

In demo mode the API routes are never called (SWR gets a `null` key). Instead
`lib/demo/engine.ts` reimplements `databricks/notebooks/gold_aggregate.py` over the
Coinbase socket the live tape already uses: 1-minute tumbling VWAP windows, z-score
anomalies against a trailing 30-minute baseline, whale-notional detection, and a
health panel whose "events/batch" is a real count of trades per publish tick. So the
numbers are real market data run through the real logic — only the transport differs.

Two honest caveats, both marked in the code:

- History on page load is backfilled from Coinbase's public candles endpoint, and a
  1-minute OHLCV candle can't carry per-trade detail — seeded windows use the standard
  `(high + low + close) / 3` typical-price proxy and carry `trade_count: 0`. Windows
  sealed from the live socket are computed exactly.
- The whale threshold is per-symbol (`lib/demo/config.ts`) rather than the pipeline's
  flat $250k, because a browser session only sees trades that arrive while the tab is
  open. The values target the same rarity on each book.

**Demo mode is visually identical to the real app** — no badge, no altered footer. The
two paths are kept pixel-identical on purpose, down to `pipeline_health.job` and the
space-separated `last_event_time` format the sink writes, so the health panel renders
the same string either way. The only way to tell from the UI is that the tiles' `trades`
count reads `—` for windows backfilled from candles: those carry `trade_count: 0`, and
since a real gold window always has a positive count, the tile renders the dash it uses
for anything unknown.

Worth knowing when you show it: with the pipeline torn down, the footer's
`event hubs → databricks → cosmos` line describes the architecture in this repo rather
than what served the page you're looking at.

```bash
NEXT_PUBLIC_DEMO_MODE=1 npm run dev     # no COSMOS_* needed
```

To deploy in demo mode, set the **`DEMO_MODE` repository variable** to `1` (Settings →
Secrets and variables → Actions → Variables) and re-run
`.github/workflows/azure-static-web-apps.yml` — it's wired to
`NEXT_PUBLIC_DEMO_MODE: ${{ vars.DEMO_MODE }}`, so flipping modes needs no commit.
Unset, or any value but `1`, builds the Cosmos path.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
