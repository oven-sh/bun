// Subprocess fixture for fetch-proxy-tls-intern-race.test.ts.
//
// The SSLConfig intern/deref race is between the JS thread (calls intern()
// from fetch()) and the HTTP thread (calls deref() when a request completes).
// Both threads share the same process-level SSLConfig.GlobalRegistry.
//
// No workers needed: we fire a setImmediate loop that calls fetch() (intern)
// while in-flight requests complete on the HTTP thread (deref). When the
// HTTP thread's deref() takes count 1→0 and enters destroy(), a concurrent
// JS-thread intern() can find the dying config and do ref() 0→1.
//
// On debug builds with BUN_DEBUG_SSLConfig=1, scoped logging in deref()
// and destroy() widens the race window from ~10 CPU cycles to ~100μs+.
//
// If the race triggers, debugAssert/assertValid panics → non-zero exit.

const BACKEND_PORT = Number(process.env.BACKEND_PORT);
const PROXY_PORT = Number(process.env.PROXY_PORT);
const HARD_CAP_MS = Number(process.env.HARD_CAP_MS || 15000);

if (!BACKEND_PORT || !PROXY_PORT) {
  console.error("BACKEND_PORT and PROXY_PORT must be set");
  process.exit(2);
}

const url = `https://127.0.0.1:${BACKEND_PORT}/`;
const proxy = `http://127.0.0.1:${PROXY_PORT}`;
const tls = { rejectUnauthorized: false };

let stop = false;
let driverOk = 0;
let probes = 0;

// Probe: setImmediate loop firing fetch+abort. Each call to fetch() runs
// intern() on the JS thread. abort() causes the request to complete quickly,
// triggering deref() on the HTTP thread. The JS thread immediately queues
// the next tick, so intern() calls keep firing while HTTP-thread derefs happen.
function probe() {
  if (stop) return;
  const ac = new AbortController();
  fetch(url, { proxy, keepalive: false, tls, signal: ac.signal }).catch(() => {});
  ac.abort();
  probes++;
  setImmediate(probe);
}

// Driver: serial fetches with gaps. The gap lets the HTTP thread complete
// the request's deref() before the next intern(). With keepalive:false and
// no ca/cert/key, requires_custom_request_ctx=false → no SSL context cache
// ref → refcount cycles through 0 on each iteration IF probes aren't pinning it.
async function driver() {
  while (!stop) {
    try {
      const r = await fetch(url, { proxy, keepalive: false, tls });
      if ((await r.text()) === "ok") driverOk++;
    } catch {}
    await Bun.sleep(1);
  }
}

// Run both concurrently in the same event loop.
probe();
const driverDone = driver();

// Hard cap so the fixture always terminates.
await Bun.sleep(HARD_CAP_MS);
stop = true;
await driverDone;

process.stdout.write(JSON.stringify({ driverOk, probes }) + "\n");
process.exit(0);
