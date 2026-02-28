// Fixture for TLS keepalive memory leak detection.
// Spawned as a subprocess with --smol for clean memory measurement.
//
// Usage: bun --smol tls-keepalive-leak-fixture.js
// Env: TLS_CERT, TLS_KEY - PEM cert/key for the server
//      NUM_REQUESTS - number of requests to make (default 50000)
//      MODE - "same" (same TLS config) or "distinct" (unique configs)

const cert = process.env.TLS_CERT;
const key = process.env.TLS_KEY;
const numRequests = parseInt(process.env.NUM_REQUESTS || "50000", 10);
const mode = process.env.MODE || "same";

if (!cert || !key) {
  throw new Error("TLS_CERT and TLS_KEY env vars required");
}

using server = Bun.serve({
  port: 0,
  tls: { cert, key },
  hostname: "127.0.0.1",
  fetch() {
    return new Response("ok");
  },
});

const url = `https://127.0.0.1:${server.port}`;

// Warmup
for (let i = 0; i < 20_000; i++) {
  await fetch(url, {
    tls: { ca: cert, rejectUnauthorized: false },
    keepalive: true,
  }).then(r => r.text());
}
Bun.gc(true);
const baselineRss = process.memoryUsage.rss();

const requests = [];
if (mode === "same") {
  // All requests use the same TLS config — tests SSLConfig dedup
  const tlsOpts = { ca: cert, rejectUnauthorized: false };

  for (let i = 0; i < numRequests; i++) {
    await fetch(url, { tls: tlsOpts, keepalive: true }).then(r => r.text());
  }
} else if (mode === "distinct") {
  // Each request uses a unique TLS config — tests cache eviction
  for (let i = 0; i < numRequests; i++) {
    await fetch(url, {
      tls: { ca: cert, rejectUnauthorized: false, serverName: `host-${i}.example.com` },
      keepalive: true,
    }).then(r => r.text());
  }
}

// Allow the HTTP thread to process deferred SSL context frees
await Bun.sleep(100);
Bun.gc(true);
await Bun.sleep(100);
Bun.gc(true);
const finalRss = process.memoryUsage.rss();
const growthMB = (finalRss - baselineRss) / (1024 * 1024);

// Output as JSON for the parent test to parse
console.log(
  JSON.stringify({
    baselineRss,
    finalRss,
    growthMB: Math.round(growthMB * 100) / 100,
    numRequests,
    mode,
  }),
);
