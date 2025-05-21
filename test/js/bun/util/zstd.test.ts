import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { randomBytes } from "crypto";
import { zstdCompressSync, zstdDecompressSync, zstdCompress, zstdDecompress } from "bun";
import path from "path";

describe("Zstandard compression", async () => {
  // Test data of various sizes
  const testCases = [
    // { name: "empty", data: new Uint8Array(0) },
    { name: "small", data: new TextEncoder().encode("Hello, World!") },
    { name: "medium", data: await Bun.file(path.join(__dirname, "..", "..", "..", "bun.lock")).bytes() },
    {
      name: "large",
      data: Buffer.from(
        (await Bun.file(path.join(__dirname, "..", "..", "..", "..", "src", "js_parser.zig")).text()).repeat(5),
      ),
    },
  ] as const;

  it("throws with invalid level", () => {
    expect(() => zstdCompressSync(new Uint8Array(123), { level: 0 })).toThrowErrorMatchingInlineSnapshot(
      `"Compression level must be between 1 and 22"`,
    );
    expect(() => zstdCompress(new Uint8Array(123), { level: 0 })).toThrowErrorMatchingInlineSnapshot(
      `"Compression level must be between 1 and 22"`,
    );
  });

  it("throws with invalid input", () => {
    expect(() => zstdDecompressSync("wow such compressed")).toThrow();
    expect(() => zstdDecompress("veryyy such compressed")).toThrow();
    const valid = zstdCompressSync(Buffer.from("wow such compressed"));
    valid[0] = 0;
    valid[valid.length - 1] = 0;
    expect(() => zstdDecompressSync(valid)).toThrow();
  });

  // Test with known zstd-compressed data
  describe("zstd CLI compatibility", () => {
    const binaryData = Buffer.from(
      "d99672ce993fec2d180320aef27f9d05617958e6e67eb2e734cd976034d9301f410ccfca695075f02c5c2969b525a54b7e95ea61797a591daf09a8764800a8d99ad06ba3fcc5c89bd074a47f6a11c1",
      "hex",
    );

    const testDataCases = [
      {
        name: "binary data level 1",
        compressed: Buffer.from(
          "KLUv/WQAAwEgANmWcs6ZP+wtGAMgrvJ/nQVheVjm5n6y5zTNl2A02TAfQQzPymlQdfAsXClptSWlS36V6mF5elkdrwmodkgAqNma0Guj/MXIm9B0pH9qEcF",
          "base64",
        ),
        original: binaryData,
      },
      {
        name: "binary data level 10",
        compressed: Buffer.from(
          "KLUv/WQAAwEgANmWcs6ZP+wtGAMgrvJ/nQVheVjm5n6y5zTNl2A02TAfQQzPymlQdfAsXClptSWlS36V6mF5elkdrwmodkgAqNma0Guj/MXIm9B0pH9qEcF",
          "base64",
        ),
        original: binaryData,
      },
      {
        name: "binary data level 19",
        compressed: Buffer.from(
          "KLUv/WQAAwEgANmWcs6ZP+wtGAMgrvJ/nQVheVjm5n6y5zTNl2A02TAfQQzPymlQdfAsXClptSWlS36V6mF5elkdrwmodkgAqNma0Guj/MXIm9B0pH9qEcF",
          "base64",
        ),
        original: binaryData,
      },
    ];

    for (const { name, compressed, original } of testDataCases) {
      it(`can decompress ${name}`, async () => {
        // Test sync decompression
        const syncDecompressed = zstdDecompressSync(compressed);
        expect(syncDecompressed).toStrictEqual(original);

        // Test async decompression
        const asyncDecompressed = await zstdDecompress(compressed);
        expect(asyncDecompressed).toStrictEqual(original);
      });
    }
  });

  for (const { data: input, name } of testCases) {
    describe(name + " (" + input.length + " bytes)", () => {
      for (let level = 1; level <= 22; level++) {
        it("level " + level, async () => {
          // Sync compression
          const syncCompressed = zstdCompressSync(input, { level });

          // Async compression
          const asyncCompressed = await zstdCompress(input, { level });

          // Compare compressed results (they should be identical with same level)
          expect(syncCompressed).toStrictEqual(asyncCompressed);

          // Sync decompression of async compressed data
          const syncDecompressed = zstdDecompressSync(asyncCompressed);

          // Async decompression of sync compressed data
          const asyncDecompressed = await zstdDecompress(syncCompressed);

          // Compare decompressed results
          expect(syncDecompressed).toStrictEqual(asyncDecompressed);

          // Verify both match original
          expect(syncDecompressed).toStrictEqual(input);
          expect(asyncDecompressed).toStrictEqual(input);
        });
      }
    });
  }
});

