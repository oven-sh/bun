import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";

const payload = JSON.stringify({
  msg: Buffer.alloc(1024, "abcdefghij").toString(),
  n: 42,
});

function makeServer() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const raw = Buffer.from(await req.arrayBuffer());
      const encoding = req.headers.get("content-encoding") ?? "";
      let decoded: string;
      switch (encoding) {
        case "gzip":
          decoded = gunzipSync(raw).toString();
          break;
        case "deflate":
          decoded = inflateSync(raw).toString();
          break;
        case "br":
          decoded = brotliDecompressSync(raw).toString();
          break;
        case "zstd":
          decoded = zstdDecompressSync(raw).toString();
          break;
        default:
          decoded = raw.toString();
      }
      return Response.json({
        encoding,
        contentLength: req.headers.get("content-length"),
        rawLength: raw.length,
        decoded,
      });
    },
  });
}

describe("fetch compress option", () => {
  describe.each([
    ["gzip", "gzip" as const],
    ["deflate", "deflate" as const],
    ["br", "br" as const],
    ["zstd", "zstd" as const],
  ])("encoding %s", (name, encoding) => {
    test.concurrent("string body", async () => {
      using server = makeServer();
      const res = await fetch(server.url, {
        method: "POST",
        body: payload,
        compress: encoding,
      });
      const json: any = await res.json();
      expect(json.encoding).toBe(encoding);
      expect(json.decoded).toBe(payload);
      expect(json.rawLength).toBeLessThan(Buffer.byteLength(payload));
      expect(Number(json.contentLength)).toBe(json.rawLength);
    });

    test.concurrent("Uint8Array body", async () => {
      using server = makeServer();
      const res = await fetch(server.url, {
        method: "POST",
        body: new TextEncoder().encode(payload),
        compress: encoding,
      });
      const json: any = await res.json();
      expect(json.encoding).toBe(encoding);
      expect(json.decoded).toBe(payload);
      expect(json.rawLength).toBeLessThan(Buffer.byteLength(payload));
    });

    test.concurrent("Blob body", async () => {
      using server = makeServer();
      const res = await fetch(server.url, {
        method: "POST",
        body: new Blob([payload]),
        compress: encoding,
      });
      const json: any = await res.json();
      expect(json.encoding).toBe(encoding);
      expect(json.decoded).toBe(payload);
      expect(json.rawLength).toBeLessThan(Buffer.byteLength(payload));
    });

    test.concurrent("object form with explicit level", async () => {
      using server = makeServer();
      const level = encoding === "zstd" ? 3 : 4;
      const res = await fetch(server.url, {
        method: "POST",
        body: payload,
        compress: { encoding, level },
      });
      const json: any = await res.json();
      expect(json.encoding).toBe(encoding);
      expect(json.decoded).toBe(payload);
    });
  });

  test.concurrent("compress: true defaults to gzip", async () => {
    using server = makeServer();
    const res = await fetch(server.url, {
      method: "POST",
      body: payload,
      compress: true,
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(payload);
  });

  test.concurrent("compress: false sends uncompressed", async () => {
    using server = makeServer();
    const res = await fetch(server.url, {
      method: "POST",
      body: payload,
      compress: false,
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("");
    expect(json.decoded).toBe(payload);
    expect(json.rawLength).toBe(Buffer.byteLength(payload));
  });

  test.concurrent("explicit Content-Encoding header skips compression", async () => {
    using server = makeServer();
    const res = await fetch(server.url, {
      method: "POST",
      body: payload,
      headers: { "Content-Encoding": "identity" },
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("identity");
    expect(json.rawLength).toBe(Buffer.byteLength(payload));
  });

  test.concurrent("ReadableStream body is not compressed", async () => {
    using server = makeServer();
    const res = await fetch(server.url, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      }),
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("");
    expect(json.decoded).toBe(payload);
  });

  test.concurrent("empty body is not compressed", async () => {
    using server = makeServer();
    const res = await fetch(server.url, {
      method: "POST",
      body: "",
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("");
    expect(json.rawLength).toBe(0);
  });

  test.concurrent("body larger than 512 KiB", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, {
      method: "POST",
      body: big,
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(big);
    expect(json.rawLength).toBeLessThan(big.length);
  });

  // HTTP "deflate" is the zlib-wrapped (RFC 1950) stream, not raw deflate.
  test.concurrent("deflate body larger than 512 KiB", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, { method: "POST", body: big, compress: "deflate" });
    const json: any = await res.json();
    expect(json.encoding).toBe("deflate");
    expect(json.decoded).toBe(big);
  });

  test.concurrent("incompressible body larger than 512 KiB", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const raw = Buffer.from(await req.arrayBuffer());
        return Response.json({
          encoding: req.headers.get("content-encoding"),
          contentLength: req.headers.get("content-length"),
          rawLength: raw.length,
          sha: new Bun.CryptoHasher("sha1").update(gunzipSync(raw)).digest("hex"),
        });
      },
    });
    const big = crypto.getRandomValues(Buffer.alloc(600 * 1024));
    const res = await fetch(server.url, {
      method: "POST",
      body: big,
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(Number(json.contentLength)).toBe(json.rawLength);
    expect(json.sha).toBe(new Bun.CryptoHasher("sha1").update(big).digest("hex"));
  });

  // 307 preserves method+body; the second hop re-sends the compressed bytes
  // with the same Content-Encoding.
  test.concurrent("307 redirect re-sends compressed body", async () => {
    let target: URL;
    using dest = Bun.serve({
      port: 0,
      async fetch(req) {
        const raw = Buffer.from(await req.arrayBuffer());
        return Response.json({
          encoding: req.headers.get("content-encoding"),
          decoded: gunzipSync(raw).toString(),
        });
      },
    });
    target = dest.url;
    using src = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 307, headers: { Location: String(target) } }),
    });
    const res = await fetch(src.url, { method: "POST", body: payload, compress: "gzip" });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(payload);
  });

  // libdeflate levels 10 to 12 allocate a much larger compressor per call.
  test.concurrent("gzip level 12 on a body larger than 512 KiB", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, {
      method: "POST",
      body: big,
      compress: { encoding: "gzip", level: 12 },
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(big);
    expect(Number(json.contentLength)).toBe(json.rawLength);
  });

  // BUN_FEATURE_FLAG_NO_LIBDEFLATE=1 is the kill switch for every libdeflate
  // user; request compression falls back to zlib for gzip and deflate.
  test.concurrent("gzip and deflate compress with zlib under BUN_FEATURE_FLAG_NO_LIBDEFLATE", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
         const out = [];
         for (const [body, compress] of [[${JSON.stringify(payload)}, "gzip"], [big, "gzip"], [big, "deflate"], [big, { encoding: "gzip", level: 12 }]]) {
           const res = await fetch(process.env.SERVER, { method: "POST", body, compress });
           out.push(await res.json());
         }
         console.log(JSON.stringify(out));`,
      ],
      env: { ...bunEnv, SERVER: server.url.href, BUN_FEATURE_FLAG_NO_LIBDEFLATE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const results: any[] = JSON.parse(stdout);
    expect(
      results.map(r => [
        r.encoding,
        r.decoded === payload || r.decoded === big,
        Number(r.contentLength) === r.rawLength,
      ]),
    ).toEqual([
      ["gzip", true, true],
      ["gzip", true, true],
      ["deflate", true, true],
      ["gzip", true, true],
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("concurrent large compressed bodies each arrive intact", async () => {
    using server = makeServer();
    const bodies = Array.from({ length: 8 }, (_, i) => Buffer.alloc(300 * 1024, `body-${i}-`).toString());
    const results: any[] = await Promise.all(
      bodies.map(body => fetch(server.url, { method: "POST", body, compress: "gzip" }).then(res => res.json())),
    );
    for (const [i, json] of results.entries()) {
      expect(json.encoding).toBe("gzip");
      expect(json.decoded).toBe(bodies[i]);
      expect(Number(json.contentLength)).toBe(json.rawLength);
    }
  });

  test.concurrent("abort while a large body is being compressed rejects with the reason", async () => {
    let requests = 0;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        requests++;
        await req.arrayBuffer();
        return new Response();
      },
    });
    const reason = new Error("stop");
    // The controller and signal go out of scope before the rejection lands.
    const pending = (() => {
      const controller = new AbortController();
      const pending = fetch(server.url, {
        method: "POST",
        body: Buffer.alloc(2 * 1024 * 1024, "abcdefghij").toString(),
        compress: "gzip",
        signal: controller.signal,
      });
      controller.abort(reason);
      return pending;
    })();
    Bun.gc(true);
    await expect(pending).rejects.toBe(reason);
    // A later request on the same server orders after anything the aborted
    // fetch could have sent.
    await fetch(server.url, { method: "POST", body: "x" });
    expect(requests).toBe(1);
  });

  test.concurrent("a signal that fires after a large compressed fetch completed is harmless", async () => {
    using server = makeServer();
    const controller = new AbortController();
    const res = await fetch(server.url, {
      method: "POST",
      body: Buffer.alloc(600 * 1024, "abcdefghij").toString(),
      compress: "gzip",
      signal: controller.signal,
    });
    expect((await res.json()).encoding).toBe("gzip");
    Bun.gc(true);
    controller.abort(new Error("late"));
    Bun.gc(true);
    const again = await fetch(server.url, { method: "POST", body: "x" });
    expect(again.status).toBe(200);
  });

  // The HTTP thread serves every fetch socket in the process. Compressing a
  // body on that thread stalled every other in-flight response for the whole
  // codec time (#47164). zstd level 19 on 400 KiB takes long enough to show it
  // (about 200 ms in a release build) without making the test slow under ASAN.
  test("a large compressed body does not stall another in-flight response", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.url.endsWith("/stream")) {
          return new Response(
            async function* () {
              for (;;) {
                yield "tick\n";
                await Bun.sleep(2);
              }
            },
            { headers: { "content-type": "text/plain" } },
          );
        }
        await req.arrayBuffer();
        return new Response();
      },
    });

    const reader = (await fetch(`${server.url}stream`)).body!.getReader();
    let last = performance.now();
    let maxGap = 0;
    const pump = (async () => {
      while (!(await reader.read()).done) {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
      }
    })();

    const body = JSON.stringify(
      Array.from({ length: 7_000 }, (_, id) => ({
        id,
        name: `item-${(id * 2654435761) % 4294967296}`,
        value: id / 7,
      })),
    );
    const start = performance.now();
    last = start;
    maxGap = 0;
    await fetch(`${server.url}sink`, {
      method: "POST",
      body,
      compress: { encoding: "zstd", level: 19 },
    });
    const postMs = performance.now() - start;
    maxGap = Math.max(maxGap, performance.now() - last);
    await reader.cancel();
    await pump;

    // With the codec on the HTTP thread the stream is silent for about the
    // whole POST. Off that thread the longest gap is scheduling jitter.
    expect(maxGap).toBeLessThan(postMs / 2);
  });

  test("invalid encoding string throws", () => {
    expect(() =>
      fetch("http://127.0.0.1:1/", {
        method: "POST",
        body: "x",
        // @ts-expect-error
        compress: "snappy",
      }),
    ).toThrow(/'compress' must be/);
  });

  test.each([99, -1, 5.5, Infinity, "6"])("invalid level %p throws", level => {
    expect(() =>
      fetch("http://127.0.0.1:1/", {
        method: "POST",
        body: "x",
        compress: { encoding: "gzip", level } as any,
      }),
    ).toThrow(/compress\.level/);
  });

  // A Bun.file() body large enough to qualify for the sendfile fast path
  // (≥32 KiB, plain http, no proxy, non-Windows) must still be compressed
  // when compress is explicitly set — the sendfile heuristic must not win.
  test.skipIf(isWindows)("Bun.file() body large enough for sendfile is still compressed", async () => {
    using server = makeServer();
    const big = Buffer.alloc(64 * 1024, "abcdefghij").toString();
    using dir = tempDir("fetch-compress-sendfile", { "body.txt": big });
    const res = await fetch(server.url, {
      method: "POST",
      body: Bun.file(join(String(dir), "body.txt")),
      compress: "gzip",
    });
    const json: any = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(big);
    expect(json.rawLength).toBeLessThan(big.length);
  });
});
