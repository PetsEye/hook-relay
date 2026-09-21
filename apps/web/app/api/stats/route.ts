import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface Bucket {
  hour: string;
  p50: number | null;
  p95: number | null;
  total: number;
  failures: number;
  failureRate: number;
}

/** GET /api/stats — hourly p50/p95 latency + failure rate over the last 24h. */
export async function GET() {
  const { rows } = await getPool().query<{
    hour: Date;
    p50: string | null;
    p95: string | null;
    total: string;
    failures: string;
  }>(`
    SELECT
      date_trunc('hour', d.created_at) AS hour,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY d.latency_ms) FILTER (WHERE d.status = 'success') AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY d.latency_ms) FILTER (WHERE d.status = 'success') AS p95,
      count(*) AS total,
      count(*) FILTER (WHERE d.status = 'dlq' OR (d.status = 'failed' AND d.next_retry_at IS NULL)) AS failures
    FROM deliveries d
    WHERE d.created_at > now() - interval '24 hours'
    GROUP BY 1
    ORDER BY 1
  `);

  const buckets: Bucket[] = rows.map((r) => {
    const total = Number(r.total);
    const failures = Number(r.failures);
    return {
      hour: r.hour.toISOString(),
      p50: r.p50 === null ? null : Math.round(Number(r.p50)),
      p95: r.p95 === null ? null : Math.round(Number(r.p95)),
      total,
      failures,
      failureRate: total === 0 ? 0 : Math.round((failures / total) * 1000) / 10,
    };
  });

  return NextResponse.json({ buckets });
}
