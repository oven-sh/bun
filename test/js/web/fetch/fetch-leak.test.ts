import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  tls as COMMON_CERT,
  expectRssDeltaBelow,
  gc,
  isASAN,
  isCI,
  isDebug,
  isWindows,
  tempDir,
} from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { fstatSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
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

    const serveOptions: Bun.Serve.Options<undefined> = {
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

    const env: Record<string, string | undefined> = {
      ...bunEnv,
      SERVER: server.url.href,
      BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString(10),
      NAME: name,
    };

    if (isASAN) {
      // The fixture judges leakage by RSS delta, but ASAN's quarantine retains
      // freed allocations (256 MB by default): 1000 compressed-body requests
      // free ~65 MB of transient buffers and the delta still reads ~276 MB —
      // pure quarantine, measured with zero real leakage. Cap the child's
      // quarantine so RSS tracks live memory again; a genuine
      // one-body-per-request leak still exceeds the threshold by orders of
      // magnitude.
      env.ASAN_OPTIONS = `${bunEnv.ASAN_OPTIONS ?? ""}:quarantine_size_mb=32`.replace(/^:/, "");
    }

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

      const rss: number[] = [];

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
    // The URLSearchParams variant URL-encodes the 2MB body on each of the 500
    // requests - pure throughput that a debug build cannot fit in 20s, and
    // ASAN instrumentation overruns the 20s release deadline the same way
    // (observed 20000.61ms on the x64-asan lane).
    isDebug || isASAN ? 120 * 1000 : 20 * 1000,
  );
});

