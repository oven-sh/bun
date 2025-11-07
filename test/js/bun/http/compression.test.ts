import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("HTTP Compression", () => {
  const ENCODINGS = ["br", "gzip", "zstd"] as const;
  const TEST_CONTENT = "Hello ".repeat(1000); // ~6KB compressible data

  describe("Basic Functionality", () => {
    test("compression disabled by default", async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const res = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br, gzip" },
        });

        expect(res.headers.get("content-encoding")).toBe(null);
        expect(await res.text()).toBe(TEST_CONTENT);
      } finally {
        server.stop();
      }
    });

    test("all encodings work correctly", async () => {
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          gzip: 6,
          zstd: 3,
          disableForLocalhost: false,
        },
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        for (const encoding of ENCODINGS) {
          const res = await fetch(`http://localhost:${server.port}`, {
            headers: { "Accept-Encoding": encoding },
          });

          expect(res.headers.get("content-encoding")).toBe(encoding);
          expect(res.headers.get("vary")).toBe("Accept-Encoding");
          expect(await res.text()).toBe(TEST_CONTENT);
        }
      } finally {
        server.stop();
      }
    });

    test("all variants share same ETag", async () => {
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          gzip: 6,
          zstd: 3,
          disableForLocalhost: false,
        },
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: {
              "Content-Type": "text/plain",
              "ETag": '"test-etag-123"',
            },
          });
        },
      });

      try {
        const etags = new Set<string>();

        for (const encoding of ENCODINGS) {
          const res = await fetch(`http://localhost:${server.port}`, {
            headers: { "Accept-Encoding": encoding },
          });

          const etag = res.headers.get("etag");
          expect(etag).toBeTruthy();
          etags.add(etag!);
        }

        expect(etags.size).toBe(1);
        expect(Array.from(etags)[0]).toBe('"test-etag-123"');
      } finally {
        server.stop();
      }
    });
  });

  describe("Configuration", () => {
    test("per-algorithm configuration", async () => {
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 6,
          gzip: false,
          zstd: 3,
          disableForLocalhost: false,
        },
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const brRes = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });
        expect(brRes.headers.get("content-encoding")).toBe("br");

        const gzipRes = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "gzip" },
        });
        expect(gzipRes.headers.get("content-encoding")).toBe(null);

        const zstdRes = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "zstd" },
        });
        expect(zstdRes.headers.get("content-encoding")).toBe("zstd");
      } finally {
        server.stop();
      }
    });

    test("threshold prevents small file compression", async () => {
      const smallContent = "tiny";
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          threshold: 1000,
        },
        fetch() {
          return new Response(smallContent, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const res = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });

        expect(res.headers.get("content-encoding")).toBe(null);
        expect(await res.text()).toBe(smallContent);
      } finally {
        server.stop();
      }
    });

    test("localhost detection", async () => {
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          disableForLocalhost: true,
        },
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const res = await fetch(`http://127.0.0.1:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });

        expect(res.headers.get("content-encoding")).toBe(null);
        expect(await res.text()).toBe(TEST_CONTENT);
      } finally {
        server.stop();
      }
    });
  });

  describe("Content Filtering", () => {
    test("skips incompressible MIME types", async () => {
      const server = Bun.serve({
        port: 0,
        compression: true,
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "image/jpeg" },
          });
        },
      });

      try {
        const res = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br, gzip" },
        });

        expect(res.headers.get("content-encoding")).toBe(null);
      } finally {
        server.stop();
      }
    });

    test("skips already-encoded responses", async () => {
      const server = Bun.serve({
        port: 0,
        compression: true,
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: {
              "Content-Type": "text/plain",
              "Content-Encoding": "identity",
            },
          });
        },
      });

      try {
        const res = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });

        expect(res.headers.get("content-encoding")).toBe("identity");
      } finally {
        server.stop();
      }
    });
  });

  describe("Content Negotiation", () => {
    test("quality value negotiation", async () => {
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          gzip: 6,
          zstd: 3,
          disableForLocalhost: false,
        },
        fetch() {
          return new Response(TEST_CONTENT, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const res = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br;q=0.5, gzip;q=1.0" },
        });

        expect(res.headers.get("content-encoding")).toBe("gzip");
        expect(await res.text()).toBe(TEST_CONTENT);
      } finally {
        server.stop();
      }
    });
  });

  describe("Dynamic Routes", () => {
    test("on-demand compression", async () => {
      let requestCount = 0;
      const server = Bun.serve({
        port: 0,
        compression: {
          brotli: 4,
          gzip: 6,
          zstd: 3,
          disableForLocalhost: false,
        },
        async fetch() {
          requestCount++;
          return new Response(`Request #${requestCount}: ${TEST_CONTENT}`, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        for (const encoding of ENCODINGS) {
          const res = await fetch(`http://localhost:${server.port}`, {
            headers: { "Accept-Encoding": encoding },
          });

          expect(res.headers.get("content-encoding")).toBe(encoding);
          expect(res.headers.get("vary")).toBe("Accept-Encoding");

          const text = await res.text();
          expect(text).toContain("Request #");
          expect(text).toContain(TEST_CONTENT);
        }

        expect(requestCount).toBe(ENCODINGS.length);
      } finally {
        server.stop();
      }
    });

    test("no caching between requests", async () => {
      let requestCount = 0;
      const server = Bun.serve({
        port: 0,
        compression: true,
        fetch() {
          requestCount++;
          return new Response(`Count: ${requestCount}`, {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      try {
        const res1 = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });
        expect(await res1.text()).toBe("Count: 1");

        const res2 = await fetch(`http://localhost:${server.port}`, {
          headers: { "Accept-Encoding": "br" },
        });
        expect(await res2.text()).toBe("Count: 2");
      } finally {
        server.stop();
      }
    });
  });

  describe("Node.js Compatibility", () => {
    test("node:http never auto-compresses", async () => {
      using dir = tempDir("node-http-compression", {
        "server.js": `
          const http = require("http");
          const server = http.createServer((req, res) => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("${"Hello ".repeat(1000)}");
          });
          server.listen(0, () => {
            console.log(server.address().port);
          });
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), "server.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const reader = proc.stdout.getReader();
      const { value } = await reader.read();
      const port = parseInt(new TextDecoder().decode(value).trim());

      const res = await fetch(`http://localhost:${port}`, {
        headers: { "Accept-Encoding": "br, gzip" },
      });

      expect(res.headers.get("content-encoding")).toBe(null);

      proc.kill();
    });
  });
});
