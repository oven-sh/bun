import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as COMMON_CERT, gc, isCI, isLinux } from "harness";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";

describe("fetch doesn't leak", () => {
  test("fixture #1", async () => {
    const body = new Blob(["some body in here!".repeat(100)]);
    var count = 0;
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        count++;
        return new Response(body);
      },
    });

    await using proc = Bun.spawn({
      env: {
        ...bunEnv,
        SERVER: server.url.href,
        COUNT: "200",
      },
      stderr: "inherit",
      stdout: "inherit",
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-leak-test-fixture.js")],
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(count).toBe(200);
  });

  // This tests for body leakage and Response object leakage.
  async function runTest(compressed, name) {
    const body = !compressed
      ? new Blob(["some body in here!".repeat(2000000)])
      : new Blob([Bun.deflateSync(crypto.getRandomValues(new Buffer(65123)))]);

    const tls = name.includes("tls");
    const headers = {
      "Content-Type": "application/octet-stream",
    };
    if (compressed) {
      headers["Content-Encoding"] = "deflate";
    }

    const serveOptions = {
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        return new Response(body, { headers });
      },
    };

    if (tls) {
      serveOptions.tls = { ...COMMON_CERT };
    }

    using server = Bun.serve(serveOptions);

    const env = {
      ...bunEnv,
      SERVER: server.url.href,
      BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString(10),
      NAME: name,
    };

    if (tls) {
      env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    if (compressed) {
      env.COUNT = "1000";
    }

    await using proc = Bun.spawn({
      env,
      stderr: "inherit",
      stdout: "inherit",
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-leak-test-fixture-2.js")],
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  }

  for (let compressed of [true, false]) {
    describe(compressed ? "compressed" : "uncompressed", () => {
      for (let name of ["tcp", "tls", "tls-with-client"]) {
        describe(name, () => {
          test("fixture #2", async () => {
            await runTest(compressed, name);
          }, 100000);
        });
      }
    });
  }
});

describe.each(["FormData", "Blob", "Buffer", "String", "URLSearchParams", "stream", "iterator"])("Sending %s", type => {
  test(
    "does not leak",
    async () => {
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          return new Response();
        },
      });

      const rss = [];

      await using process = Bun.spawn({
        cmd: [
          bunExe(),
          "--smol",
          join(import.meta.dir, "fetch-leak-test-fixture-5.js"),
          server.url.href,
          1024 * 1024 * 2 + "",
          type,
        ],
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...bunEnv,
        },
        ipc(message) {
          rss.push(message.rss);
        },
      });

      await process.exited;

      const first = rss[0];
      const last = rss[rss.length - 1];
      if (!isCI || !(last < first * 10)) {
        console.log({ rss, delta: (((last - first) / 1024 / 1024) | 0) + " MB" });
      }
      expect(last).toBeLessThan(first * 10);
    },
    20 * 1000,
  );
});

test("do not leak", async () => {
  await using server = createServer((req, res) => {
    res.end();
  }).listen(0);
  await once(server, "listening");

  let url;
  let isDone = false;
  server.listen(0, "127.0.0.1", function attack() {
    if (isDone) {
      return;
    }
    url ??= new URL(`http://127.0.0.1:${server.address().port}`);
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(res => res.arrayBuffer())
      .catch(() => {})
      .then(attack);
  });

  let prev = Infinity;
  let count = 0;
  var interval = setInterval(() => {
    isDone = true;
    gc();
    const next = process.memoryUsage().heapUsed;
    if (next <= prev) {
      expect(true).toBe(true);
      clearInterval(interval);
    } else if (count++ > 20) {
      clearInterval(interval);
      expect.unreachable();
    } else {
      prev = next;
    }
  }, 1e3);
});

