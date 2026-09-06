import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as COMMON_CERT, expectRssDeltaBelow, isASAN, isDebug } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

// Every test here spawns a child that runs many fetch() calls and compares RSS
// or heap object counts before and after. Debug and ASAN children run 10x
// slower than release, so the heavy ones get a longer ceiling.
const slowBuild = isDebug || isASAN;
const LEAK_TEST_TIMEOUT = slowBuild ? 90_000 : 20_000;

// ASAN's quarantine pins freed blocks (256 MB by default), so RSS would track
// allocation volume instead of live memory. Disable it in children that judge
// leaks by RSS delta. expectRssDeltaBelow() does the same thing.
const noQuarantineEnv = {
  ...bunEnv,
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
    .filter(Boolean)
    .join(":"),
};

// On macOS, RSS does not fall when memory is freed. phys_footprint does.
const RSS_FN = /* js */ `
  const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
`;

async function runChild(cmd: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("fetch doesn't leak", () => {
  test.concurrent(
    "fixture #1",
    async () => {
      const body = new Blob(["some body in here!".repeat(100)]);
      let count = 0;
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          count++;
          return new Response(body);
        },
      });

      const { stdout, stderr, exitCode } = await runChild(
        ["--smol", join(import.meta.dir, "fetch-leak-test-fixture.js")],
        { ...bunEnv, SERVER: server.url.href, COUNT: "200" },
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(count).toBe(200);
    },
    LEAK_TEST_TIMEOUT,
  );

  // This tests for body leakage and Response object leakage. The fixture fails
  // when RSS grows by more than a quarter of one body per request.
  const uncompressedBody = Buffer.alloc(4 * 1024 * 1024, "some body in here!");
  // Random bytes do not compress, so the wire body is as large as the decoded
  // one and arrives in many packets.
  const compressedRaw = crypto.getRandomValues(new Uint8Array(512 * 1024));
  const compressedBody = Bun.deflateSync(compressedRaw);

  describe.each(["compressed", "uncompressed"])("%s", mode => {
    const compressed = mode === "compressed";
    test.concurrent.each(["tcp", "tls", "tls-with-client"])(
      "%s fixture #2",
      async name => {
        const body = new Blob([compressed ? compressedBody : uncompressedBody]);
        const headers = {
          "Content-Type": "application/octet-stream",
          ...(compressed && { "Content-Encoding": "deflate" }),
        };
        const tls = name.includes("tls");
        let count = 0;
        using server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          ...(tls && { tls: { ...COMMON_CERT } }),
          fetch(req) {
            count++;
            return new Response(body, { headers });
          },
        });

        const COUNT = compressed ? 256 : 96;
        const { stdout, stderr, exitCode } = await runChild(
          ["--smol", join(import.meta.dir, "fetch-leak-test-fixture-2.js")],
          {
            ...noQuarantineEnv,
            SERVER: server.url.href,
            BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString(10),
            NAME: name,
            COUNT: String(COUNT),
            EXPECT_BYTES: String(compressed ? compressedRaw.byteLength : uncompressedBody.byteLength),
            ...(tls && { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
          },
        );
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const result = JSON.parse(stdout.trim());
        expect(result).toMatchObject({
          count: COUNT,
          bodyBytes: compressed ? compressedBody.byteLength : uncompressedBody.byteLength,
          responses: expect.any(Number),
        });
        expect(result.deltaMB).toBeLessThan(result.maxDeltaMB);
        // The warmup adds a tenth of COUNT.
        expect(count).toBe(COUNT + Math.ceil(COUNT / 10));
      },
      LEAK_TEST_TIMEOUT,
    );
  });
});

