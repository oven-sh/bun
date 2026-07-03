import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { randomFillSync } from "node:crypto";
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
      const json = await res.json();
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
      const json = await res.json();
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
      const json = await res.json();
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
      const json = await res.json();
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
    const json = await res.json();
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
    const json = await res.json();
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
    const json = await res.json();
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
    const json = await res.json();
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
    const json = await res.json();
    expect(json.encoding).toBe("");
    expect(json.rawLength).toBe(0);
  });

  test.concurrent("body larger than the shared buffer", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, {
      method: "POST",
      body: big,
      compress: "gzip",
    });
    const json = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(big);
    expect(json.rawLength).toBeLessThan(big.length);
  });

  // >512 KiB takes the streaming-zlib slow path; verify it produces a
  // zlib-wrapped (RFC 1950) stream, not raw deflate.
  test.concurrent("deflate body larger than the shared buffer (zlib streaming)", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, { method: "POST", body: big, compress: "deflate" });
    const json = await res.json();
    expect(json.encoding).toBe("deflate");
    expect(json.decoded).toBe(big);
  });

  // gzip bound on 600 KiB of random bytes is > 512 KiB so compress_into spills
  // straight to the per-request Vec instead of borrowing the shared buffer.
  test.concurrent("incompressible body larger than the shared buffer (spill path)", async () => {
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
    // crypto.getRandomValues() is capped at 65536 bytes per the WebCrypto spec.
    const big = randomFillSync(Buffer.alloc(600 * 1024));
    const res = await fetch(server.url, {
      method: "POST",
      body: big,
      compress: "gzip",
    });
    const json = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(Number(json.contentLength)).toBe(json.rawLength);
    expect(json.sha).toBe(new Bun.CryptoHasher("sha1").update(big).digest("hex"));
  });

  // 307 preserves method+body; the HTTP-thread compression must re-run on the
  // second hop from the original uncompressed slice (state.original_request_body
  // is never re-seated to the compressed bytes).
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
    const json = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(payload);
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
        // @ts-expect-error
        compress: { encoding: "gzip", level },
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
    const json = await res.json();
    expect(json.encoding).toBe("gzip");
    expect(json.decoded).toBe(big);
    expect(json.rawLength).toBeLessThan(big.length);
  });
});
