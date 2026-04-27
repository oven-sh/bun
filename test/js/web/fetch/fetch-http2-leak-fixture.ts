// Subprocess fixture for fetch-http2-leak.test.ts.
//
// Hammers an h2 endpoint and asserts that, once all responses are settled
// and the server's sessions are torn down, the native ClientSession/Stream
// counters return to zero and JS-side Response objects collect.

import { fetchH2Internals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";

const { liveCounts } = fetchH2Internals;

const { SERVER, SCENARIO = "get" } = process.env;
if (!SERVER) throw new Error("SERVER environment variable is not set");

const COUNT = parseInt(process.env.COUNT || "200", 10);
const BATCH = parseInt(process.env.BATCH || "20", 10);

const tls = { rejectUnauthorized: false } as const;
const h2 = { protocol: "http2", tls } as const;

async function one(i: number): Promise<number> {
  if (SCENARIO === "post") {
    const body = Buffer.alloc(1024, i & 0xff);
    const r = await fetch(SERVER, { ...h2, method: "POST", body });
    return (await r.arrayBuffer()).byteLength;
  }
  if (SCENARIO === "abort") {
    const ac = new AbortController();
    const p = fetch(SERVER, { ...h2, signal: ac.signal }).then(r => r.arrayBuffer());
    ac.abort();
    try {
      await p;
    } catch {}
    return 0;
  }
  // "get"
  const r = await fetch(SERVER, h2);
  return (await r.arrayBuffer()).byteLength;
}

let bytes = 0;
for (let i = 0; i < COUNT; i += BATCH) {
  const n = Math.min(BATCH, COUNT - i);
  const results = await Promise.all(Array.from({ length: n }, (_, j) => one(i + j)));
  for (const b of results) bytes += b;
}

if (SCENARIO !== "abort" && bytes === 0) {
  throw new Error("no bytes received");
}

// Ask the server to destroy every Http2Session it accepted so the pooled
// ClientSession's socket gets closed and the refcount drops.
await fetch(SERVER + "/__destroy_sessions", h2).catch(() => {});

// Wait for the http thread to observe the closes. Poll the native counters
// instead of sleeping a fixed amount.
let counts = liveCounts();
for (let i = 0; i < 200 && (counts.sessions > 0 || counts.streams > 0); i++) {
  await Bun.sleep(10);
  counts = liveCounts();
}

Bun.gc(true);
const responses = heapStats().objectTypeCounts.Response ?? 0;
console.log(JSON.stringify({ scenario: SCENARIO, count: COUNT, bytes, ...counts, responses }));

if (counts.streams !== 0) throw new Error(`leaked ${counts.streams} h2 Stream(s)`);
if (counts.sessions !== 0) throw new Error(`leaked ${counts.sessions} h2 ClientSession(s)`);
if (responses > 5) throw new Error(`leaked ${responses} Response object(s)`);

console.log("--pass--");