// https://github.com/oven-sh/bun/issues/13657: the request body's Blob store
// was never released, so every POST leaked its body.
describe.each(["FormData", "Blob", "Buffer", "String", "URLSearchParams", "stream", "iterator"])("Sending %s", type => {
  test.concurrent(
    "does not leak",
    async () => {
      let count = 0;
      using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
          count++;
          return new Response();
        },
      });

      // 12 measured batches of 10 POSTs with a 1 MiB body. A leaked body per
      // request grows RSS by 120 MiB. Noise is under 16 MiB on debug+ASAN.
      await expectRssDeltaBelow(
        ["--smol", join(import.meta.dir, "fetch-leak-test-fixture-5.js"), server.url.href, String(1024 * 1024), type],
        { release: 24, debug: 40 },
      );
      // 2 warmup batches plus 12 measured batches of 10.
      expect(count).toBe(140);
    },
    LEAK_TEST_TIMEOUT,
  );
});

// The AbortSignal tracker of a fetch() that was never aborted must still be
// released once the Response is gone.
test.concurrent(
  "fetch() with an AbortSignal against a node:http server does not leak the signal",
  async () => {
    const script = /* js */ `
    import { createServer } from "node:http";
    import { heapStats } from "bun:jsc";
    const server = createServer((req, res) => res.end()).listen(0, "127.0.0.1");
    await new Promise(r => server.once("listening", r));
    const url = "http://127.0.0.1:" + server.address().port + "/";

    const count = async () => {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
      Bun.gc(true);
      const c = heapStats().objectTypeCounts;
      return { AbortSignal: c.AbortSignal ?? 0, AbortController: c.AbortController ?? 0, Response: c.Response ?? 0 };
    };
    let bytes = 0;
    async function hit() {
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      bytes += (await res.arrayBuffer()).byteLength;
    }
    for (let i = 0; i < 5; i++) await hit();
    const baseline = await count();
    const N = 50;
    for (let i = 0; i < N; i++) await hit();
    const after = await count();
    server.close();
    const growth = {};
    for (const k in baseline) growth[k] = after[k] - baseline[k];
    console.log(JSON.stringify({ growth, bytes }));
  `;
    const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { growth, bytes } = JSON.parse(stdout.trim());
    expect(bytes).toBe(0);
    // Unfixed, each of the 50 fetches keeps its signal, controller, and Response.
    expect(growth.AbortSignal).toBeLessThanOrEqual(2);
    expect(growth.AbortController).toBeLessThanOrEqual(2);
    expect(growth.Response).toBeLessThanOrEqual(2);
  },
  LEAK_TEST_TIMEOUT,
);

test.concurrent(
  "fetch(data:) with percent-encoding does not leak",
  async () => {
    // DataURL.decodeData leaked the intermediate percent-decoded buffer (and the
    // base64 output buffer on decode error). Each fetch of a percent-encoded
    // data: URL leaked ~len(url.data) bytes from bun.default_allocator.
    const script = /* js */ `
      ${RSS_FN}
      // 720KB of percent-encoded payload (240KB decoded); the intermediate
      // percent-decoded buffer is allocated at url.data.len bytes and was
      // previously leaked.
      const plain = "data:text/plain," + Buffer.alloc(720000, "%41").toString();
      // same payload is valid base64 (all 'A's); exercises the is_base64 branch
      const b64 = "data:text/plain;base64," + Buffer.alloc(720000, "%41").toString();
      // '!' is not base64 alphabet; exercises the error path that also leaked buf
      const bad = "data:text/plain;base64," + Buffer.alloc(720000, "%21").toString();

      let plainBytes = 0, b64Bytes = 0, rejected = 0;
      async function hit() {
        plainBytes += (await (await fetch(plain)).arrayBuffer()).byteLength;
        b64Bytes += (await (await fetch(b64)).arrayBuffer()).byteLength;
        await fetch(bad).then(r => r.arrayBuffer(), () => { rejected++; });
      }

      for (let i = 0; i < 10; i++) await hit();
      Bun.gc(true);
      const baseline = rss();

      const N = 100;
      for (let i = 0; i < N; i++) await hit();
      Bun.gc(true);
      const final = rss();

      if (plainBytes !== 240000 * (N + 10)) throw new Error("plain decoded " + plainBytes + " bytes");
      if (b64Bytes !== 180000 * (N + 10)) throw new Error("base64 decoded " + b64Bytes + " bytes");
      if (rejected !== N + 10) throw new Error("invalid base64 rejected " + rejected + " times");
      console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
    `;

    // Unfixed, each hit leaks three percent-decoded buffers (720KB each, 240KB
    // of it written and resident) plus the base64 output: over 70 MiB across
    // 100 hits.
    await expectRssDeltaBelow(["--smol", "-e", script], { release: 24, debug: 36 });
  },
  LEAK_TEST_TIMEOUT,
);

