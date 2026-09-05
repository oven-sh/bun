/**
 * Subprocess fixture for the "memory probe" block of
 * proxy-stress-concurrent.test.ts.
 *
 * Issues <iterations> requests through a local CONNECT proxy (plain or TLS
 * outer socket, selected by argv) to a local https origin, in one of the
 * modes below, and prints exactly one JSON line:
 *
 *   completed     requests that returned status 200 with the expected body
 *   failed        requests that rejected or returned something else
 *   errors        `failed`, counted by error code (or error name)
 *   connects      CONNECT requests the proxy received
 *   sslCtxGrowth  live SSL_CTX count at the end minus the count after the
 *                 warm-up. Every tunnel owns one SSL_CTX (ProxyTunnel::start
 *                 builds it through us_ssl_ctx_from_options), so a tunnel
 *                 that is never released shows up here as +1 per request,
 *                 independent of how much memory it holds.
 *   sslCtxInFlight  the highest live SSL_CTX count sampled while tunnels were
 *                 in flight, minus the lowest count sampled while none were.
 *                 This is the number of tunnels alive at once that owned a
 *                 context: the proof that `sslCtxGrowth` can see a leak.
 *   rssGrowth     RSS at the end minus RSS after the warm-up, in bytes
 *
 * The first quarter of the iterations is the warm-up (JIT, allocator and
 * TLS first-use costs); both growth figures are measured over the rest.
 *
 * Usage: bun proxy-stress-memory-fixture.ts <http|https> <mode> <iterations>
 * Env:   TLS_CERT, TLS_KEY: PEM used by the origin and by the https proxy.
 *        The test passes them in so this child does not import "harness",
 *        which costs about a second of start-up per child in a debug build.
 *        The rest of the environment is bunEnv, which is also what enables
 *        the `bun:internal-for-testing` import below; to run this file by
 *        hand, set BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 and
 *        BUN_GARBAGE_COLLECTOR_LEVEL=0 as well.
 */

import { sslCtxLiveCount } from "bun:internal-for-testing";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const [proxyScheme, mode, iterStr] = process.argv.slice(2);
const iterations = Number(iterStr);
const isHttpsProxy = proxyScheme === "https";
const tlsCert = { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! };

type Abort = "never" | "microtask" | "after-connect";
const MODES: Record<string, { concurrency: number; abort: (i: number) => Abort }> = {
  // Let every request finish.
  "complete": { concurrency: 1, abort: () => "never" },
  // Abort on the microtask after fetch() returns: races the HTTP thread's connect.
  "abort-immediate": { concurrency: 1, abort: () => "microtask" },
  // Abort as soon as the proxy has read the CONNECT head.
  "abort-after-connect": { concurrency: 1, abort: () => "after-connect" },
  // 32 in flight at once, all complete.
  "concurrent-32": { concurrency: 32, abort: () => "never" },
  // 32 in flight at once, the odd ones aborted on the next microtask.
  "concurrent-32-abort": { concurrency: 32, abort: i => (i % 2 === 1 ? "microtask" : "never") },
  // The origin redirects once per request, so every iteration opens two tunnels.
  "redirect": { concurrency: 1, abort: () => "never" },
};
const { concurrency, abort } = MODES[mode];

// HTTPS origin. Optionally redirects once (for mode=redirect).
const origin = Bun.serve({
  port: 0,
  tls: tlsCert,
  fetch(req) {
    const url = new URL(req.url);
    if (mode === "redirect" && url.pathname === "/start") {
      return Response.redirect(`https://localhost:${origin.port}/final`, 302);
    }
    return new Response("ok-" + url.pathname);
  },
});

let connects = 0;
let onNextConnect: (() => void) | undefined;

// SSL_CTX samples. `sslCtxStart` is taken after the warm-up; until then the
// in-flight and idle samples are skipped, so that contexts created lazily
// during the warm-up do not count as tunnels.
let sslCtxStart = -1;
let sslCtxIdleMin = Infinity;
let sslCtxBusyMax = -Infinity;

