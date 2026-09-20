import { describe, expect, it } from "vitest";
import { sign, verify } from "./index";

describe("hookrelay-js", () => {
  it("round-trips sign → verify", async () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = await sign("secret-1", body);
    expect(sig.startsWith("sha256=")).toBe(true);
    await expect(verify("secret-1", body, sig)).resolves.toBe(true);
  });

  it("rejects tampered bodies and wrong secrets", async () => {
    const sig = await sign("secret-1", '{"a":1}');
    await expect(verify("secret-1", '{"a":2}', sig)).resolves.toBe(false);
    await expect(verify("other-secret", '{"a":1}', sig)).resolves.toBe(false);
    await expect(verify("secret-1", '{"a":1}', "sha256=deadbeef")).resolves.toBe(false);
  });
});
