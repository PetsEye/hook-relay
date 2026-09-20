export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm uppercase tracking-widest text-emerald-400">hook-relay · scaffold</p>
      <h1 className="mt-3 text-4xl font-bold">Durable webhook gateway</h1>
      <p className="mt-4 text-zinc-400">
        Ingest → verify → queue → deliver with retries, live tail and replay. Full pipeline lands in the next
        milestones.
      </p>
      <div className="mt-8 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 font-mono text-sm">
        <p>
          <span className="text-zinc-500">$</span> docker compose up
        </p>
        <p>
          <span className="text-zinc-500">$</span> curl -X POST localhost:3000/api/ingest/demo -d &apos;{`{"hello":"world"}`}&apos;
        </p>
        <p>
          <span className="text-emerald-400">GET</span> /api/health → <span className="text-zinc-400">{`{"ok":true}`}</span>
        </p>
      </div>
    </main>
  );
}