test.concurrent(
  "fetch() compress option does not leak bodies or compressor state",
  async () => {
    // Exercises:
    //  - all four encodings
    //  - the custom-level path (allocates a temporary libdeflate compressor that
    //    must be freed each call)
    //  - a small body (HTTP-thread LibdeflateState shared_buffer fast path)
    //  - a ~700 KiB body (zlib-streaming slow path → per-request Vec, freed in
    //    on_async_http_callback_raw)
    let requests = 0;
    let bodyBytes = 0;
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch(req) {
        // Drain the body so the request completes; don't decompress (server-side
        // allocator noise would mask the client-side signal we're measuring).
        requests++;
        bodyBytes += (await req.arrayBuffer()).byteLength;
        return new Response();
      },
    });

    const script = /* js */ `
      ${RSS_FN}
      const url = ${JSON.stringify(server.url.href)};
      const small = Buffer.alloc(32 * 1024, "abcdefghij");
      // > 512 KiB shared buffer → slow path; large enough that the compressed
      // output also spans multiple socket writes.
      const big = Buffer.alloc(700 * 1024, "abcdefghij");
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
      for (let i = 0; i < 5; i++) await round();
      Bun.gc(true);
      const baseline = rss();

      for (let i = 0; i < 40; i++) await round();
      Bun.gc(true);
      const final = rss();

      console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
    `;

    // 40 rounds × 5 encodings × ~700 KiB bodies: a per-request leak of the body
    // or compressor state grows RSS by over 140 MiB.
    await expectRssDeltaBelow(["--smol", "-e", script], { release: 32, debug: 48 });
    // 45 rounds of 10 requests. The server sees compressed bodies, which are
    // smaller than the 45 × 5 × (32 + 700) KiB sent.
    expect(requests).toBe(450);
    expect(bodyBytes).toBeGreaterThan(0);
    expect(bodyBytes).toBeLessThan(450 * 732 * 1024);
  },
  LEAK_TEST_TIMEOUT,
);

