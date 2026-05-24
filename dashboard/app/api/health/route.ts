import { NextResponse } from "next/server";
import { container } from "@/lib/cosmos";
import type { PipelineHealth } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { resources } = await container("pipeline_health")
      .items.query<PipelineHealth>('SELECT * FROM c WHERE c.id = "streaming"')
      .fetchAll();

    return NextResponse.json(resources[0] ?? null);
  } catch (err) {
    console.error("health query failed", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
