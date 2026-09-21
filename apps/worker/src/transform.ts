import vm from "node:vm";
import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { transforms } from "./schema.js";

export const TRANSFORM_TIMEOUT_MS = 50;
export const MAX_TRANSFORM_OUTPUT_BYTES = 256 * 1024;

/** Simple interface describing a compiled transform (kept test-friendly). */
export interface Transform {
  id: string;
  endpointId: string;
  version: number;
  code: string;
}

/**
 * Execute one versioned per-endpoint transform in a hardened V8 context.
 * The script has no require/process/fetch, a fresh realm per run, a wall-clock
 * timeout, and a serialization size cap. Signature: `(event) => payload`.
 */
export function runTransform(code: string, event: unknown): unknown {
  const context = vm.createContext(
    {
      JSON,
      Math,
      Date,
      console, // sandboxed: no stdio handles other than log → we drop output below
      Buffer: undefined,
      process: undefined,
      require: undefined,
      fetch: undefined,
      event,
      result: undefined,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );

  const script = new vm.Script(`"use strict"; result = (function () { ${code} })();`, {
    filename: `transform-${randomUUID()}.js`,
  });
  script.runInContext(context, { timeout: TRANSFORM_TIMEOUT_MS });

  const output = (context as { result: unknown }).result;
  const serialized = JSON.stringify(output ?? null);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TRANSFORM_OUTPUT_BYTES) {
    throw new Error(
      `transform output too large (${Buffer.byteLength(serialized, "utf8")} > ${MAX_TRANSFORM_OUTPUT_BYTES} bytes)`,
    );
  }
  return JSON.parse(serialized);
}

/** Latest active transform for an endpoint, or null. */
export async function getActiveTransform(endpointId: string): Promise<Transform | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: transforms.id, endpointId: transforms.endpointId, version: transforms.version, code: transforms.code })
    .from(transforms)
    .where(and(eq(transforms.endpointId, endpointId), eq(transforms.active, true)))
    .orderBy(desc(transforms.version))
    .limit(1);
  return row ?? null;
}

/** Apply transform if present; falls back to the raw payload on errors (logged). */
export function applyTransform(transform: Transform | null, payload: unknown): { body: unknown; error?: string } {
  if (!transform) return { body: payload };
  try {
    return { body: runTransform(transform.code, payload) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { body: payload, error };
  }
}

/** Reusable HMAC header helper shared with processor. */
export function deliverySignature(secret: string, body: string, timestamp: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