// Response-side: a compressed body that arrives across many packets bypasses
// the libdeflate one-shot fast path (InternalState.rs:256) and allocates a
// boxed streaming Decompressor (zlib/brotli/zstd FFI handle) per request,
// freed via Drop on InternalState::reset(). Dripping the body over chunked
// transfer encoding forces handle_response_body_chunked_encoding_from_multiple_packets.
// Paired with compress: on the request side so the same loop covers the
// multi-write send of a large compressed request body too.
test.concurrent(
  "fetch() does not leak streaming decompressor state across fragmented compressed responses",
  async () => {
    const script = /* js */ `
      ${RSS_FN}
      import { createServer } from "node:net";
      import { gzipSync, brotliCompressSync, zstdCompressSync } from "node:zlib";

      const plain = Buffer.alloc(64 * 1024, "abcdefghij");
      const bodies = {
        gzip: gzipSync(plain),
        br: brotliCompressSync(plain),
        zstd: zstdCompressSync(plain),
      };
      // ~700 KiB request body → compressed output exceeds the 512 KiB shared
      // buffer and spans multiple socket writes.
      const reqBody = Buffer.alloc(700 * 1024, "abcdefghij");

      let served = 0;
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
          served++;
          sock.write(
            "HTTP/1.1 200 OK\\r\\n" +
            "Content-Encoding: " + enc + "\\r\\n" +
            "Transfer-Encoding: chunked\\r\\n" +
            "Connection: close\\r\\n\\r\\n",
          );
          // Drip in small chunks so the client's Decompressor sees many
          // update_buffers()/read_all() cycles before the final flush.
          for (let i = 0; i < body.length; i += 1024) {
            const piece = body.subarray(i, i + 1024);
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

      let ok = 0;
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
              ok++;
            }),
          );
        }
        await Promise.all(promises);
      }

      for (let i = 0; i < 5; i++) await round();
      Bun.gc(true);
      const baseline = rss();

      for (let i = 0; i < 40; i++) await round();
      Bun.gc(true);
      const final = rss();

      server.close();
      console.log(JSON.stringify({ ok, served }));
      console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
    `;

    // 40 rounds × 3 encodings = 120 streaming Decompressor handles + 120
    // ~700 KiB compressed request bodies. A leaked boxed zlib/brotli/zstd
    // reader or an un-freed compressed body Vec would grow RSS by >80 MiB.
    const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script], noQuarantineEnv);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [counts, delta] = stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(counts).toEqual({ ok: 135, served: 135 });
    expect(delta.deltaMiB).toBeLessThan(slowBuild ? 40 : 24);
  },
  LEAK_TEST_TIMEOUT,
);

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
        ${RSS_FN}
        // ~256 KiB path so each leaked WTFStringImpl shows up in RSS well above
        // allocator noise. Build a FRESH proxy string per iteration: reusing one
        // JS string would make href_from_js return the same StringImpl every
        // call (only the refcount grows, RSS stays flat) and hide the leak.
        const pad = Buffer.alloc(256 * 1024, "a").toString();

        let rejected = 0;
        async function hit(i) {
          const proxyUrl = "http://127.0.0.1:1/" + i + "/" + pad;
          const opts = ${form === "string" ? `{ proxy: proxyUrl }` : `{ proxy: { url: proxyUrl } }`};
          // 41-byte blob: URL (5 + 36-char UUID) so ZigURL::is_blob() matches
          // and fetch rejects from the blob registry with no FetchTasklet.
          try { await fetch("blob:00000000-0000-0000-0000-000000000000", opts); } catch { rejected++; }
        }

        // Warm up (JIT, allocator page commit).
        for (let i = 0; i < 20; i++) await hit(-i);
        Bun.gc(true);
        const baseline = rss();

        const ITERS = 200;
        for (let i = 0; i < ITERS; i++) await hit(i);
        Bun.gc(true);
        const final = rss();

        console.log(JSON.stringify({ rejected }));
        console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
      `;

      // 200 × 256 KiB ≈ 50 MiB leaked when the +1 is dropped on the floor
      // (measured ~68 MiB on debug+ASAN); with the deref in place the delta
      // is URL-size-independent noise (~17 MiB on debug+ASAN, ~7 on release).
      const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script], noQuarantineEnv);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const [counts, delta] = stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(counts).toEqual({ rejected: 220 });
      expect(delta.deltaMiB).toBeLessThan(slowBuild ? 28 : 16);
    },
    LEAK_TEST_TIMEOUT,
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
    // for the small per-call leak to show in RSS. A release build does 20000
    // iterations in 0.2s and a debug build in 20s, so release runs three times
    // as many and gets a leak three times the noise bound.
    const ITERS = slowBuild ? 20000 : 60000;
    const script = /* js */ `
    ${RSS_FN}
    const pad = Buffer.alloc(900, "a").toString();
    // Windows strips the leading "/" then asserts is_absolute_windows() in
    // PosixToWinNormalizer under debug_assertions, which needs a drive letter.
    const prefix = process.platform === "win32" ? "file:///C:/" : "file:///";
    let responses = 0;
    async function hit(i) {
      // Fresh path per iteration so each leaked ref pins a distinct impl.
      // The file does not exist; the Response is created (with url_string set)
      // and the lazy Blob body is never read, so no fs I/O happens.
      const res = await fetch(prefix + i + pad);
      if (res.url !== prefix + i + pad) throw new Error("unexpected url " + res.url);
      responses++;
    }
    for (let i = 0; i < 200; i++) { try { await hit(-i); } catch {} }
    Bun.gc(true);
    const baseline = rss();

    const ITERS = ${ITERS};
    for (let i = 0; i < ITERS; i++) {
      try { await hit(i); } catch {}
      if ((i & 1023) === 0) Bun.gc(true);
    }
    Bun.gc(true);
    const final = rss();

    console.log(JSON.stringify({ responses }));
    console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
  `;

    // ~0.9 KiB × 20000 ≈ 18 MiB raw leak (measured ~32 MiB on debug+ASAN)
    // when the extra ref is dropped on the floor; ~14 MiB noise with the fix.
    // On release, 60000 iterations leak ~54 MiB against ~8 MiB of noise.
    const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script], noQuarantineEnv);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [counts, delta] = stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(counts).toEqual({ responses: ITERS + 200 });
    expect(delta.deltaMiB).toBeLessThan(20);
  },
  LEAK_TEST_TIMEOUT,
);

// Regression for src/runtime/webcore/fetch/FetchTasklet.zig:601,614 —
// Holder.resolve/reject use `self.promise.swap()` which *consumes* (clears)
// the jsc.Strong handle on the fetch() promise before calling resolve()/reject().
// A port that reads-without-consuming (e.g. value_or_empty()) and forgets to
// clear the slot would leave one protected Promise root per fetch() call alive
// for the lifetime of the VM. This asserts the swap() consume semantics by
// checking protectedObjectTypeCounts.Promise returns to baseline after both
// the resolve and reject Holder paths have run.
test.concurrent(
  "fetch() promise Strong handle is consumed on resolve/reject (FetchTasklet Holder.swap)",
  async () => {
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

    let resolved = 0, rejected = 0;
    async function both() {
      resolved += (await fetch(ok.url).then(r => r.text())) === "hi";
      await fetch(badURL).then(() => { throw new Error("expected reject"); }, () => { rejected++; });
    }

    // warm up both paths so any one-time lazily-protected promises are counted
    // in the baseline rather than the delta
    for (let i = 0; i < 4; i++) await both();
    await new Promise(r => setImmediate(r));
    const baseline = protectedPromises();

    const N = 64;
    for (let i = 0; i < N; i++) await both();
    // let any enqueued AnyTask Holder callbacks finish before measuring
    await new Promise(r => setImmediate(r));
    const after = protectedPromises();

    bad.close();

    console.log(JSON.stringify({ resolved, rejected, baseline, after }));
  `;

    const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { resolved, rejected, baseline, after } = JSON.parse(stdout.trim());
    expect({ resolved, rejected }).toEqual({ resolved: 68, rejected: 68 });
    // Zig swap() releases the root; after settling, no fetch promise should
    // remain protected. Allow tiny slack for unrelated event-loop promises.
    // Unfixed, 128 promises stay protected.
    expect(after - baseline).toBeLessThanOrEqual(4);
  },
  LEAK_TEST_TIMEOUT,
);

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
test.concurrent(
  "Request body HiveRef pool returns slot via Body.Value.deinit (does not leak)",
  async () => {
    const script = /* js */ `
      ${RSS_FN}
      const payload = Buffer.alloc(128 * 1024, 0x61); // 128 KiB of 'a'
      const str = payload.toString("latin1");

      let made = 0;
      function cycle() {
        const live = [];
        for (let i = 0; i < 512; i++) {
          // unique → fresh WTFStringImpl each time
          live.push(new Request("http://x/", { method: "POST", body: str + i + made }));
        }
        made += live.length;
        // Drop all references; finalize() -> body.unref() -> (Zig spec) value.deinit() -> pool.put()
        live.length = 0;
        Bun.gc(true);
      }

      for (let i = 0; i < 2; i++) cycle();
      Bun.gc(true);
      const baseline = rss();

      for (let i = 0; i < 6; i++) cycle();
      Bun.gc(true);
      const final = rss();

      console.log(JSON.stringify({ made }));
      console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
    `;

    // 6 cycles * 512 Requests * 128 KiB = 384 MiB through the pool. If deinit() is
    // skipped for any heap-backed variant, RSS climbs by ~384 MiB; with the
    // Zig semantics it stays flat.
    const { stdout, stderr, exitCode } = await runChild(["--smol", "-e", script], noQuarantineEnv);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [counts, delta] = stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(counts).toEqual({ made: 8 * 512 });
    expect(delta.deltaMiB).toBeLessThan(slowBuild ? 96 : 64);
  },
  LEAK_TEST_TIMEOUT,
);