describe("Zstandard HTTP compression", () => {
  // Sample data for HTTP tests
  const testData = {
    text: "This is a test string for zstd HTTP compression tests. Repeating content to improve compression: This is a test string for zstd HTTP compression tests.",
    json: { id: 1234, name: "Test Object", values: [1, 2, 3, 4, 5], nested: { prop1: "value1", prop2: "value2" } },
    binary: Buffer.from(
      "d99672ce993fec2d180320aef27f9d05617958e6e67eb2e734cd976034d9301f410ccfca695075f02c5c2969b525a54b7e95ea61797a591daf09a8764800a8d99ad06ba3fcc5c89bd074a47f6a11c1",
      "hex",
    ),
  };

  let server;
  let serverBaseUrl;

  // Start HTTP server that can serve zstd-compressed content
  beforeAll(async () => {
    server = Bun.serve({
      port: 0, // Use a random available port
      async fetch(req) {
        const url = new URL(req.url);
        const acceptEncoding = req.headers.get("Accept-Encoding") || "";
        const supportsZstd = acceptEncoding.includes("zstd");

        // Route: /text
        if (url.pathname === "/text") {
          if (supportsZstd) {
            const compressed = await zstdCompress(testData.text, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "text/plain",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(testData.text, {
            headers: { "Content-Type": "text/plain" },
          });
        }

        // Route: /json
        else if (url.pathname === "/json") {
          const jsonString = JSON.stringify(testData.json);
          if (supportsZstd) {
            const compressed = await zstdCompress(jsonString, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "application/json",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(jsonString, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Route: /binary
        else if (url.pathname === "/binary") {
          if (supportsZstd) {
            const compressed = await zstdCompress(testData.binary, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(testData.binary, {
            headers: { "Content-Type": "application/octet-stream" },
          });
        }

        // Route: /echo
        else if (url.pathname === "/echo") {
          // Echo back the request body, with zstd compression if supported
          const body = await req.arrayBuffer();
          if (supportsZstd) {
            const compressed = await zstdCompress(new Uint8Array(body), { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": req.headers.get("Content-Type") || "application/octet-stream",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(body, {
            headers: { "Content-Type": req.headers.get("Content-Type") || "application/octet-stream" },
          });
        }

        // Default: 404
        return new Response("Not Found", { status: 404 });
      },
    });

    serverBaseUrl = `http://localhost:${server.port}`;
  });

  // Clean up the server after tests
  afterAll(() => {
    server.stop();
  });

  it("can fetch and automatically decompress zstd-encoded text", async () => {
    const response = await fetch(`${serverBaseUrl}/text`, {
      headers: { "Accept-Encoding": "gzip, deflate, br, zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("text/plain");

    const text = await response.text();
    expect(text).toBe(testData.text);
  });

  it("can fetch and automatically decompress zstd-encoded JSON", async () => {
    const response = await fetch(`${serverBaseUrl}/json`, {
      headers: { "Accept-Encoding": "gzip, deflate, br, zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const json = await response.json();
    expect(json).toEqual(testData.json);
  });

  it("can fetch and automatically decompress zstd-encoded binary data", async () => {
    const response = await fetch(`${serverBaseUrl}/binary`, {
      headers: { "Accept-Encoding": "zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");

    const buffer = await response.bytes();
    expect(buffer).toStrictEqual(testData.binary);
  });

  it("doesn't use zstd when not in Accept-Encoding", async () => {
    const response = await fetch(`${serverBaseUrl}/text`, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });

    expect(response.headers.get("Content-Encoding")).toBeNull();

    const text = await response.text();
    expect(text).toBe(testData.text);
  });

  it("can POST and receive zstd-compressed echo response", async () => {
    const testString = "Echo this back with zstd compression";

    const response = await fetch(`${serverBaseUrl}/echo`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Accept-Encoding": "zstd",
      },
      body: testString,
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    const echoed = await response.text();
    expect(echoed).toBe(testString);
  });
});
