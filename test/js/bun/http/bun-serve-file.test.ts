import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { fillRepeating, isBroken, isMacOS, isWindows, tmpdirSync, rmScope, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import type { Server } from "bun";

describe("Bun.file in serve routes", () => {
  let server: Server;
  let tempDir: string;
  let handler = mock(req => {
    return new Response(`fallback: ${req.url}`, {
      headers: {
        "Content-Type": "text/plain",
      },
    });
  });

  beforeAll(async () => {
    tempDir = tempDirWithFiles("bun-serve-file-test-", {
      "hello.txt": "Hello, World!",
      "empty.txt": "",
      "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
      "large.txt": Buffer.alloc(1024 * 1024 * 8, "bun").toString(), // 1MB file
      "unicode.txt": "Hello 世界 🌍 émojis",
      "json.json": JSON.stringify({ message: "test", number: 42 }),
      "nested/file.txt": "nested content",
      "special chars & symbols.txt": "special file content",
      "will-be-deleted.txt": "will be deleted",
    });

    const routes = {
      "/hello.txt": {
        GET: new Response(Bun.file(join(tempDir, "hello.txt"))),
        HEAD: new Response(Bun.file(join(tempDir, "hello.txt"))),
      },
      "/empty.txt": new Response(Bun.file(join(tempDir, "empty.txt"))),
      "/empty-400.txt": new Response(Bun.file(join(tempDir, "empty.txt")), {
        status: 400,
      }),
      "/binary.bin": new Response(Bun.file(join(tempDir, "binary.bin"))),
      "/large.txt": new Response(Bun.file(join(tempDir, "large.txt"))),
      "/unicode.txt": new Response(Bun.file(join(tempDir, "unicode.txt"))),
      "/json.json": new Response(Bun.file(join(tempDir, "json.json"))),
      "/nested/file.txt": new Response(Bun.file(join(tempDir, "nested", "file.txt"))),
      "/special-chars.txt": new Response(Bun.file(join(tempDir, "special chars & symbols.txt"))),
      "/nonexistent.txt": new Response(Bun.file(join(tempDir, "does-not-exist.txt"))),
      "/with-headers.txt": new Response(Bun.file(join(tempDir, "hello.txt")), {
        headers: {
          "X-Custom-Header": "custom-value",
          "Cache-Control": "max-age=3600",
        },
      }),
      "/with-status.txt": new Response(Bun.file(join(tempDir, "hello.txt")), {
        status: 201,
        statusText: "Created",
      }),
      "/will-be-deleted.txt": new Response(Bun.file(join(tempDir, "will-be-deleted.txt"))),
    };

    server = Bun.serve({
      routes: routes,
      port: 0,
      fetch: handler,
    });
    server.unref();

    unlinkSync(join(tempDir, "will-be-deleted.txt"));
  });

  afterAll(() => {
    server?.stop(true);
    using _ = rmScope(tempDir);
  });

  describe("Basic file serving", () => {
    it("serves text file", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
      expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
    });

    it("serves empty file", async () => {
      const res = await fetch(new URL(`/empty.txt`, server.url));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(res.headers.get("Content-Length")).toBe("0");
    });

    it("serves empty file with custom status code", async () => {
      const res = await fetch(new URL(`/empty-400.txt`, server.url));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("");
      expect(res.headers.get("Content-Length")).toBe("0");
    });

    it("serves binary file", async () => {
      const res = await fetch(new URL(`/binary.bin`, server.url));
      expect(res.status).toBe(200);
      const bytes = await res.bytes();
      expect(bytes).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]));
      expect(res.headers.get("Content-Type")).toMatch(/application\/octet-stream/);
    });

    it("serves large file", async () => {
      const res = await fetch(new URL(`/large.txt`, server.url));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBe(1024 * 1024 * 8);
      expect(text).toBe(Buffer.alloc(1024 * 1024 * 8, "bun").toString());
      expect(res.headers.get("Content-Length")).toBe((1024 * 1024 * 8).toString());
    });

    it("serves unicode file", async () => {
      const res = await fetch(new URL(`/unicode.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello 世界 🌍 émojis");
    });

    it("serves JSON file with correct content type", async () => {
      const res = await fetch(new URL(`/json.json`, server.url));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: "test", number: 42 });
      expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    });

    it("serves nested file", async () => {
      const res = await fetch(new URL(`/nested/file.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("nested content");
    });

    it("serves file with special characters in name", async () => {
      const res = await fetch(new URL(`/special-chars.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("special file content");
    });
  });

  describe("HTTP methods", () => {
    it("supports HEAD requests", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
      expect(res.headers.get("Content-Length")).toBe("13"); // "Hello, World!" length
      expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
    });

    it("supports GET requests", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), { method: "GET" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
    });
  });

  describe("Custom headers and status", () => {
    it("preserves custom headers", async () => {
      const res = await fetch(new URL(`/with-headers.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
      expect(res.headers.get("X-Custom-Header")).toBe("custom-value");
      expect(res.headers.get("Cache-Control")).toBe("max-age=3600");
    });

    it("preserves custom status", async () => {
      const res = await fetch(new URL(`/with-status.txt`, server.url));
      expect(res.status).toBe(201);
      expect(res.statusText).toBe("Created");
      expect(await res.text()).toBe("Hello, World!");
    });
  });

  describe("Error handling", () => {
    it("handles nonexistent files gracefully", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/nonexistent.txt`, server.url));

      // Should fall back to the handler since file doesn't exist
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`fallback: ${server.url}nonexistent.txt`);
      expect(handler.mock.calls.length).toBe(previousCallCount + 1);
    });
  });

  describe.todo("Range requests", () => {
    it("supports partial content requests", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "Range": "bytes=0-4",
        },
      });

      if (res.status === 206) {
        expect(await res.text()).toBe("Hello");
        expect(res.headers.get("Content-Range")).toMatch(/bytes 0-4\/13/);
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      } else {
        // If range requests aren't supported, should return full content
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("Hello, World!");
      }
    });

    it("handles invalid range requests", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "Range": "bytes=20-30", // Beyond file size
        },
      });

      // Should either return 416 Range Not Satisfiable or 200 with full content
      expect([200, 416]).toContain(res.status);
    });
  });

  describe("Conditional requests", () => {
    it("handles If-Modified-Since", async () => {
      // First request to get Last-Modified
      const res1 = await fetch(new URL(`/hello.txt`, server.url));
      const lastModified = res1.headers.get("Last-Modified");
      expect(lastModified).not.toBeEmpty();

      const res2 = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "If-Modified-Since": new Date(Date.parse(lastModified!) + 10000).toISOString(),
        },
      });

      expect(res2.status).toBe(304);
      expect(await res2.text()).toBe("");

      const res3 = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "If-Modified-Since": new Date(Date.now() - 1000000).toISOString(),
        },
      });

      expect(res3.status).toBe(200);
    });

    it.todo("handles ETag", async () => {
      const res1 = await fetch(new URL(`/hello.txt`, server.url));
      const etag = res1.headers.get("ETag");

      const res2 = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "If-None-Match": etag!,
        },
      });

      expect(res2.status).toBe(304);
      expect(await res2.text()).toBe("");
    });
  });

  describe("Stress testing", () => {
    test.each(["hello.txt", "large.txt"])(
      "concurrent requests for %s",
      async filename => {
        const batchSize = isWindows ? 8 : 32;
        const iterations = isWindows ? 2 : 5;

        async function iterate() {
          const promises = Array.from({ length: batchSize }, () =>
            fetch(`${server.url}${filename}`).then(res => {
              expect(res.status).toBe(200);
              return res.text();
            }),
          );

          const results = await Promise.all(promises);

          // Verify all responses are identical
          const expected = results[0];
          results.forEach(result => {
            expect(result).toBe(expected);
          });
        }

        for (let i = 0; i < iterations; i++) {
          await iterate();
          Bun.gc();
        }
      },
      30000,
    );

    it("memory usage stays reasonable", async () => {
      Bun.gc(true);
      const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;

      // Make many requests to large file
      for (let i = 0; i < 50; i++) {
        const res = await fetch(new URL(`/large.txt`, server.url));
        expect(res.status).toBe(200);
        await res.text(); // Consume the response
      }

      Bun.gc(true);
      const final = (process.memoryUsage.rss() / 1024 / 1024) | 0;
      const delta = final - baseline;

      console.log(`Memory usage: ${baseline}MB -> ${final}MB (delta: ${delta}MB)`);
      expect(delta).toBeLessThan(100); // Should not leak significant memory
    }, 30000);

    it("deleted file goes to handler", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/will-be-deleted.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`fallback: ${server.url}will-be-deleted.txt`);
      expect(handler.mock.calls.length).toBe(previousCallCount + 1);
    });
  });

  describe("Handler fallback", () => {
    it("falls back to handler for unmatched routes", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/not-in-routes.txt`, server.url));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`fallback: ${server.url}not-in-routes.txt`);
      expect(handler.mock.calls.length).toBe(previousCallCount + 1);
    });

    it("does not call handler for matched file routes", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/hello.txt`, server.url));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
      expect(handler.mock.calls.length).toBe(previousCallCount);
    });
  });
});
