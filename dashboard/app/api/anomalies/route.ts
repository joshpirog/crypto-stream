import { NextRequest, NextResponse } from "next/server";
import { container } from "@/lib/cosmos";
import type { Anomaly } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 25);

  try {
    const { resources } = await container("anomalies")
      .items.query<Anomaly>({
        query: "SELECT TOP @limit * FROM c ORDER BY c.event_time DESC",
        parameters: [{ name: "@limit", value: limit }],
      })
      .fetchAll();

    return NextResponse.json(resources);
  } catch (err) {
    console.error("anomalies query failed", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
