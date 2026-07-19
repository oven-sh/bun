// Stress harness targeting BUN-2V5X / BUN-2V7T:
// concurrent-GC slot-scan crash (loadAndFence / visitChildren) on Windows.
//
// Shapes exercised (match the Sentry caller distribution):
//   JSFinalObject          -> wide object literals (inline + out-of-line props)
//   JSObjectWithButterfly  -> arrays grown via push / indexed writes
//   JSCellButterfly        -> spread of array literals (immutable butterfly)
//   JSLexicalEnvironment   -> closures capturing many locals
//
// Correlated features from Sentry (abort_signal + fetch + spawn) are driven
// alongside allocation churn so the GC markers see a mix of native-backed
// and pure-JS objects.
"use strict";

const DURATION_MS = Number(process.env.STRESS_MS || 60_000);
const QUIET = process.env.STRESS_QUIET === "1";
const t0 = Date.now();

// Local server so fetch() actually produces Response/Body objects and can be
// aborted mid-flight without touching the network.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    // Small JSON body so Response gets a real butterfly-backed object graph
    // when the caller does res.json(); delay so abort has a window.
    await Bun.sleep(5 + (Math.random() * 10) | 0);
    return Response.json({
      a: 1, b: "two", c: [1, 2, 3, 4, 5, 6, 7, 8],
      d: { x: 1, y: 2, z: 3, w: 4 },
    });
  },
});
const url = `http://127.0.0.1:${server.port}/`;

let live = []; // rolling retained set so objects survive into concurrent mark
let churn = 0;
let fetches = 0;
let aborts = 0;
let spawns = 0;

function makeWideObject(i) {
  // >8 own props forces out-of-line (butterfly) storage on JSFinalObject.
  return {
    p0: i, p1: i + 1, p2: "s" + i, p3: i * 2, p4: [i, i + 1, i + 2],
    p5: { k: i }, p6: i | 0, p7: i / 3, p8: i, p9: i, p10: i, p11: i,
    p12: i, p13: i, p14: i, p15: i,
  };
}

function makeClosureNest(seed) {
  // JSLexicalEnvironment: each layer is a scope with captured locals.
  let a = seed, b = seed + 1, c = seed + 2, d = seed + 3, e = seed + 4;
  let f = { a, b, c, d, e };
  return function outer() {
    let g = a + b, h = c + d, i = e + 1, j = f;
    return function inner() {
      return a + b + c + d + e + g + h + i + (j.a | 0);
    };
  };
}

function makeButterflies(seed) {
  // JSCellButterfly via spread-of-literal; JSObjectWithButterfly via push.
  const lit = [seed, seed + 1, seed + 2, seed + 3, seed + 4, seed + 5,
               "x", { q: seed }, [seed], seed + 6];
  const spread = [...lit, ...lit];
  const grown = [];
  for (let k = 0; k < 24; k++) grown.push({ k, seed, lit });
  return { spread, grown };
}

function allocBurst(n) {
  for (let i = 0; i < n; i++) {
    const o = makeWideObject(churn);
    const c = makeClosureNest(churn);
    const b = makeButterflies(churn);
    live.push(o, c, c(), b.spread, b.grown);
    churn++;
  }
  // Bound retained set so heap doesn't grow unbounded; drop oldest half.
  if (live.length > 40_000) live = live.slice(live.length >> 1);
}

async function fetchAbortLoop() {
  while (Date.now() - t0 < DURATION_MS) {
    const ac = new AbortController();
    // Register extra algorithms on the signal: more native-side listener churn.
    ac.signal.addEventListener("abort", () => { allocBurst(2); });
    ac.signal.addEventListener("abort", () => { void ac.signal.reason; });
    // Randomly abort before, during, or after the response.
    const when = Math.random();
    if (when < 0.25) ac.abort(new Error("early"));
    else setTimeout(() => ac.abort(new Error("mid")), 1 + (Math.random() * 8) | 0);
    try {
      const res = await fetch(url, { signal: ac.signal });
      // Allocate while body is inflight, then parse (more object graph).
      allocBurst(4);
      await res.json();
    } catch {
      aborts++;
    }
    fetches++;
    allocBurst(6);
    // Keep the AbortController itself alive briefly so GC sees it under mark.
    live.push(ac, ac.signal);
  }
}

async function spawnLoop() {
  // Lightweight child that exits immediately; exercises Bun.spawn + Promise
  // machinery alongside GC. Kept infrequent relative to fetch.
  const bun = process.execPath;
  while (Date.now() - t0 < DURATION_MS) {
    const ac = new AbortController();
    const proc = Bun.spawn({
      cmd: [bun, "-e", "1"],
      stdout: "ignore", stderr: "ignore",
      signal: ac.signal,
    });
    allocBurst(4);
    if (Math.random() < 0.3) ac.abort();
    await proc.exited;
    spawns++;
    await Bun.sleep(5);
  }
}

async function allocLoop() {
  while (Date.now() - t0 < DURATION_MS) {
    allocBurst(64);
    // Yield so concurrent GC markers interleave with mutator.
    await Bun.sleep(0);
  }
}

function statusLoop() {
  if (QUIET) return;
  const id = setInterval(() => {
    const mem = process.memoryUsage();
    console.error(
      `[${((Date.now() - t0) / 1000).toFixed(1)}s] ` +
      `churn=${churn} live=${live.length} fetches=${fetches} ` +
      `aborts=${aborts} spawns=${spawns} rss=${(mem.rss / 1048576) | 0}M`
    );
  }, 2000);
  id.unref?.();
}

statusLoop();
await Promise.all([
  allocLoop(),
  fetchAbortLoop(),
  fetchAbortLoop(),
  fetchAbortLoop(),
  fetchAbortLoop(),
  spawnLoop(),
]);
server.stop(true);
console.error(`done: churn=${churn} fetches=${fetches} aborts=${aborts} spawns=${spawns}`);
process.exit(0);
