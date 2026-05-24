import { NextRequest, NextResponse } from "next/server";
import { container } from "@/lib/cosmos";
import type { VwapMetric } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "BTC-USD";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 60);

  try {
    // Filter on the partition key (symbol) so Cosmos prunes to a single partition.
    const { resources } = await container("vwap_metrics")
      .items.query<VwapMetric>({
        query:
          "SELECT * FROM c WHERE c.symbol = @symbol ORDER BY c.window_start DESC OFFSET 0 LIMIT @limit",
        parameters: [
          { name: "@symbol", value: symbol },
          { name: "@limit", value: limit },
        ],
      })
      .fetchAll();

    // Return chronological (oldest first) for charting.
    return NextResponse.json(resources.reverse());
  } catch (err) {
    console.error("vwap query failed", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
