import { describe, expect, it } from "vitest";
import { getIdempotencyKey, getSignature, isPostgresUniqueViolation, isTooLarge } from "./ingest";

describe("ingest helpers", () => {
  it("reads idempotency keys case-insensitively, prefers the standard header", () => {
    expect(getIdempotencyKey(new Headers({ "Idempotency-Key": "abc" }))).toBe("abc");
    expect(getIdempotencyKey(new Headers({ "X-IDEMPOTENCY-KEY": "xyz" }))).toBe("xyz");
    expect(getIdempotencyKey(new Headers())).toBeNull();
    expect(getIdempotencyKey(new Headers({ "idempotency-key": "   " }))).toBeNull();
  });

  it("reads the signature header", () => {
    expect(getSignature(new Headers({ "X-Hookrelay-Signature": "sha256=abc" }))).toBe("sha256=abc");
    expect(getSignature(new Headers())).toBeNull();
  });

  it("gates payload size in bytes, not chars", () => {
    expect(isTooLarge("{}", 10)).toBe(false);
    expect(isTooLarge("{" + "x".repeat(20) + "}", 10)).toBe(true);
  });

  it("detects Postgres unique violations for the idempotency race", () => {
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
    expect(isPostgresUniqueViolation({ code: "23503" })).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
  });
});
