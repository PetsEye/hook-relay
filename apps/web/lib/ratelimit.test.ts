import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, memoryStore, resetMemoryStore } from "./ratelimit";

describe("rate limiter", () => {
  beforeEach(() => resetMemoryStore());

  it("allows up to the limit, then blocks", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit("src", 3, memoryStore);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRateLimit("src", 3, memoryStore);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("fails open when the store throws", async () => {
    const evil = {
      async incr(): Promise<number> {
        throw new Error("redis down");
      },
      async expire(): Promise<unknown> {
        return 1;
      },
    };
    const r = await checkRateLimit("src", 1, evil);
    expect(r.allowed).toBe(true);
  });
});