// A CONNECT proxy (plain or TLS outer socket). It counts CONNECT heads so
// the test can check that every request went through it and so that
// "after-connect" aborts can be synchronized to the CONNECT boundary.
function handleClient(client: net.Socket) {
  client.on("error", () => {});
  let head = Buffer.alloc(0);
  let upstream: net.Socket | undefined;
  client.on("close", () => upstream?.destroy());
  client.on("data", chunk => {
    if (upstream) {
      upstream.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    const requestLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    const [method, target] = requestLine.split(" ");
    if (method === "CONNECT") {
      connects++;
      onNextConnect?.();
      onNextConnect = undefined;
    }
    const leftover = head.subarray(end + 4);
    // Dial the loopback address directly instead of resolving the target's
    // `localhost` (as proxy-stress-helpers does); only the port is taken from
    // the target.
    const port = Number(target.slice(target.lastIndexOf(":") + 1));
    upstream = net.connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (leftover.length) upstream!.write(leftover);
      // The first upstream byte is the origin's TLS ServerHello: the client
      // has started its tunnel by now, so its SSL_CTX is alive and counted.
      upstream!.once("data", () => {
        if (sslCtxStart !== -1) sslCtxBusyMax = Math.max(sslCtxBusyMax, sslCtxLiveCount());
      });
      // client → upstream is relayed by the "data" handler above; only the
      // upstream → client direction is piped.
      upstream!.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.destroy());
  });
}

const proxy = isHttpsProxy
  ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handleClient)
  : net.createServer(handleClient);
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const proxyUrl = `${proxyScheme}://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

const laxTls = { ca: tlsCert.cert, rejectUnauthorized: false } as const;

let completed = 0;
let failed = 0;
const errors: Record<string, number> = {};

function recordFailure(key: string) {
  failed++;
  errors[key] = (errors[key] ?? 0) + 1;
}

function errorKey(e: unknown): string {
  const any = e as { code?: unknown; name?: unknown };
  return typeof any?.code === "string" ? any.code : typeof any?.name === "string" ? any.name : String(e);
}

async function one(i: number): Promise<void> {
  const path = mode === "redirect" ? "/start" : `/${i}`;
  const expectedBody = mode === "redirect" ? "ok-/final" : `ok-${path}`;
  let signal: AbortSignal | undefined;
  const when = abort(i);
  if (when !== "never") {
    const ac = new AbortController();
    signal = ac.signal;
    if (when === "microtask") queueMicrotask(() => ac.abort());
    else new Promise<void>(resolve => (onNextConnect = resolve)).then(() => ac.abort());
  }

  try {
    const res = await fetch(`https://localhost:${origin.port}${path}`, {
      proxy: proxyUrl,
      keepalive: false,
      tls: laxTls,
      signal,
    });
    const body = await res.text();
    if (res.status === 200 && body === expectedBody) {
      completed++;
    } else {
      recordFailure(`unexpected response ${res.status} ${JSON.stringify(body)}`);
    }
  } catch (e) {
    recordFailure(errorKey(e));
  }
}

// Same choice as harness's rss().
const rss: () => number =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? (Bun.unsafe.memoryFootprint as () => number)
    : process.memoryUsage.rss;

const warmup = Math.floor(iterations / 4);
let rssStart = -1;

for (let done = 0; done < iterations; ) {
  const batch = Math.min(concurrency, iterations - done);
  await Promise.all(Array.from({ length: batch }, (_, j) => one(done + j)));
  done += batch;
  // Nothing is in flight here.
  if (rssStart === -1 && done >= warmup) {
    Bun.gc(true);
    rssStart = rss();
    sslCtxStart = sslCtxLiveCount();
  }
  if (sslCtxStart !== -1) sslCtxIdleMin = Math.min(sslCtxIdleMin, sslCtxLiveCount());
}

Bun.gc(true);
const rssEnd = rss();

// The HTTP thread frees the last request's tunnel (and its SSL_CTX) shortly
// after the response is delivered; wait for the count to come back down
// rather than read it mid-teardown. A leak keeps the count up and the loop
// gives up at the deadline, so the growth is still reported.
const deadline = Date.now() + 5_000;
while (sslCtxLiveCount() > sslCtxStart && Date.now() < deadline) {
  await Bun.sleep(5);
  Bun.gc(true);
}
const sslCtxEnd = sslCtxLiveCount();
sslCtxIdleMin = Math.min(sslCtxIdleMin, sslCtxEnd);

console.log(
  JSON.stringify({
    completed,
    failed,
    errors,
    connects,
    sslCtxGrowth: sslCtxEnd - sslCtxStart,
    sslCtxInFlight: sslCtxBusyMax === -Infinity ? 0 : sslCtxBusyMax - sslCtxIdleMin,
    rssGrowth: rssEnd - rssStart,
  }),
);

origin.stop(true);
proxy.close();
process.exit(0);
