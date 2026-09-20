/** Pure, unit-tested helpers for the ingest pipeline. */

export const SIGNATURE_HEADER = "x-hookrelay-signature";

/** First non-empty value of `idempotency-key` / `x-idempotency-key` (headers are case-insensitive). */
export function getIdempotencyKey(headers: Headers): string | null {
  for (const name of ["idempotency-key", "x-idempotency-key"]) {
    const v = headers.get(name)?.trim();
    if (v) return v.slice(0, 256);
  }
  return null;
}

export function getSignature(headers: Headers): string | null {
  return headers.get(SIGNATURE_HEADER)?.trim() || null;
}

/** Byte-size gate before JSON parsing (body is already in memory as text). */
export function isTooLarge(rawBody: string, maxBytes: number): boolean {
  return Buffer.byteLength(rawBody, "utf8") > maxBytes;
}

export function isPostgresUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
