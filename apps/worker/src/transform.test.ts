import { describe, expect, it } from "vitest";
import { applyTransform, runTransform } from "./transform.js";

describe("runTransform", () => {
  it("passes the event in scope and returns the result", () => {
    const out = runTransform("return { ...event, extra: 42 }", { hello: "world" });
    expect(out).toEqual({ hello: "world", extra: 42 });
  });

  it("blocks network and globals", () => {
    for (const code of ["return typeof require", "return typeof fetch", "return typeof process", "return typeof Buffer"]) {
      expect(runTransform(code, {})).toBe("undefined");
    }
  });

  it("enforces the wall-clock timeout", () => {
    expect(() => runTransform("while (true) {}", {})).toThrow(/timed out/i);
  });

  it("rejects dynamic code eval (new Function)", () => {
    expect(() => runTransform("return new Function('return 1')()", {})).toThrow();
  });

  it("caps serialized output size", () => {
    expect(() => runTransform("return { blob: 'x'.repeat(300 * 1024) }", {})).toThrow(/too large/);
  });

  it("gives every run a fresh realm", () => {
    runTransform("globalThis.leaked = 1; return null", {});
    expect(runTransform("return typeof globalThis.leaked", {})).toBe("undefined");
  });
});

describe("applyTransform", () => {
  it("returns the raw payload when no transform is configured", () => {
    const payload = { a: 1 };
    expect(applyTransform(null, payload)).toEqual({ body: payload });
  });

  it("falls back to the raw payload with an error message on failure", () => {
    const payload = { a: 1 };
    const res = applyTransform({ id: "t1", endpointId: "e1", version: 1, code: "throw new Error('boom')" }, payload);
    expect(res.body).toEqual(payload);
    expect(res.error).toMatch(/boom/);
  });

  it("applies valid transforms", () => {
    const res = applyTransform({ id: "t1", endpointId: "e1", version: 1, code: "return { ...event, v: event.version }" }, { version: 9 });
    expect(res.body).toEqual({ version: 9, v: 9 });
    expect(res.error).toBeUndefined();
  });
});
