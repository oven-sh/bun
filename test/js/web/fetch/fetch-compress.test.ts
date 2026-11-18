import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateSync,
  zstdDecompressSync,
} from "node:zlib";

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

  test.concurrent("body larger than the shared buffer", async () => {
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

  // >512 KiB takes the streaming-zlib slow path; verify it produces a
  // zlib-wrapped (RFC 1950) stream, not raw deflate.
  test.concurrent("deflate body larger than the shared buffer (zlib streaming)", async () => {
    using server = makeServer();
    const big = Buffer.alloc(600 * 1024, "abcdefghij").toString();
    const res = await fetch(server.url, { method: "POST", body: big, compress: "deflate" });
    const json: any = await res.json();
    expect(json.encoding).toBe("deflate");
    expect(json.decoded).toBe(big);
  });

  // libdeflate has levels up to 12, and writes other bytes.
  test.concurrent.each([
    ["gzip", 1],
    ["gzip", 3],
    ["gzip", 12],
    ["deflate", 0],
    ["deflate", 9],
  ] as const)("%s level %d applies to a body larger than the shared buffer", async (encoding, level) => {
    const big = Buffer.alloc(600 * 1024, "abcdefghij");
    using server = Bun.serve({ port: 0, fetch: async req => new Response(await req.bytes()) });
    const res = await fetch(server.url, { method: "POST", body: big, compress: { encoding, level } });
    const sent = Buffer.from(await res.arrayBuffer());
    if (level === 0) {
      expect(sent.length).toBeGreaterThan(big.length);
      expect(inflateSync(sent).equals(big)).toBe(true);
    } else {
      expect(sent).toEqual((encoding === "gzip" ? gzipSync : deflateSync)(big, { level: Math.min(level, 9) }));
    }
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

  // The shared buffer holds 512 KiB. The bound of a 524,158-byte body is exactly that.
  describe("br, in the shared buffer and spilled", () => {
    async function sent(body: Uint8Array, compress: "br" | { encoding: "br"; level: number }) {
      using server = Bun.serve({
        port: 0,
        fetch: async req =>
          new Response(await req.bytes(), { headers: { "x-length": req.headers.get("content-length")! } }),
      });
      const res = await fetch(server.url, { method: "POST", body, compress });
      const bytes = Buffer.from(await res.bytes());
      expect(res.headers.get("x-length")).toBe(String(bytes.length));
      return bytes;
    }

    describe.each([
      [1, "0b0080", [0, 1, 2, 3, 5, 11]],
      [100 * 1024, "abffc708", [0, 1, 2, 3, 5, 11]],
      [524_158, "abbeff0b", [0, 1, 5]],
      [524_159, "2bbfff0b", [0, 1, 5]],
      [600 * 1024, "abffaf0c", [0, 1, 2, 3, 5]],
    ])("%d incompressible bytes", (outputLength, header, levels) => {
      const noise = createHash("shake256", { outputLength }).update("fetch-compress").digest();

      test.concurrent.each(levels)("are stored at level %d", async level => {
        const stored = Buffer.concat([Buffer.from(header, "hex"), noise, Buffer.of(3)]);
        expect(Buffer.compare(await sent(noise, { encoding: "br", level }), stored)).toBe(0);
      });
    });

    test.concurrent("a body may grow by more than three bytes for each 16 KiB", async () => {
      const body = createHash("shake256", { outputLength: 600 * 1024 })
        .update("fetch-compress")
        .digest();
      for (let at = 13000; at < body.length; at += 16 * 1024) body.fill(0, at, at + 20);
      const compressed = await sent(body, { encoding: "br", level: 3 });
      expect(compressed.length - body.length).toBe(130);
      expect(brotliDecompressSync(compressed).equals(body)).toBe(true);
    });

    // No two qualities compress this to the same bytes.
    const squares = Array.from({ length: 2000 }, (_, i) => (i * i).toString(4)).join(" ");

    test.concurrent.each([
      [100 * 1024, "br", 6],
      [600 * 1024, "br", 6],
      ...[0, 1, 4, 5, 7, 11].map(level => [16 * 1024, { encoding: "br", level }, level] as const),
    ] as const)("%d bytes of text with %j take quality %d", async (length, compress, quality) => {
      const text = Buffer.alloc(length, squares);
      const params = { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: length };
      expect(await sent(text, compress)).toEqual(brotliCompressSync(text, { params }));
    });
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
    const json: any = await res.json();
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
        compress: { encoding: "gzip", level } as any,
      }),
    ).toThrow(/compress\.level/);
  });

  test.each([-1, 12])("invalid br level %p throws", level => {
    expect(() =>
      fetch("http://127.0.0.1:1/", { method: "POST", body: "x", compress: { encoding: "br", level } }),
    ).toThrow(`The value of "compress.level" is out of range. It must be >= 0 and <= 11. Received ${level}`);
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
