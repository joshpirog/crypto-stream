"use client";

import {
  Card,
  Title,
  Badge,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  type Color,
} from "@tremor/react";
import { useLive } from "@/lib/useLive";
import type { Anomaly, AnomalyType } from "@/lib/types";

const badgeColor = (t: AnomalyType): Color =>
  t === "whale" ? "amber" : t === "price_spike" ? "rose" : "purple";

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString()}`;

export default function AnomalyFeed() {
  const { data } = useLive<Anomaly[]>("/api/anomalies?limit=25");
  const rows = data ?? [];

  return (
    <Card>
      <Title>Anomalies &amp; whale trades</Title>
      <Table className="mt-4">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Time</TableHeaderCell>
            <TableHeaderCell>Symbol</TableHeaderCell>
            <TableHeaderCell>Type</TableHeaderCell>
            <TableHeaderCell>Side</TableHeaderCell>
            <TableHeaderCell className="text-right">Price</TableHeaderCell>
            <TableHeaderCell className="text-right">Notional</TableHeaderCell>
            <TableHeaderCell className="text-right">z-score</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                {new Date(
                  a.detected_at.endsWith("Z") ? a.detected_at : `${a.detected_at}Z`
                ).toLocaleTimeString()}
              </TableCell>
              <TableCell>{a.symbol}</TableCell>
              <TableCell>
                <Badge color={badgeColor(a.anomaly_type)}>{a.anomaly_type}</Badge>
              </TableCell>
              <TableCell>{a.side}</TableCell>
              <TableCell className="text-right">{usd(a.price)}</TableCell>
              <TableCell className="text-right">{usd(a.notional)}</TableCell>
              <TableCell className="text-right">{a.zscore?.toFixed(2)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell>No anomalies detected yet</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
