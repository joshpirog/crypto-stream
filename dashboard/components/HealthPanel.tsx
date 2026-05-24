"use client";

import { Card, Title, Text, Metric, Flex, Badge, type Color } from "@tremor/react";
import { useLive } from "@/lib/useLive";
import type { PipelineHealth } from "@/lib/types";

// The notebook writes timestamps as UTC without a tz suffix (e.g.
// "2026-05-23 08:31:19.993597"). Normalize to an ISO-Z string before parsing.
function parseUtcMs(s: string): number {
  let iso = s.includes("T") ? s : s.replace(" ", "T");
  if (!iso.endsWith("Z")) iso += "Z";
  return new Date(iso).getTime();
}

export default function HealthPanel() {
  const { data } = useLive<PipelineHealth | null>("/api/health");

  if (!data) {
    return (
      <Card>
        <Title>Pipeline health</Title>
        <Text className="mt-4">No heartbeat yet</Text>
      </Card>
    );
  }

  const updatedAgo = Math.max(
    0,
    Math.round((Date.now() - parseUtcMs(data.updated_at)) / 1000)
  );

  const hasEvent = data.last_event_time && data.last_event_time !== "None";
  const lagSec = hasEvent
    ? Math.round((parseUtcMs(data.updated_at) - parseUtcMs(data.last_event_time)) / 1000)
    : null;

  const liveColor: Color =
    updatedAgo < 30 ? "emerald" : updatedAgo < 120 ? "amber" : "rose";
  const lagColor: Color =
    lagSec == null ? "gray" : lagSec < 60 ? "emerald" : lagSec < 600 ? "amber" : "rose";

  return (
    <Card>
      <Flex>
        <Title>Pipeline health</Title>
        <Badge color={liveColor}>updated {updatedAgo}s ago</Badge>
      </Flex>
      <Metric className="mt-4">{data.events_last_batch} ev/batch</Metric>
      <Flex className="mt-6">
        <Text>Processing lag</Text>
        <Badge color={lagColor}>{lagSec == null ? "—" : `${lagSec}s`}</Badge>
      </Flex>
      <Text className="mt-3 truncate">Last event: {data.last_event_time}</Text>
    </Card>
  );
}