test("do not leak", async () => {
  await using server = createServer((req, res) => {
    res.end();
  });

  let url;
  let isDone = false;
  server.listen(0, "127.0.0.1", function attack() {
    if (isDone) {
      return;
    }
    url ??= new URL(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
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
    const rss = process.memoryUsage.rss;
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
    const baseline = rss();

    for (let i = 0; i < 200; i++) await hit();
    Bun.gc(true);
    const final = rss();

    const deltaMB = (final - baseline) / 1024 / 1024;
    console.log(JSON.stringify({ baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
    // ASAN's quarantine retains freed allocations (default 256 MB) so RSS
    // deltas run far higher under bun-asan; widen the threshold there.
    if (deltaMB > ${isASAN ? 256 : 32}) {
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

test("fetch() compress option does not leak bodies or compressor state", async () => {
  // Exercises:
  //  - all four encodings
  //  - the custom-level path (allocates a temporary libdeflate compressor that
  //    must be freed each call)
  //  - a small body (HTTP-thread LibdeflateState shared_buffer fast path)
  //  - a ~700 KiB body (zlib-streaming slow path → per-request Vec, freed
  //    with the request)
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      // Drain the body so the request completes; don't decompress (server-side
      // allocator noise would mask the client-side signal we're measuring).
      await req.arrayBuffer();
      return new Response();
    },
  });

  const script = /* js */ `
    const url = process.env.SERVER;
    const small = Buffer.alloc(32 * 1024, "abcdefghij");
    // > 512 KiB shared buffer → slow path; large enough that the compressed
    // output also spans multiple socket writes.
    const big = Buffer.alloc(700 * 1024, "abcdefghij");
    const rss = process.memoryUsage.rss;
    const opts = [
      { compress: "gzip" },
      { compress: "deflate" },
      { compress: "br" },
      { compress: "zstd" },
      // custom level → temp libdeflate compressor alloc/free each call
      { compress: { encoding: "gzip", level: 1 } },
    ];

    async function round() {
      const promises = [];
      for (const opt of opts) {
        promises.push(fetch(url, { method: "POST", body: small, ...opt }).then(r => r.arrayBuffer()));
        promises.push(fetch(url, { method: "POST", body: big,   ...opt }).then(r => r.arrayBuffer()));
      }
      await Promise.all(promises);
    }

    // Warm up: HTTP-thread LibdeflateState (lazy compressor + 512 KiB
    // shared_buffer) is allocated once here and stays for the process.
    for (let i = 0; i < 10; i++) await round();
    Bun.gc(true);
    const baseline = rss();

    for (let i = 0; i < 80; i++) await round();
    Bun.gc(true);
    const final = rss();

    const deltaMB = (final - baseline) / 1024 / 1024;
    console.log(JSON.stringify({ baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
    // 80 rounds × 5 encodings × ~700 KiB bodies → a per-request leak of the
    // body or compressor state would grow RSS by hundreds of MB.
    if (deltaMB > ${isASAN ? 256 : 32}) {
      throw new Error("fetch({compress}) leaked " + Math.round(deltaMB) + " MB over 80 rounds");
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", script],
    env: { ...bunEnv, SERVER: server.url.href },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log(stdout.trim());
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
}, 60000);

// Response-side: a compressed body that arrives across many packets bypasses
// the libdeflate one-shot fast path (InternalState.rs:256) and allocates a
// boxed streaming Decompressor (zlib/brotli/zstd FFI handle) per request,
// freed via Drop on InternalState::reset(). Dripping the body over chunked
// transfer encoding forces handle_response_body_chunked_encoding_from_multiple_packets.
// Paired with compress: on the request side so the same loop covers the
// multi-write send of a large compressed request body too.
test("fetch() does not leak streaming decompressor state across fragmented compressed responses", async () => {
  const script = /* js */ `
    import { createServer } from "node:net";
    import { gzipSync, brotliCompressSync, zstdCompressSync } from "node:zlib";
    const rss = process.memoryUsage.rss;

    const plain = Buffer.alloc(64 * 1024, "abcdefghij");
    const bodies = {
      gzip: gzipSync(plain),
      br: brotliCompressSync(plain),
      zstd: zstdCompressSync(plain),
    };
    // ~700 KiB request body → compressed output exceeds the 512 KiB shared
    // buffer and spans multiple socket writes.
    const reqBody = Buffer.alloc(700 * 1024, "abcdefghij");

    const server = createServer(sock => {
      let buf = "";
      sock.on("data", async chunk => {
        buf += chunk.toString("latin1");
        // Drain the request: headers + (chunked) body terminator.
        if (!buf.includes("\\r\\n\\r\\n")) return;
        const isChunked = /transfer-encoding:\\s*chunked/i.test(buf);
        if (isChunked && !buf.includes("\\r\\n0\\r\\n\\r\\n")) return;
        if (!isChunked) {
          const m = buf.match(/content-length:\\s*(\\d+)/i);
          const need = m ? Number(m[1]) : 0;
          const bodyStart = buf.indexOf("\\r\\n\\r\\n") + 4;
          if (buf.length - bodyStart < need) return;
        }
        const enc = buf.match(/x-want:\\s*(\\w+)/i)[1];
        const body = bodies[enc];
        sock.write(
          "HTTP/1.1 200 OK\\r\\n" +
          "Content-Encoding: " + enc + "\\r\\n" +
          "Transfer-Encoding: chunked\\r\\n" +
          "Connection: close\\r\\n\\r\\n",
        );
        // Drip in small chunks so the client's Decompressor sees many
        // update_buffers()/read_all() cycles before the final flush.
        for (let i = 0; i < body.length; i += 256) {
          const piece = body.subarray(i, i + 256);
          sock.write(piece.length.toString(16) + "\\r\\n");
          sock.write(piece);
          sock.write("\\r\\n");
          // Yield so chunks land in separate packets.
          await new Promise(r => setImmediate(r));
        }
        sock.end("0\\r\\n\\r\\n");
      });
      sock.on("error", () => {});
    }).listen(0, "127.0.0.1");
    await new Promise(r => server.once("listening", r));
    const url = "http://127.0.0.1:" + server.address().port + "/";

    async function round() {
      const promises = [];
      for (const enc of ["gzip", "br", "zstd"]) {
        promises.push(
          fetch(url, {
            method: "POST",
            body: reqBody,
            compress: enc,
            headers: { "x-want": enc },
          }).then(async r => {
            const got = Buffer.from(await r.arrayBuffer());
            if (!got.equals(plain)) throw new Error(enc + " round-trip mismatch (" + got.length + ")");
          }),
        );
      }
      await Promise.all(promises);
    }

    for (let i = 0; i < 10; i++) await round();
    Bun.gc(true);
    const baseline = rss();

    for (let i = 0; i < 60; i++) await round();
    Bun.gc(true);
    const final = rss();

    server.close();
    const deltaMB = (final - baseline) / 1024 / 1024;
    console.log(JSON.stringify({ baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
    // 60 rounds × 3 encodings = 180 streaming Decompressor handles + 180
    // ~700 KiB compressed request bodies. A leaked boxed zlib/brotli/zstd
    // reader or an un-freed compressed body Vec would grow RSS by >100 MB.
    if (deltaMB > ${isASAN ? 256 : 32}) {
      throw new Error("fragmented compressed fetch leaked " + Math.round(deltaMB) + " MB over 60 rounds");
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
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
}, 60000);

// fetch.rs 'extract_proxy: jsc::URL::href_from_js() returns a +1 WTFStringImpl
// ref into a bun_core::String, which is Copy and has no Drop. Without wrapping
// in OwnedString the +1 is never released, leaking one WTFStringImpl (≈ the
// proxy URL's byte length) per fetch({proxy}) call. Both the string form
// (proxy: "http://...") and the object form (proxy: {url: "http://..."}) go
// through href_from_js at separate call sites.
describe.each(["string", "object"])("fetch({proxy}) %s form does not leak the proxy href WTFStringImpl", form => {
  test.concurrent(
    "RSS stays bounded",
    async () => {
      // Target a non-existent blob: URL so each fetch() parses the proxy option
      // (where the leak occurs) then rejects synchronously in the blob registry
      // lookup, with no network I/O.
      const script = /* js */ `
        // ~256 KiB path so each leaked WTFStringImpl shows up in RSS well above
        // allocator noise. Build a FRESH proxy string per iteration: reusing one
        // JS string would make href_from_js return the same StringImpl every
        // call (only the refcount grows, RSS stays flat) and hide the leak.
        const pad = Buffer.alloc(256 * 1024, "a").toString();
        const rss = process.memoryUsage.rss;

        async function hit(i) {
          const proxyUrl = "http://127.0.0.1:1/" + i + "/" + pad;
          const opts = ${form === "string" ? `{ proxy: proxyUrl }` : `{ proxy: { url: proxyUrl } }`};
          // 41-byte blob: URL (5 + 36-char UUID) so ZigURL::is_blob() matches
          // and fetch rejects from the blob registry with no FetchTasklet.
          try { await fetch("blob:00000000-0000-0000-0000-000000000000", opts); } catch {}
        }

        // Warm up (JIT, allocator page commit).
        for (let i = 0; i < 20; i++) await hit(-i);
        Bun.gc(true);
        const baseline = rss();

        const ITERS = 150;
        for (let i = 0; i < ITERS; i++) await hit(i);
        Bun.gc(true);
        const final = rss();

        const deltaMB = (final - baseline) / 1024 / 1024;
        console.log(JSON.stringify({
          form: ${JSON.stringify(form)},
          baselineMB: (baseline / 1024 / 1024) | 0,
          finalMB: (final / 1024 / 1024) | 0,
          deltaMB: Math.round(deltaMB * 10) / 10,
        }));
        // 150 × 256 KiB ≈ 37 MiB leaked when the +1 is dropped on the floor
        // (measured ~43 MiB on debug+ASAN); with the deref in place the delta
        // is URL-size-independent noise (~10 MiB on debug+ASAN, ~0 on release).
        if (deltaMB > 20) {
          throw new Error("fetch({proxy}) leaked " + deltaMB.toFixed(1) + " MB over " + ITERS + " iterations");
        }
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "-e", script],
        env: {
          ...bunEnv,
          // ASAN quarantine retains freed allocations; this path churns several
          // 256 KiB buffers per iteration, which would dominate the RSS delta
          // and mask the real signal. Disable quarantine in the child so only
          // never-freed memory shows up.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      console.log(stdout.trim());
      if (exitCode !== 0) console.error(stderr);
      expect({ stdout: stdout.includes("deltaMB"), stderr, exitCode }).toEqual({
        stdout: true,
        stderr: "",
        exitCode: 0,
      });
    },
    90000,
  );
});

// fetch.rs url_type != Remote: url_string carries a +1 WTFStringImpl ref
// (create_format for blob:, file_url_from_string → Bun::toStringRef for file:)
// that was passed to Response::init as url_string.clone() (inherent clone()
// does dupe_ref(), so +2). Response::init adopts one ref; the local +1 was
// never released, leaking one StringImpl ≈ "file://<path>".length per call.
test.concurrent(
  "fetch(file://...) does not leak the response url WTFStringImpl",
  async () => {
    // The leaked impl is "file://<resolved abs path>", and fetch_impl decodes
    // url.path into a stack PathBuffer that is 1024 bytes on macOS/BSD, 4096 on
    // Linux, ~98 KiB on Windows. Use a ~900-byte path so decode_into succeeds on
    // every platform and url_string is actually assigned, with enough iterations
    // for the small per-call leak to show in RSS.
    const script = /* js */ `
    const pad = Buffer.alloc(900, "a").toString();
    // Windows strips the leading "/" then asserts is_absolute_windows() in
    // PosixToWinNormalizer under debug_assertions, which needs a drive letter.
    const prefix = process.platform === "win32" ? "file:///C:/" : "file:///";
    const rss = process.memoryUsage.rss;
    async function hit(i) {
      // Fresh path per iteration so each leaked ref pins a distinct impl.
      // The file does not exist; the Response is created (with url_string set)
      // and the lazy Blob body is never read, so no fs I/O happens.
      await fetch(prefix + i + pad);
    }
    async function hits(from, to) {
      for (let i = from; i < to; i++) {
        try { await hit(i); } catch {}
        if ((i & 1023) === 0) Bun.gc(true);
      }
      Bun.gc(true);
    }
    // The memory of the process grows by up to 25 MiB (ASAN) until it can hold what two collections have between them.
    await hits(-10000, 0);
    const baseline = rss();

    const ITERS = 20000;
    await hits(0, ITERS);
    const final = rss();

    const deltaMB = (final - baseline) / 1024 / 1024;
    console.log(JSON.stringify({
      baselineMB: (baseline / 1024 / 1024) | 0,
      finalMB: (final / 1024 / 1024) | 0,
      deltaMB: Math.round(deltaMB * 10) / 10,
    }));
    // ~0.9 KiB × 20000 ≈ 18 MiB raw leak (measured ~32 MiB on debug+ASAN)
    // when the extra ref is dropped on the floor; at most 4 MiB noise with the fix.
    if (deltaMB > 10) {
      throw new Error("fetch(file://) leaked " + deltaMB.toFixed(1) + " MB over " + ITERS + " iterations");
    }
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", script],
      env: {
        ...bunEnv,
        WebKitMallocForceEnabled: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    console.log(stdout.trim());
    if (exitCode !== 0) console.error(stderr);
    expect({ stdout: stdout.includes("deltaMB"), stderr, exitCode }).toEqual({
      stdout: true,
      stderr: "",
      exitCode: 0,
    });
  },
  120000,
);

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
    test(
      kind,
      async () => {
        const script = `
        const payload = Buffer.alloc(128 * 1024, 0x61); // 128 KiB of 'a'
        const str = payload.toString("latin1");
        const sharedBlob = new Blob([payload]);
        const rss = process.memoryUsage.rss;

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
        const baseline = rss();

        for (let i = 0; i < 32; i++) cycle();
        Bun.gc(true);
        const final = rss();

        const deltaMB = (final - baseline) / 1024 / 1024;
        console.log(JSON.stringify({ kind: "${kind}", baselineMB: (baseline / 1024 / 1024) | 0, finalMB: (final / 1024 / 1024) | 0, deltaMB: Math.round(deltaMB) }));
        // 32 cycles * 512 Requests * 128 KiB = 2 GiB through the pool. If deinit() is
        // skipped for any heap-backed variant, RSS climbs by ~2 GiB; with the
        // Zig semantics it stays flat. 64 MiB is well above GC/allocator noise.
        // ASAN's quarantine retains freed allocations so widen the threshold there.
        if (deltaMB > ${isASAN ? 320 : 64}) {
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
      // ASAN's quarantine retains freed allocations so RSS stays elevated
      // under bun-asan; the fixture only allows MAX_MEMORY_INCREASE MiB.
      MAX_MEMORY_INCREASE: isASAN ? "64" : "5", // in MB
      // The fixture asserts RSS stabilizes after iteration 250, but with the
      // default 256 MB quarantine the freed 128 KB bodies are never reused and
      // RSS keeps climbing through all 500 iterations (~97 MB past the sample
      // point, over the 64 MB allowance). Cap the quarantine so freed churn
      // recycles and the stabilization the test asserts can actually happen.
      ...(isASAN && { ASAN_OPTIONS: `${bunEnv.ASAN_OPTIONS ?? ""}:quarantine_size_mb=32`.replace(/^:/, "") }),
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
test(
  "should not leak request-body ReadableStream when server ignores the body",
  async () => {
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
    // The scenario itself takes ~100 ms; under ASAN the spawned child's startup
    // (shadow-memory init) plus suite load overruns the 5 s default. Standalone
    // ASAN runs pass in well under a second.
  },
  isASAN ? 30_000 : 5_000,
);

test.concurrent("a body taken from under a pending text() unroots its promise", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { heapStats } = require("bun:jsc");
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response(new ReadableStream({ start: c => c.enqueue(new Uint8Array(1)) })),
      });
      const rooted = () => heapStats().protectedObjectTypeCounts.Promise ?? 0;
      async function once() {
        const response = await fetch(server.url);
        response.text();
        await Bun.$\`\${process.execPath} --version < \${response}\`.quiet();
      }
      await once();
      const before = rooted();
      for (let i = 0; i < 4; i++) await once();
      console.log(rooted() - before);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});

// The Response's abort listener takes a +1 on the AbortSignal; dropping the
// Response must release it. Run in a subprocess so heapStats is not polluted by the
// suite's other concurrent tests, and so the destruct-on-exit teardown of a
// timeout signal with the listener still attached is exercised.
// https://github.com/oven-sh/bun/issues/32659
test.concurrent(
  "fetch Response's abort-signal listener does not leak the AbortSignal",
  async () => {
    const script = `
    const { heapStats } = require("bun:jsc");
    const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(8)) });
    const count = async () => {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
      Bun.gc(true);
      return heapStats().objectTypeCounts.AbortSignal || 0;
    };
    async function once() {
      const ac = new AbortController();
      const res = await fetch(server.url, { signal: ac.signal });
      await res.arrayBuffer().catch(() => {});
    }
    for (let i = 0; i < 8; i++) await once();
    const baseline = await count();
    for (let i = 0; i < 64; i++) await once();
    const after = await count();
    // One more with a pending AbortSignal.timeout() so exit teardown runs
    // BodyAbortListener::drop on a signal whose m_timeout is still set.
    const res = await fetch(server.url, { signal: AbortSignal.timeout(60_000) });
    await res.arrayBuffer().catch(() => {});
    server.stop(true);
    console.log(JSON.stringify({ baseline, after }));
    process.exit(after > baseline + 4 ? 1 : 0);
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain('"after"');
    expect(exitCode).toBe(0);
  },
  isASAN ? 30_000 : 5_000,
);

test.concurrent("a fetch Response held only by its signal's abort listener is collected", async () => {
  // A body past the receive high-water mark that is never read keeps the fetch in flight until the Response is finalized.
  const script = `
    const { heapStats } = require("bun:jsc");
    const large = new Uint8Array(1024 * 1024);
    const server = Bun.serve({ port: 0, fetch: request => new Response(request.url.endsWith("/large") ? large : new Uint8Array(8)) });
    const statuses = [];
    async function once(path, readBody) {
      const controller = new AbortController();
      const response = await fetch(new URL(path, server.url), { signal: controller.signal });
      controller.signal.addEventListener("abort", () => statuses.push(response.status));
      if (readBody) await response.arrayBuffer();
    }
    for (let i = 0; i < 16; i++) {
      await once("/small", true);
      await once("/small", false);
      await once("/large", false);
    }
    let counts;
    for (let i = 0; i < 10; i++) {
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
      counts = heapStats().objectTypeCounts;
      if ((counts.Response ?? 0) <= 2) break;
    }
    server.stop(true);
    console.log(JSON.stringify({ Response: counts.Response ?? 0, AbortSignal: counts.AbortSignal ?? 0 }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const counts = JSON.parse(stdout.trim());
  // Each count includes the class's prototype object. Leaked: 49 and 49.
  expect(counts.Response).toBeLessThanOrEqual(2);
  expect(counts.AbortSignal).toBeLessThanOrEqual(2);
  expect(exitCode).toBe(0);
});

test.concurrent("a fetch Response outlives the wrapper of the signal it was fetched with", async () => {
  const script = `
    const { heapStats } = require("bun:jsc");
    const server = Bun.serve({ port: 0, fetch: () => new Response("hello") });
    const responses = [];
    for (let i = 0; i < 20; i++) responses.push(await fetch(server.url, { signal: new AbortController().signal }));
    let counts;
    for (let i = 0; i < 10; i++) {
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
      counts = heapStats().objectTypeCounts;
      if ((counts.AbortSignal ?? 0) <= 2) break;
    }
    const clones = responses.map(response => response.clone());
    const texts = await Promise.all([...responses, ...clones].map(response => response.text()));
    server.stop(true);
    console.log(JSON.stringify({ AbortSignal: counts.AbortSignal ?? 0, bodies: texts.filter(text => text === "hello").length }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // The count includes the class's prototype object. Rooted by the Responses: 21.
  const result = JSON.parse(stdout.trim());
  expect(result.AbortSignal).toBeLessThanOrEqual(2);
  expect(result.bodies).toBe(40);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/32659
test("aborting an in-flight streaming fetch() discards the buffered body and errors the reader", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const CHUNK = new Uint8Array(256 * 1024);
        let sent = 0;
        let serverAbort;
        using server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch(req) {
            serverAbort = new Promise(r => req.signal.addEventListener("abort", () => r()));
            return new Response(
              new ReadableStream({ pull(c) { c.enqueue(CHUNK); sent++; } }),
            );
          },
        });
        const ac = new AbortController();
        const res = await fetch(server.url, { signal: ac.signal });
        const reader = res.body.getReader();
        await reader.read();
        // Wait for the server's pull to stop advancing: the transport and
        // the client's response buffer are full, so the abort lands on a
        // body with buffered-but-unread bytes. Bounded so a backpressure
        // regression fails the assertions instead of hanging here.
        for (let last = sent, p = 0; p < 200; last = sent, p++) {
          await Bun.sleep(5);
          if (sent === last && sent > 2) break;
        }
        ac.abort();
        // Once the server observes the abort the client socket is closed,
        // so the client-side error callback has run.
        await serverAbort;
        for (let i = 0; i < 5; i++) await Bun.sleep(1);
        let drained = 0, result;
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) { result = { done: true }; break; }
            drained += r.value.length;
          }
        } catch (e) { result = { error: e.name }; }
        console.log(JSON.stringify({ drained, result }));
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    // ASAN/debug builds may emit benign stderr noise; stdout carries the result.
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const { drained, result } = JSON.parse(stdout.trim());
  // Before the fix the reader drained the retained native buffer then saw
  // { done: true }; now the buffer is released and the stored error is
  // surfaced to the next pull.
  expect(result).toEqual({ error: "AbortError" });
  // Only what was already in the JS-side stream queue remains readable.
  expect(drained).toBeLessThan(2 * 1024 * 1024);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/32659
test("aborting in-flight streaming fetch() responses does not retain the buffered body off-heap", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-abort-stream-leak-fixture.ts")],
    env: {
      ...bunEnv,
      ITERATIONS: "60",
      // Unfixed, every held iteration retains its multi-MB buffered body
      // (>100MB total); 55 absorbs allocator noise (Windows release measured
      // 32.8MB of it) while staying far below the leak.
      MAX_GROWTH_MB: "55",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("held=60");
  expect(stderr).not.toContain("LEAK");
  expect(exitCode).toBe(0);
});

test("fetch().arrayBuffer() of a large Content-Length body peaks at ~1x the payload", async () => {
  // The per-packet handoff in FetchTasklet::callback appended each socket read
  // into scheduled_response_buffer via extend_from_slice, so the Vec grew by
  // amortized doubling. For a body just past a doubling step that left the
  // allocation the ArrayBuffer adopts at ~2x the payload, and the intermediate
  // reallocations spiked ru_maxrss well past 2x. Reserving Content-Length
  // exactly up front keeps it to a single allocation that is moved through to
  // the ArrayBuffer.
  //
  // Body size is 128 MiB + 1 MiB so the old doubling growth would have crossed
  // the 128 -> 256 step, making the unfixed peak reliably > 2x body.
  const bodyBytes = 129 * 1024 * 1024;
  const chunk = Buffer.alloc(256 * 1024, "abcdefghij");
  const server = net.createServer(socket => {
    socket.once("data", () => {
      socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${bodyBytes}\r\nConnection: close\r\n\r\n`);
      let sent = 0;
      const pump = () => {
        while (sent < bodyBytes) {
          const n = Math.min(chunk.length, bodyBytes - sent);
          sent += n;
          if (!socket.write(n === chunk.length ? chunk : chunk.subarray(0, n))) {
            socket.once("drain", pump);
            return;
          }
        }
        socket.end();
      };
      pump();
    });
    socket.on("error", () => {});
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-buffer-peak-fixture.ts")],
      env: {
        ...bunEnv,
        SERVER: `http://127.0.0.1:${port}/`,
        BODY_BYTES: String(bodyBytes),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    console.log(stdout.trim());
    expect(stderr).toBe("");
    const { bodyMB, rssBeforeMB, rssAfterMB } = JSON.parse(stdout.trim());
    expect(bodyMB).toBe(129);
    // Unfixed: the doubling reallocations (retained by ASAN quarantine / mimalloc
    //          page cache) leave RSS at >= 2x body over the pre-fetch resident
    //          set (release linux ~2.9x, debug+ASAN default quarantine ~2.7x).
    // Fixed:   a single exact allocation, ~1.0x body.
    const delta = rssAfterMB - rssBeforeMB;
    expect(delta).toBeLessThan(1.5 * bodyMB);
    expect(exitCode).toBe(0);
  } finally {
    server.close();
  }
}, 60000);

describe("fetch() frees a sent request body while the response is still streaming", () => {
  const endless = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue("data: 1\n\n");
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

  const secure = { tls: COMMON_CERT, hostname: "127.0.0.1" };
  const anyCert = { tls: { rejectUnauthorized: false } };
  type Transport = [serve: object, init: BunFetchRequestInit];
  const tcp: Transport = [{}, {}];
  const tls: Transport = [secure, anyCert];
  const h2: Transport = [
    { ...secure, http2: true, http1: false },
    { ...anyCert, protocol: "http2" },
  ];
  const h3: Transport = [
    { ...secure, http3: true, http1: false },
    { ...anyCert, protocol: "http3" },
  ];

  test.concurrent.each<[string, string, ...Transport]>([
    // Copied per fetch().
    ["typed array", `const body = () => bytes;`, ...tcp],
    // Transcoded to UTF-8 per fetch().
    ["non-ASCII string", `const shared = bytes.latin1Slice() + "\\u00e9"; const body = () => shared;`, ...tcp],
    // fetch() shares these with the JS value, so each fetch() needs a value that only it keeps.
    ["ASCII string", `const body = () => bytes.latin1Slice();`, ...tcp],
    ["Blob", `const body = () => new Blob([bytes]);`, ...tcp],
    ["typed array that a 303 redirect drops", `const body = () => bytes; path = "/303";`, ...tcp],
    [
      "typed array and its compressed copy",
      `require("crypto").randomFillSync(bytes); const body = () => bytes;`,
      {},
      { compress: { encoding: "zstd", level: 1 } },
    ],
    ["typed array over TLS", `const body = () => bytes;`, ...tls],
    ["typed array over HTTP/2", `const body = () => bytes;`, ...h2],
    ["typed array over HTTP/3", `const body = () => bytes;`, ...h3],
  ])("%s", async (_, setup, options, init) => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      ...options,
      async fetch(req) {
        await req.arrayBuffer();
        return new URL(req.url).pathname === "/303" ? Response.redirect("/", 303) : endless();
      },
    });
    // TLS is slow on a debug build.
    const count = init.tls ? 12 : 24;
    const code = /* js */ `
      const bytes = Buffer.alloc(4 * 1024 * 1024, "a");
      const init = { ...${JSON.stringify(init)}, method: "POST" };
      let path = "/";
      ${setup}
      const responses = [];
      async function run(count) {
        for (let i = 0; i < count; i++) {
          const response = await fetch(new URL(path, ${JSON.stringify(server.url.href)}), { ...init, body: body() });
          // Any other response has ended, which frees the body anyway.
          if (response.status !== 200 || response.redirected !== (path === "/303")) throw new Error("not the stream");
          responses.push(response);
        }
        Bun.gc(true);
        return process.memoryUsage.rss();
      }
      const before = await run(2);
      const after = await run(${count});
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
      process.exit(0);
    `;
    // Unfixed: 4 MiB per request. Fixed: about 0, but up to a third of that for the values that the
    // GC frees on a debug build, where a loop that only makes them grows no less.
    await expectRssDeltaBelow(["--smol", "-e", code], { release: count * 2, debug: count * 2.5 });
  });

  // How many of this process's file descriptors are open on `path`.
  function countOpen(path: string) {
    const { dev, ino } = statSync(path);
    return readdirSync("/dev/fd").filter(fd => {
      try {
        const stat = fstatSync(+fd);
        return stat.dev === dev && stat.ino === ino;
      } catch {
        // The descriptor that read the directory.
        return false;
      }
    }).length;
  }

  // Windows has no sendfile(): fetch() reads the file first and sends bytes.
  test.concurrent.skipIf(isWindows)("file sent with sendfile()", async () => {
    using dir = tempDir("fetch-sendfile-body", { "body.bin": Buffer.alloc(64 * 1024, "a") });
    const path = join(String(dir), "body.bin");
    let beforeHead = -1;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.arrayBuffer();
        beforeHead = countOpen(path);
        return endless();
      },
    });
    const response = await fetch(server.url, { method: "POST", body: Bun.file(path) });
    const afterHead = countOpen(path);
    await response.body!.cancel();
    expect({ beforeHead, afterHead }).toEqual({ beforeHead: 1, afterHead: 0 });
  });

  test.concurrent.skipIf(isWindows)("when JavaScript is busy until more than the head has arrived", async () => {
    using dir = tempDir("fetch-busy-body", { "body.bin": Buffer.alloc(64 * 1024, "a") });
    const file = Promise.withResolvers<ReadableStreamDefaultController>();
    const redirected = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/file") {
          await req.arrayBuffer();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue("first");
                file.resolve(controller);
              },
            }),
          );
        }
        if (pathname === "/stream") return Response.redirect("/redirected", 303);
        if (pathname === "/redirected") {
          redirected.resolve();
          return endless();
        }
        // The client's HTTP thread follows redirects on its own. Once it is two hops further, it
        // has been through its event loop and has read what was written before those hops.
        const hop = +pathname.slice(1);
        if (hop === 0) await Promise.all([file.promise, redirected.promise]);
        if (hop === 3) (await file.promise).enqueue("second");
        if (hop < 6) return Response.redirect(`/${hop + 1}`, 302);
        delivered.resolve();
        return new Response();
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          import { fstatSync, readdirSync, readSync, statSync } from "node:fs";
          ${countOpen}
          const url = path => new URL(path, ${JSON.stringify(server.url.href)});
          const cancelled = Promise.withResolvers();
          const controller = new AbortController();
          const responses = Promise.all([
            fetch(url("/file"), { method: "POST", body: Bun.file("body.bin") }),
            fetch(url("/stream"), {
              method: "POST",
              body: new ReadableStream({ cancel: () => cancelled.resolve(true) }),
              signal: controller.signal,
            }),
            fetch(url("/0")),
          ]);
          readSync(0, Buffer.alloc(1));
          await responses;
          const open = countOpen("body.bin");
          // A stream is not a body that fetch() may just drop: its source has to be cancelled.
          Bun.gc(true);
          controller.abort();
          console.log(JSON.stringify({ open, cancelled: await cancelled.promise }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.race([delivered.promise, proc.exited]);
    proc.stdin.write("x");
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: `{"open":0,"cancelled":true}`, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // These pass without the early free too, and fail if it does not wait for the send. The server
  // answers first and reads once fetch() has resolved. Until then it takes 1 MiB of the 16, and the
  // flow-control window or the kernel a few more (the kernel of Windows takes everything).
  test.concurrent.each<[string, ...Transport]>([
    ["typed array", ...tcp],
    ["file", ...tcp],
    ["typed array over TLS", ...tls],
    // These have a second slice of the body in the stream, which would then point at freed memory.
    ["typed array over HTTP/2", ...h2],
    ["typed array over HTTP/3", ...h3],
    ["compressed copy over HTTP/2", h2[0], { ...h2[1], compress: { encoding: "zstd", level: 1 } }],
  ])("but not a %s that is still being sent", async (kind, options, init) => {
    const bytes = randomBytes(16 * 1024 * 1024);
    using dir = tempDir("fetch-unsent-body", kind === "file" ? { "body.bin": bytes } : {});
    const path = join(String(dir), "body.bin");
    const resolved = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      ...options,
      fetch: ({ body }) =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue("sha1 ");
              await resolved.promise;
              const sent = await Bun.readableStreamToBytes(body!);
              controller.enqueue(Bun.SHA1.hash(init.compress ? Bun.zstdDecompressSync(sent) : sent, "hex"));
              controller.close();
            },
          }),
        ),
    });
    const response = await fetch(server.url, {
      ...init,
      method: "POST",
      body: kind === "file" ? Bun.file(path) : bytes,
    });
    if (kind === "file" && !isWindows) expect(countOpen(path)).toBe(1);
    // Without ASAN, freed bytes stay as they were until the allocator collects them.
    Bun.gc(true);
    resolved.resolve();
    expect(await response.text()).toBe(`sha1 ${Bun.SHA1.hash(bytes, "hex")}`);
  });
});

test.concurrent("a read that replaces a pending read unroots its promise", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { heapStats } = require("bun:jsc");
      const { Readable } = require("node:stream");
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response(new ReadableStream({ start: c => c.enqueue(new Uint8Array(1)) })),
      });
      const rooted = () => heapStats().protectedObjectTypeCounts.Promise ?? 0;
      async function once() {
        const { body } = await fetch(server.url);
        const reader = body.getReader();
        await reader.read();
        reader.read().catch(() => {});
        reader.releaseLock();
        const readable = Readable.fromWeb(body).on("error", () => {}).resume();
        await new Promise(setImmediate);
        await new Promise(resolve => readable.on("close", resolve).destroy());
      }
      await once();
      const before = rooted();
      for (let i = 0; i < 4; i++) await once();
      console.log(rooted() - before);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});
