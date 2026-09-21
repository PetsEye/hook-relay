#!/usr/bin/env node
// hookrelay CLI — `listen` (local webhook receiver + tail) and `trigger` (signed ingest).
import { createServer } from "node:http";
import { sign } from "hookrelay-js";

interface Parsed {
  cmd: string;
  opts: Record<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const [cmd = "help", ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = "true";
      }
    }
  }
  return { cmd, opts };
}

const HELP = `
hookrelay — durable webhook gateway CLI

  hookrelay listen [--port 9200]        local webhook receiver (http://localhost:<port>/hook)
  hookrelay trigger [payload]           signed POST to an ingest URL
      --source demo                     source id (ingest path suffix)
      --secret <s>                      signing secret
      --idem <key>                      idempotency key (unique per trigger)
      --web http://localhost:3000       hub base URL

Env shortcuts: HOOKRELAY_WEB, HOOKRELAY_SOURCE, HOOKRELAY_SECRET, HOOKRELAY_PORT.
`;

async function cmdListen(port: number, web: string): Promise<void> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/sink" && req.method === "GET") {
      // Tail the hub through the dashboard's browser-readable SSE.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(hits.join("\n"));
      return;
    }
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      hits.push(`${new Date().toISOString()} ${req.method} ${req.url} ${body.slice(0, 200)}`);
      console.log(`← ${req.method} ${req.url} ${body.slice(0, 120)}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(port, r));
  console.log(`hookrelay: local receiver on http://localhost:${port}/hook`);
  console.log(`hookrelay: replay log at http://localhost:${port}/sink (tail the dashboard at ${web} for delivery status)`);

  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
}

async function cmdTrigger(payload: string, opts: Record<string, string>): Promise<void> {
  const web = opts.web ?? process.env.HOOKRELAY_WEB ?? "http://localhost:3000";
  const source = opts.source ?? process.env.HOOKRELAY_SOURCE ?? "demo";
  const secret = opts.secret ?? process.env.HOOKRELAY_SECRET;
  if (!secret) {
    console.error("hookrelay trigger: --secret or HOOKRELAY_SECRET required");
    process.exit(1);
  }
  const body = payload || JSON.stringify({ hello: "from hookrelay cli", at: Date.now() });
  const idem = opts.idem ?? `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${web}/api/ingest/${source}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hookrelay-signature": await sign(secret, body),
      "idempotency-key": idem,
    },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (res.ok) {
    console.log(`✓ accepted eventId=${String(data.eventId)}`);
    for (const d of (data.deliveries as Array<{ deliveryId: string; queued: boolean }>) ?? []) {
      console.log(`  delivery=${d.deliveryId.slice(0, 8)} queued=${d.queued}`);
    }
    console.log(`  tail: open ${web}`);
  } else {
    console.error(`✗ ${res.status}`, data);
    process.exit(1);
  }
}

const { cmd, opts } = parseArgs(process.argv.slice(2));

switch (cmd) {
  case "listen": {
    const port = Number(opts.port ?? process.env.HOOKRELAY_PORT ?? 9200);
    await cmdListen(port, opts.web ?? process.env.HOOKRELAY_WEB ?? "http://localhost:3000");
    break;
  }
  case "trigger": {
    const rest = process.argv.slice(process.argv.indexOf("trigger") + 1);
    const firstFlag = rest.findIndex((a) => a.startsWith("--"));
    const positional = firstFlag === -1 ? rest[0] : firstFlag > 0 ? rest[0] : undefined;
    const payload = positional && isValidJson(positional) ? positional : "";
    await cmdTrigger(payload, opts);
    break;
  }
  default:
    console.log(HELP);
}

function isValidJson(s: string | undefined): boolean {
  if (!s || s.startsWith("--")) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
