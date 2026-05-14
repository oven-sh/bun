import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as COMMON_CERT, gc, isCI } from "harness";
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

// Regression for src/runtime/webcore/fetch/FetchTasklet.zig:601,614 —
// Holder.resolve/reject use `self.promise.swap()` which *consumes* (clears)
// the jsc.Strong handle on the fetch() promise before calling resolve()/reject().
// A port that reads-without-consuming (e.g. value_or_empty()) and forgets to
// clear the slot would leave one protected Promise root per fetch() call alive
// for the lifetime of the VM. This asserts the swap() consume semantics by
// checking protectedObjectTypeCounts.Promise returns to baseline after both
// the resolve and reject Holder paths have run.
test("fetch() promise Strong handle is consumed on resolve/reject (FetchTasklet Holder.swap)", async () => {
  const script = /* js */ `
    import { heapStats } from "bun:jsc";
    import { createServer } from "node:net";

    const protectedPromises = () => {
      Bun.gc(true);
      return heapStats().protectedObjectTypeCounts.Promise ?? 0;
    };

    // resolve path: real HTTP server (FetchTasklet.zig:601 — Holder.resolve)
    using ok = Bun.serve({ port: 0, fetch: () => new Response("hi") });

    // reject path: TCP server that hangs up before sending headers, so
    // result.isSuccess() == false → Holder.reject (FetchTasklet.zig:614)
    const bad = createServer(sock => sock.destroy()).listen(0, "127.0.0.1");
    await new Promise(r => bad.once("listening", r));
    const badURL = "http://127.0.0.1:" + bad.address().port + "/";

    // warm up both paths so any one-time lazily-protected promises are counted
    // in the baseline rather than the delta
    for (let i = 0; i < 4; i++) {
      await fetch(ok.url).then(r => r.text());
      await fetch(badURL).then(() => { throw new Error("expected reject"); }, () => {});
    }
    await new Promise(r => setImmediate(r));
    const baseline = protectedPromises();

    const N = 64;
    for (let i = 0; i < N; i++) {
      await fetch(ok.url).then(r => r.text());
      await fetch(badURL).then(() => { throw new Error("expected reject"); }, () => {});
    }
    // let any enqueued AnyTask Holder callbacks finish before measuring
    await new Promise(r => setImmediate(r));
    const after = protectedPromises();

    bad.close();

    console.log(JSON.stringify({ baseline, after, delta: after - baseline }));
    // Zig swap() releases the root; after settling, no fetch promise should
    // remain protected. Allow tiny slack for unrelated event-loop promises.
    if (after - baseline > 4) {
      throw new Error(
        "fetch() promise Strong leaked: protected Promise count grew by " +
          (after - baseline) + " over " + (N * 2) + " fetches (baseline=" + baseline + ", after=" + after + ")",
      );
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
}, 30000);

// Regression: src/collections/hive_array.zig:65-76 (HiveArray.put) + src/bun.zig HiveRef.unref.
// Zig's HiveRef.unref() calls `value.deinit()` BEFORE `pool.put()`, and `put()` itself runs
// no destructor (just `value.* = undefined`). So Body.Value.deinit() — which derefs the
// intrusive WTFStringImpl +1, frees InternalBlob bytes, and decrements the Blob.Store ref —
// is the only thing standing between a finalized Request and a leak of its pooled body.
// A port that maps "deinit then put" to "put runs Drop glue" leaks any Body.Value variant
// whose cleanup is a manual deinit() rather than a Drop impl (WTFStringImpl is a Copy raw
// pointer; Blob holds a manually-refcounted Store).
// Body.Value.HiveAllocator pool_size is 256, so cycle 512 Requests to cover both the
// in-hive slot path and the fallback-allocator path.
describe("Request body HiveRef pool returns slot via Body.Value.deinit (does not leak)", () => {
  for (const kind of ["String"] as const) {
    // TODO(zig-rust-divergence): Rust port skips Body.Value.deinit() on pool
    // return; see docs/ZIG_RUST_DIVERGENCE_AUDIT.md.
    test.todo(
      kind,
      async () => {
        const script = `
        const payload = Buffer.alloc(128 * 1024, 0x61); // 128 KiB of 'a'
        const str = payload.toString("latin1");
        const sharedBlob = new Blob([payload]);

        function makeBody() {
          ${
            // unique → fresh WTFStringImpl each time
            kind === "String" ? `return str + Math.random();` : `return sharedBlob;`
          }
        }

        function cycle() {
          const live = [];
          for (let i = 0; i < 512; i++) {
            live.push(new Request("http://x/", { method: "POST", body: makeBody() }));
          }
          // Drop all references; finalize() -> body.unref() -> (Zig spec) value.deinit() -> pool.put()
          live.length = 0;
          Bun.gc(true);
        }

        for (let i = 0; i < 8; i++) cycle();
        Bun.gc(true);
        const baseline = process.memoryUsage.rss();

        for (let i = 0; i < 32; i++) cycle();
        Bun.gc(true);
        const final = process.memoryUsage.rss();

        const deltaMB = (final - baseline) / 1024 / 1024;
        console.log(JSON.stringify({ kind: "${kind}", baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
        // 32 cycles * 512 Requests * 128 KiB = 2 GiB through the pool. If deinit() is
        // skipped for any heap-backed variant, RSS climbs by ~2 GiB; with the
        // Zig semantics it stays flat. 64 MiB is well above GC/allocator noise.
        if (deltaMB > 64) {
          throw new Error("Request body (${kind}) leaked " + Math.round(deltaMB) + " MB over 32 cycles of 512 Requests");
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
        if (exitCode !== 0) console.error(stderr);
        expect(stderr).not.toContain("leaked");
        expect(exitCode).toBe(0);
      },
      60000,
    );
  }
});

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

// Regression: POSTing a ReadableStream body whose underlying source's `pull`
// awaits a timer makes the request-body ResumableSink pause on backpressure
// (the chunk arrives after the sink went paused). If the server responds
// without reading the body, the HTTP layer never drains/resumes the sink, so
// `ondrain` never fires and the JS `drainReaderIntoSink` continuation (which
// captures the reader/stream graph) plus the FetchTasklet's startRequestStream
// ref used to leak forever — one ReadableStream/Controller/Reader per fetch.
test("should not leak request-body ReadableStream when server ignores the body", async () => {
  const script = `
    const { heapStats } = require("bun:jsc");
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const url = "http://localhost:" + server.port;

    function makeBody() {
      return new ReadableStream({
        async pull(c) {
          await Bun.sleep(5);
          c.enqueue(new Uint8Array(8));
          c.close();
        },
      });
    }
    function readableStreamCount() {
      Bun.gc(true);
      return heapStats().objectTypeCounts.ReadableStream || 0;
    }

    for (let i = 0; i < 5; i++) await fetch(url, { method: "POST", body: makeBody() });
    await Bun.sleep(20);
    const baseline = readableStreamCount();

    for (let i = 0; i < 25; i++) await fetch(url, { method: "POST", body: makeBody() });
    await Bun.sleep(50);
    const after = readableStreamCount();

    server.stop(true);
    console.log(JSON.stringify({ baseline, after }));
    // Each leaked fetch retains a ReadableStream; 25 leaked fetches would put
    // \`after\` ~25 above \`baseline\`. A small slack absorbs in-flight transients.
    if (after > baseline + 3) {
      console.error("LEAK: ReadableStream count grew from " + baseline + " to " + after);
      process.exit(1);
    }
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout + stderr).toContain('"after"');
  expect(stderr).not.toContain("LEAK");
  expect(exitCode).toBe(0);
});
