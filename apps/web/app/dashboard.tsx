"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Delivery {
  id: string;
  endpointUrl: string | null;
  status: string;
  attempts: number;
  latencyMs: number | null;
  responseCode: number | null;
  lastError: string | null;
  nextRetryAt: string | null;
}

interface EventRow {
  id: string;
  sourceId: string;
  sourceName: string;
  idempotencyKey: string | null;
  payload: unknown;
  createdAt: string;
  deliveries: Delivery[];
}

interface Bucket {
  hour: string;
  p50: number | null;
  p95: number | null;
  total: number;
  failures: number;
  failureRate: number;
}

type LiveEvent =
  | {
      type: "event.created";
      eventId: string;
      sourceId: string;
      payloadPreview: string;
      createdAt: string;
    }
  | {
      type: "delivery.updated";
      deliveryId: string;
      eventId: string;
      status: string;
      attempts: number;
      latencyMs: number | null;
      responseCode: number | null;
    };

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-zinc-600",
  delivering: "bg-amber-500",
  success: "bg-emerald-500",
  failed: "bg-orange-500",
  dlq: "bg-red-600",
};

function statusClass(status: string): string {
  return STATUS_COLORS[status] ?? "bg-zinc-600";
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

const dot = "mr-2 inline-block size-2 rounded-full align-middle";
const inputCls =
  "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-emerald-500";
const selectCls = `${inputCls} appearance-none`;
const btnCls =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-50";

export default function Dashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [live, setLive] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [tailLog, setTailLog] = useState<string[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (sourceId) params.set("sourceId", sourceId);
    const [ev, st, src] = await Promise.all([
      api<{ events: EventRow[] }>(`/api/events?${params}`),
      api<{ buckets: Bucket[] }>("/api/stats"),
      api<{ sources: Array<{ id: string; name: string }> }>("/api/sources"),
    ]);
    setEvents(ev.events);
    setBuckets(st.buckets);
    setSources(src.sources);
  }, [q, status, sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // SSE live tail: prepend new events + patch delivery status changes in place.
  useEffect(() => {
    const es = new EventSource("/api/events/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("hook", (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent<string>).data) as LiveEvent;
        if (msg.type === "event.created") {
          setEvents((prev) => [
            {
              id: msg.eventId,
              sourceId: msg.sourceId,
              sourceName: msg.sourceId,
              idempotencyKey: null,
              payload: safeParse(msg.payloadPreview),
              createdAt: msg.createdAt,
              deliveries: [],
            },
            ...prev.slice(0, 199),
          ]);
          setTailLog((l) => [`event ${msg.eventId.slice(0, 8)} received`, ...l].slice(0, 12));
        } else {
          setEvents((prev) =>
            prev.map((ev) => {
              if (ev.id !== msg.eventId) return ev;
              const ds = ev.deliveries.slice();
              const i = ds.findIndex((d) => d.id === msg.deliveryId);
              const patch: Delivery = {
                id: msg.deliveryId,
                endpointUrl: i >= 0 ? ds[i].endpointUrl : null,
                status: msg.status,
                attempts: msg.attempts,
                latencyMs: msg.latencyMs,
                responseCode: msg.responseCode,
                lastError: null,
                nextRetryAt: null,
              };
              if (i >= 0) ds[i] = patch;
              else ds.push(patch);
              return { ...ev, deliveries: ds };
            }),
          );
          setTailLog((l) => [`delivery ${msg.deliveryId.slice(0, 8)} → ${msg.status}`, ...l].slice(0, 12));
        }
      } catch {
        // ignore malformed frame
      }
    });
    return () => es.close();
  }, []);

  const replay = async (deliveryId: string) => {
    setReplaying(deliveryId);
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/replay`, { method: "POST" });
      if (res.ok) await load();
    } finally {
      setReplaying(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-zinc-200">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-emerald-400">hookrelay</p>
          <h1 className="mt-1 text-2xl font-bold text-white">Durable webhook gateway</h1>
        </div>
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          <span className={`${live ? "bg-emerald-500" : "bg-zinc-600"} inline-block size-2 rounded-full`} />
          {live ? "live" : "reconnecting"}
        </span>
      </header>

      <Filters
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        sourceId={sourceId}
        setSourceId={setSourceId}
        sources={sources}
      />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-sm font-semibold text-zinc-300">Delivery latency &amp; failure rate (24h)</h2>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={buckets.map((b) => ({ ...b, hour: b.hour.slice(11, 16) }))}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="#71717a" fontSize={11} />
              <YAxis yAxisId="ms" stroke="#71717a" fontSize={11} unit="ms" width={64} />
              <YAxis
                yAxisId="pct"
                orientation="right"
                stroke="#71717a"
                fontSize={11}
                unit="%"
                width={44}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
              />
              <Line yAxisId="ms" type="monotone" dataKey="p50" name="p50" stroke="#34d399" dot={false} />
              <Line yAxisId="ms" type="monotone" dataKey="p95" name="p95" stroke="#60a5fa" dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="failureRate" name="failure %" stroke="#f87171" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
        <EventList events={events} openEvent={openEvent} setOpenEvent={setOpenEvent} replay={replay} replaying={replaying} />
        <TailPanel tailLog={tailLog} />
      </section>
    </main>
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function Filters(props: {
  q: string;
  setQ: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  sourceId: string;
  setSourceId: (v: string) => void;
  sources: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <input
        className={inputCls}
        placeholder="Search payload or idempotency key…"
        value={props.q}
        onChange={(e) => props.setQ(e.target.value)}
      />
      <select className={selectCls} value={props.status} onChange={(e) => props.setStatus(e.target.value)}>
        <option value="">any status</option>
        {["queued", "delivering", "success", "failed", "dlq"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select className={selectCls} value={props.sourceId} onChange={(e) => props.setSourceId(e.target.value)}>
        <option value="">all sources</option>
        {props.sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function EventList(props: {
  events: EventRow[];
  openEvent: string | null;
  setOpenEvent: (id: string | null) => void;
  replay: (id: string) => Promise<void>;
  replaying: string | null;
}) {
  if (props.events.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
        No events yet — fire a signed ingest (see README Quickstart) and watch it land here live.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {props.events.map((ev) => (
        <li key={ev.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          <button
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            onClick={() => props.setOpenEvent(props.openEvent === ev.id ? null : ev.id)}
          >
            <span className="min-w-0">
              <span className="text-sm font-medium text-zinc-200">{ev.sourceName}</span>
              {ev.idempotencyKey ? <span className="ml-2 text-xs text-zinc-500">{ev.idempotencyKey}</span> : null}
              <span className="mt-0.5 block truncate font-mono text-xs text-zinc-500">
                {ev.id.slice(0, 8)} · {JSON.stringify(ev.payload).slice(0, 120)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-zinc-500">{timeAgo(ev.createdAt)}</span>
          </button>
          {props.openEvent === ev.id ? (
            <div className="border-t border-zinc-800 px-4 py-3">
              <p className="mb-2 font-mono text-xs text-zinc-300">
                {JSON.stringify(ev.payload, null, 2).slice(0, 2000)}
              </p>
              <ul className="space-y-2">
                {ev.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/60 px-3 py-2">
                    <span className={`${dot} ${statusClass(d.status)}`} />
                    <span className="text-xs text-zinc-300">{d.status}</span>
                    <span className="text-xs text-zinc-500">
                      attempt {d.attempts}
                      {d.latencyMs !== null ? ` · ${d.latencyMs}ms` : ""}
                      {d.responseCode !== null ? ` · HTTP ${d.responseCode}` : ""}
                    </span>
                    {d.lastError ? <span className="text-xs text-red-400">{d.lastError}</span> : null}
                    {d.nextRetryAt ? (
                      <span className="text-xs text-amber-400">retry {new Date(d.nextRetryAt).toLocaleTimeString()}</span>
                    ) : null}
                    <button
                      className={`${btnCls} ml-auto`}
                      disabled={props.replaying === d.id || d.status === "delivering"}
                      onClick={() => void props.replay(d.id)}
                    >
                      replay
                    </button>
                  </li>
                ))}
                {ev.deliveries.length === 0 ? (
                  <li className="text-xs text-zinc-500">no endpoints configured for this source</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TailPanel(props: { tailLog: string[] }) {
  return (
    <aside className="hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 lg:block">
      <h2 className="text-sm font-semibold text-zinc-300">Live tail</h2>
      <ul className="mt-3 space-y-1 font-mono text-[11px] text-zinc-500">
        {props.tailLog.length === 0 ? <li>waiting for traffic…</li> : props.tailLog.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </aside>
  );
}
