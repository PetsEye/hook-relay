import { describe, expect, it } from "vitest";
import { computeNextRetry, MAX_ATTEMPTS, RETRY_DELAYS_SEC } from "./processor.js";

describe("computeNextRetry", () => {
  it("returns null (→ DLQ) after the final attempt", () => {
    expect(computeNextRetry(MAX_ATTEMPTS)).toBeNull();
    expect(computeNextRetry(MAX_ATTEMPTS + 3)).toBeNull();
  });

  it("walks the backoff ladder 1m → 5m → 15m → 1h → 6h across the 5 retries", () => {
    const now = Date.now();
    RETRY_DELAYS_SEC.forEach((sec, i) => {
      const next = computeNextRetry(i + 1);
      expect(next).not.toBeNull();
      const t = next!.getTime();
      expect(t).toBeGreaterThanOrEqual(now + sec * 1000);
      expect(t).toBeLessThanOrEqual(Date.now() + sec * 1000 + 50);
    });
  });

  it("clamps attempt numbers above the ladder length", () => {
    expect(computeNextRetry(99)).toBeNull(); // >= MAX_ATTEMPTS → DLQ
    expect(computeNextRetry(0)).not.toBeNull();
  });
});

describe("attempt budget", () => {
  it("is initial + 5 retries = 6 total attempts, ladder has one slot per retry", () => {
    expect(RETRY_DELAYS_SEC).toEqual([60, 300, 900, 3600, 21_600]);
    expect(RETRY_DELAYS_SEC).toHaveLength(MAX_ATTEMPTS - 1);
  });
});
