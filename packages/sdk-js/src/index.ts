// Minimal HMAC-SHA256 helpers shared by ingest verification and customers.
// Uses WebCrypto so it runs in Node 20+, Edge, and browsers.

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("hmac", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(secret: string, rawBody: string): Promise<string> {
  return `sha256=${await hmacHex(secret, rawBody)}`;
}

export async function verify(secret: string, rawBody: string, signature: string): Promise<boolean> {
  const expected = await sign(secret, rawBody);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