// https://github.com/oven-sh/bun/pull/13704: the buffered ReadableStream fast
// path must release each response body once the reader has drained it.
test.concurrent(
  "should not leak using readable stream",
  async () => {
    const body = Buffer.alloc(512 * 1024, "b");
    let count = 0;
    using server = Bun.serve({
      port: 0,
      fetch() {
        count++;
        return new Response(body);
      },
    });

    // 200 responses of 512 KiB: a leaked body per response grows RSS by 100 MiB.
    await expectRssDeltaBelow(
      [
        "--smol",
        join(import.meta.dir, "fetch-leak-test-fixture-6.js"),
        server.url.href,
        String(body.byteLength),
        "200",
      ],
      { release: 24, debug: 32 },
    );
    // 20 warmup responses plus 200 measured.
    expect(count).toBe(220);
  },
  LEAK_TEST_TIMEOUT,
);

// Regression: POSTing a ReadableStream body whose underlying source's `pull`
// awaits a timer makes the request-body ResumableSink pause on backpressure
// (the chunk arrives after the sink went paused). If the server responds
// without reading the body, the HTTP layer never drains/resumes the sink, so
// `ondrain` never fires and the JS `drainReaderIntoSink` continuation (which
// captures the reader/stream graph) plus the FetchTasklet's startRequestStream
// ref used to leak forever — one ReadableStream/Controller/Reader per fetch.
test.concurrent(
  "should not leak request-body ReadableStream when server ignores the body",
  async () => {
    const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    let requests = 0;
    const server = Bun.serve({ port: 0, fetch: () => { requests++; return new Response("ok"); } });
    const url = "http://localhost:" + server.port;

    // Every pull settles on its own, whether or not the fetch already
    // resolved, so the count below never sees a pull that is still pending.
    const pulls = [];
    function makeBody() {
      return new ReadableStream({
        pull(c) {
          const pull = Bun.sleep(5).then(() => {
            try {
              c.enqueue(new Uint8Array(8));
              c.close();
            } catch {}
          });
          pulls.push(pull);
          return pull;
        },
      });
    }
    async function readableStreamCount() {
      await Promise.all(pulls);
      pulls.length = 0;
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
      Bun.gc(true);
      return heapStats().objectTypeCounts.ReadableStream || 0;
    }

    let ok = 0;
    async function post() {
      ok += (await (await fetch(url, { method: "POST", body: makeBody() })).text()) === "ok";
    }
    for (let i = 0; i < 5; i++) await post();
    const baseline = await readableStreamCount();

    const N = 25;
    for (let i = 0; i < N; i++) await post();
    const after = await readableStreamCount();

    server.stop(true);
    console.log(JSON.stringify({ ok, requests, baseline, after }));
  `;

    const { stdout, stderr, exitCode } = await runChild(["-e", script]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { ok, requests, baseline, after } = JSON.parse(stdout.trim());
    expect({ ok, requests }).toEqual({ ok: 30, requests: 30 });
    // Each leaked fetch retains a ReadableStream; 25 leaked fetches would put
    // `after` ~25 above `baseline`. A small slack absorbs in-flight transients.
    expect(after).toBeLessThanOrEqual(baseline + 3);
  },
  LEAK_TEST_TIMEOUT,
);

// The Response's abort listener takes a +1 on the AbortSignal; Response::destroy
// must release it. Run in a subprocess so heapStats is not polluted by the
// suite's other concurrent tests, and so the destruct-on-exit teardown of a
// timeout signal with the listener still attached is exercised.
// https://github.com/oven-sh/bun/issues/32659
test.concurrent(
  "fetch Response's abort-signal listener does not leak the AbortSignal",
  async () => {
    const script = /* js */ `
    const { heapStats } = require("bun:jsc");
    const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(8)) });
    // Response::destroy releases the signal ref from its finalizer, so the
    // signal becomes collectable only on the *next* GC.
    const count = async () => {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
      Bun.gc(true);
      return heapStats().objectTypeCounts.AbortSignal || 0;
    };
    let bytes = 0;
    async function once() {
      const ac = new AbortController();
      const res = await fetch(server.url, { signal: ac.signal });
      bytes += (await res.arrayBuffer()).byteLength;
    }
    for (let i = 0; i < 8; i++) await once();
    const baseline = await count();
    for (let i = 0; i < 64; i++) await once();
    const after = await count();
    // One more with a pending AbortSignal.timeout() so exit teardown runs
    // BodyAbortListener::drop on a signal whose m_timeout is still set.
    const res = await fetch(server.url, { signal: AbortSignal.timeout(60_000) });
    bytes += (await res.arrayBuffer()).byteLength;
    server.stop(true);
    console.log(JSON.stringify({ bytes, baseline, after }));
    process.exit(0);
  `;
    const { stdout, stderr, exitCode } = await runChild(["-e", script]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { bytes, baseline, after } = JSON.parse(stdout.trim());
    expect(bytes).toBe(73 * 8);
    // Unfixed, each of the 64 fetches keeps its AbortSignal alive.
    expect(after).toBeLessThanOrEqual(baseline + 4);
  },
  LEAK_TEST_TIMEOUT,
);

// https://github.com/oven-sh/bun/issues/32659
test.concurrent(
  "aborting an in-flight streaming fetch() discards the buffered body and errors the reader",
  async () => {
    const { stdout, stderr, exitCode } = await runChild([
      "-e",
      /* js */ `
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
      const first = await reader.read();
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
      console.log(JSON.stringify({ firstDone: first.done, firstBytes: first.value.length, sent, drained, result }));
      process.exit(0);
    `,
    ]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { firstDone, firstBytes, sent, drained, result } = JSON.parse(stdout.trim());
    // The first read returns what had arrived by then, one or more chunks.
    expect(firstDone).toBe(false);
    expect(firstBytes).toBeGreaterThan(0);
    // The server enqueued more than the client read before the abort.
    expect(sent).toBeGreaterThan(2);
    // Before the fix the reader drained the retained native buffer then saw
    // { done: true }; now the buffer is released and the stored error is
    // surfaced to the next pull.
    expect(result).toEqual({ error: "AbortError" });
    // Only what was already in the JS-side stream queue remains readable.
    expect(drained).toBeLessThan(2 * 1024 * 1024);
  },
  LEAK_TEST_TIMEOUT,
);

// https://github.com/oven-sh/bun/issues/32659
test.concurrent(
  "aborting in-flight streaming fetch() responses does not retain the buffered body off-heap",
  async () => {
    // Unfixed, every held iteration retains its multi-MB buffered body
    // (>100MB total); 55 absorbs allocator noise (Windows release measured
    // 32.8MB of it) while staying far below the leak.
    await expectRssDeltaBelow([join(import.meta.dir, "fetch-abort-stream-leak-fixture.ts")], {
      release: 55,
      debug: 55,
    });
  },
  LEAK_TEST_TIMEOUT,
);

test.concurrent(
  "fetch().arrayBuffer() of a large Content-Length body peaks at ~1x the payload",
  async () => {
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
      const { stdout, stderr, exitCode } = await runChild(
        ["--smol", join(import.meta.dir, "fetch-buffer-peak-fixture.ts")],
        { ...bunEnv, SERVER: `http://127.0.0.1:${port}/`, BODY_BYTES: String(bodyBytes) },
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { bodyMB, rssBeforeMB, rssAfterMB } = JSON.parse(stdout.trim());
      expect(bodyMB).toBe(129);
      // Unfixed: the doubling reallocations (retained by ASAN quarantine / mimalloc
      //          page cache) leave RSS at >= 2x body over the pre-fetch resident
      //          set (release linux ~2.9x, debug+ASAN default quarantine ~2.7x).
      // Fixed:   a single exact allocation, ~1.0x body.
      expect(rssAfterMB - rssBeforeMB).toBeLessThan(1.5 * bodyMB);
    } finally {
      server.close();
    }
  },
  LEAK_TEST_TIMEOUT,
);
