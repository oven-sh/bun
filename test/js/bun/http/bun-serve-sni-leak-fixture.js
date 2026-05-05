// Fixture for Bun.serve() SNI domainRouter leak detection.
// Spawned as a subprocess with --smol for clean memory measurement.
//
// Each SNI hostname passed to Bun.serve() allocates an HttpRouter that is
// attached to the per-hostname SSL_CTX. On server teardown the SSL_CTX is
// freed by the SNI tree destructor, but the attached router used to be
// leaked. This fixture creates and tears down many servers with several SNI
// hostnames each and reports RSS growth.
//
// Env: TLS_CERT, TLS_KEY - PEM cert/key for the server
//      ITERATIONS - number of create/stop cycles (default 250)
//      SNI_NAMES - number of SNI hostnames per server (default 12)

const cert = process.env.TLS_CERT;
const key = process.env.TLS_KEY;
const iterations = parseInt(process.env.ITERATIONS || "250", 10);
const sniNames = parseInt(process.env.SNI_NAMES || "12", 10);

if (!cert || !key) {
  throw new Error("TLS_CERT and TLS_KEY env vars required");
}

// Build a tls array with many SNI hostnames. The first entry becomes the
// main SSL context; subsequent entries each allocate a per-hostname
// HttpRouter inside uWS.
function makeTlsConfig() {
  const tls = [];
  for (let i = 0; i < sniNames; i++) {
    tls.push({ cert, key, serverName: `host${i}.example.com` });
  }
  return tls;
}

// Routes add handlers (and tree nodes) to every per-SNI router, so leaked
// routers hold meaningfully more than just the base struct.
const routes = {
  "/a": () => new Response("a"),
  "/b": () => new Response("b"),
  "/c": () => new Response("c"),
  "/d": () => new Response("d"),
};

async function cycle() {
  const server = Bun.serve({
    port: 0,
    tls: makeTlsConfig(),
    routes,
    fetch: () => new Response("ok"),
    development: false,
  });
  server.stop(true);
}

// The uWS app (and its SNI routers) is only destroyed once the JS Server
// object has been finalized and a follow-up task runs on the event loop. Run
// batches, force GC, and yield so deferred deinit tasks can execute.
async function runBatches(total) {
  const batch = 25;
  for (let done = 0; done < total; done += batch) {
    const n = Math.min(batch, total - done);
    for (let i = 0; i < n; i++) await cycle();
    Bun.gc(true);
    await Bun.sleep(0);
    Bun.gc(true);
    await Bun.sleep(0);
  }
  // Final drain for any lingering deferred tasks.
  for (let i = 0; i < 4; i++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
}

// Warmup so baseline includes one-time SSL library allocations, mimalloc
// arena growth, etc.
await runBatches(40);
const baselineRss = process.memoryUsage.rss();

await runBatches(iterations);
const finalRss = process.memoryUsage.rss();
const growthMB = (finalRss - baselineRss) / (1024 * 1024);

console.log(
  JSON.stringify({
    baselineRss,
    finalRss,
    growthMB: Math.round(growthMB * 100) / 100,
    iterations,
    sniNames,
  }),
);