test("fetch(data:) with percent-encoding does not leak", async () => {
  // DataURL.decodeData leaked the intermediate percent-decoded buffer (and the
  // base64 output buffer on decode error). Each fetch of a percent-encoded
  // data: URL leaked ~len(url.data) bytes from bun.default_allocator.
  const script = `
    // ~240KB of percent-encoded payload; the intermediate percent-decoded
    // buffer is allocated at url.data.len bytes and was previously leaked.
    const plain = "data:text/plain," + Buffer.alloc(240000, "%41").toString();
    // same payload is valid base64 (all 'A's); exercises the is_base64 branch
    const b64 = "data:text/plain;base64," + Buffer.alloc(240000, "%41").toString();
    // '!' is not base64 alphabet; exercises the error path that also leaked buf
    const bad = "data:text/plain;base64," + Buffer.alloc(240000, "%21").toString();

    async function hit() {
      await (await fetch(plain)).arrayBuffer();
      await (await fetch(b64)).arrayBuffer();
      let rejected = false;
      await fetch(bad).then(r => r.arrayBuffer(), () => { rejected = true; });
      if (!rejected) throw new Error("invalid base64 data: URL unexpectedly succeeded");
    }

    for (let i = 0; i < 40; i++) await hit();
    Bun.gc(true);
    const baseline = process.memoryUsage.rss();

    for (let i = 0; i < 200; i++) await hit();
    Bun.gc(true);
    const final = process.memoryUsage.rss();

    const deltaMB = (final - baseline) / 1024 / 1024;
    console.log(JSON.stringify({ baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
    if (deltaMB > 32) {
      throw new Error("fetch(data:) leaked " + Math.round(deltaMB) + " MB over 200 iterations");
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(stdout.trim());
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 60000);

test("should not leak using readable stream", async () => {
  const buffer = Buffer.alloc(1024 * 128, "b");
  using server = Bun.serve({
    port: 0,
    routes: { "/*": new Response(buffer) },
  });

  await using proc = Bun.spawn([bunExe(), join(import.meta.dir, "fetch-leak-test-fixture-6.js")], {
    env: {
      ...bunEnv,
      SERVER_URL: server.url.href,
      MAX_MEMORY_INCREASE: "5", // in MB
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exited, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
  expect(stdout + stderr).toContain("done");
  expect(exited).toBe(0);
});

// https://github.com/oven-sh/bun/issues/28741
// `Bun.gc(true)` called `mimalloc_cleanup(false)` BEFORE running the JS GC.
// The JS GC is what actually invokes finalizers (Blob → Store.deref → mi_free),
// so when it ran there was no subsequent mimalloc collection pass and the
// freed pages stayed cached on mimalloc's per-thread heaps instead of being
// returned to the OS. RSS stayed at peak even after every Blob was collected.
//
// Fix: call `mimalloc_cleanup(true)` after `runGC(true)` so mimalloc actually
// reclaims pages freed by finalizers.
//
// Linux-only: only on Linux does mimalloc's post-cleanup `madvise(MADV_DONTNEED)`
// cause the kernel to immediately evict pages and drop RSS. macOS uses
// `MADV_FREE_REUSABLE` (lazy — reclaimed only under memory pressure) and
// Windows uses `VirtualAlloc(MEM_RESET)` (stays in the working set), so
// `process.memoryUsage().rss` doesn't move on those platforms even though
// the fix is working. The runtime change applies everywhere; only the
// `rss`-based measurement is non-portable.
test.skipIf(!isLinux)("fetch response body memory is reclaimed by GC (#28741)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const BODY_SIZE = 1.5 * 1024 * 1024;
const FETCH_COUNT = 50;
const body = Buffer.alloc(BODY_SIZE, 0x42);

await using server = Bun.serve({
  port: 0,
  fetch() { return new Response(body); },
});

const startRss = process.memoryUsage().rss;

// Wrap in an async function so the blobs/responses go out of scope on return
// and become eligible for GC. (Top-level \`await\` in JSC keeps local bindings
// alive in the module's async state machine — that's a separate limitation.)
async function run() {
  let blobs = [];
  for (let i = 0; i < FETCH_COUNT; i++) {
    const res = await fetch("http://localhost:" + server.port + "/");
    blobs.push(await res.blob());
  }
}
await run();
const peakRss = process.memoryUsage().rss;

Bun.gc(true);
await new Promise(r => setTimeout(r, 300));
Bun.gc(true);

const finalRss = process.memoryUsage().rss;
const growth = peakRss - startRss;
const released = peakRss - finalRss;
const pct = growth > 0 ? (released / growth) * 100 : 100;

console.log(JSON.stringify({
  startMB: (startRss/1e6).toFixed(1),
  peakMB: (peakRss/1e6).toFixed(1),
  finalMB: (finalRss/1e6).toFixed(1),
  releasedPct: pct.toFixed(1),
}));

// Baseline (no fix): ~0% released — mimalloc never returns the pages.
// With fix: consistently 80-90% released.
process.exit(pct > 50 ? 0 : 1);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("releasedPct");
  expect(exitCode).toBe(0);
});
