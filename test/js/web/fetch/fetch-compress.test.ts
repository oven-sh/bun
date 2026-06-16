import { describe, expect, test } from "bun:test";
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

  test("invalid level throws", () => {
    expect(() =>
      fetch("http://127.0.0.1:1/", {
        method: "POST",
        body: "x",
        compress: { encoding: "gzip", level: 99 },
      }),
    ).toThrow(/'compress.level'/);
  });
});
