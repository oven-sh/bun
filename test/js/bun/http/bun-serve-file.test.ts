import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { rmScope, tempDirWithFiles } from "harness";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

const LARGE_SIZE = 1024 * 1024 * 8;
const files = {
  "hello.txt": "Hello, World!",
  "empty.txt": "",
  "binary.bin": Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]),
  "large.txt": Buffer.alloc(LARGE_SIZE, "bun").toString(),
  "unicode.txt": "Hello 世界 🌍 émojis",
  "json.json": JSON.stringify({ message: "test", number: 42 }),
  "nested/file.txt": "nested content",
  "special chars & symbols.txt": "special file content",
  "will-be-deleted.txt": "will be deleted",
  "partial.txt": "0123456789ABCDEF",
};

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
    tempDir = tempDirWithFiles("bun-serve-file-test-", files);

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
      "/custom-last-modified.txt": new Response(Bun.file(join(tempDir, "hello.txt")), {
        headers: {
          "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT",
        },
      }),
      "/partial.txt": new Response(Bun.file(join(tempDir, "partial.txt"))),
      "/partial-slice.txt": new Response(Bun.file(join(tempDir, "partial.txt")).slice(5, 10)),
      "/fd-not-supported.txt": (() => {
        // This would test file descriptors, but they're not supported yet
        return new Response(Bun.file(join(tempDir, "hello.txt")));
      })(),
    } as const;

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
      const headers = res.headers.toJSON();
      if (!new Date(headers["last-modified"]!).getTime()) {
        throw new Error("Last-Modified header is not a valid date");
      }

      if (!new Date(headers["date"]!).getTime()) {
        throw new Error("Date header is not a valid date");
      }

      delete headers.date;
      delete headers["last-modified"];

      // Snapshot the headers so a test fails if we change the headers later.
      expect(headers).toMatchInlineSnapshot(`
        {
          "content-length": "13",
          "content-type": "text/plain;charset=utf-8",
        }
      `);
    });

    it("serves empty file", async () => {
      const res = await fetch(new URL(`/empty.txt`, server.url));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      // A server MUST NOT send a Content-Length header field in any response
      // with a status code of 1xx (Informational) or 204 (No Content). A server
      // MUST NOT send a Content-Length header field in any 2xx (Successful)
      // response to a CONNECT request (Section 9.3.6).
      expect(res.headers.get("Content-Length")).toBeNull();

      const headers = res.headers.toJSON();
      delete headers.date;
      delete headers["last-modified"];

      expect(headers).toMatchInlineSnapshot(`
        {
          "content-type": "text/plain;charset=utf-8",
        }
      `);
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
      expect(text).toHaveLength(LARGE_SIZE);

      if (files["large.txt"] !== text) {
        console.log("Expected length:", files["large.txt"].length);
        console.log("Actual length:", text.length);
        console.log("First 100 chars expected:", files["large.txt"].slice(0, 100));
        console.log("First 100 chars actual:", text.slice(0, 100));
        console.log("Last 100 chars expected:", files["large.txt"].slice(-100));
        console.log("Last 100 chars actual:", text.slice(-100));

        // Find first difference
        for (let i = 0; i < Math.min(files["large.txt"].length, text.length); i++) {
          if (files["large.txt"][i] !== text[i]) {
            console.log(`First difference at index ${i}:`);
            console.log(`Expected: "${files["large.txt"][i]}" (code: ${files["large.txt"].charCodeAt(i)})`);
            console.log(`Actual: "${text[i]}" (code: ${text.charCodeAt(i)})`);
            console.log(`Context around difference: "${files["large.txt"].slice(Math.max(0, i - 10), i + 10)}"`);
            console.log(`Actual context: "${text.slice(Math.max(0, i - 10), i + 10)}"`);
            break;
          }
        }
        throw new Error("large.txt is not the same");
      }

      expect(res.headers.get("Content-Length")).toBe(LARGE_SIZE.toString());

      const headers = res.headers.toJSON();
      delete headers.date;
      delete headers["last-modified"];

      expect(headers).toMatchInlineSnapshot(`
        {
          "content-length": "${LARGE_SIZE}",
          "content-type": "text/plain;charset=utf-8",
        }
      `);
    });

    it("serves unicode file", async () => {
      const res = await fetch(new URL(`/unicode.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello 世界 🌍 émojis");

      const headers = res.headers.toJSON();
      delete headers.date;
      delete headers["last-modified"];

      expect(headers).toMatchInlineSnapshot(`
        {
          "content-length": "25",
          "content-type": "text/plain;charset=utf-8",
        }
      `);
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
    describe.each(["GET", "HEAD"])("%s", method => {
      it(`handles If-Modified-Since with future date (304)`, async () => {
        // First request to get Last-Modified
        const res1 = await fetch(new URL(`/hello.txt`, server.url));
        const lastModified = res1.headers.get("Last-Modified");
        expect(lastModified).not.toBeEmpty();

        // If-Modified-Since is AFTER the file's last modified date (future)
        // Should return 304 because file hasn't been modified since that future date
        const res2 = await fetch(new URL(`/hello.txt`, server.url), {
          method,
          headers: {
            "If-Modified-Since": new Date(Date.parse(lastModified!) + 10000).toISOString(),
          },
        });

        expect(res2.status).toBe(304);
        expect(await res2.text()).toBe("");
      });

      it(`handles If-Modified-Since with past date (200)`, async () => {
        // If-Modified-Since is way in the past
        // Should return 200 because file has been modified since then
        const res = await fetch(new URL(`/hello.txt`, server.url), {
          method,
          headers: {
            "If-Modified-Since": new Date(Date.now() - 1000000).toISOString(),
          },
        });

        expect(res.status).toBe(200);
      });
    });

    it("ignores If-Modified-Since for non-GET/HEAD requests", async () => {
      const res1 = await fetch(new URL(`/hello.txt`, server.url));
      const lastModified = res1.headers.get("Last-Modified");

      const res2 = await fetch(new URL(`/hello.txt`, server.url), {
        method: "POST",
        headers: {
          "If-Modified-Since": new Date(Date.parse(lastModified!) + 10000).toISOString(),
        },
      });

      // Should not return 304 for POST
      expect(res2.status).not.toBe(304);
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
        const batchSize = 16;
        const iterations = 10;

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
          for (const result of results) {
            expect(result?.length).toBe(expected.length);
            expect(result).toBe(expected);
          }
        }

        for (let i = 0; i < iterations; i++) {
          await iterate();
          Bun.gc();
        }
      },
      60000,
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

  describe("Last-Modified header handling", () => {
    it("automatically adds Last-Modified header", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url));
      const lastModified = res.headers.get("Last-Modified");
      expect(lastModified).not.toBeNull();
      expect(lastModified).toMatch(/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    });

    it("respects custom Last-Modified header", async () => {
      const res = await fetch(new URL(`/custom-last-modified.txt`, server.url));
      expect(res.headers.get("Last-Modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
    });

    it("uses custom Last-Modified for If-Modified-Since checks", async () => {
      // Request with If-Modified-Since after custom date
      const res1 = await fetch(new URL(`/custom-last-modified.txt`, server.url), {
        headers: {
          "If-Modified-Since": "Thu, 22 Oct 2015 07:28:00 GMT",
        },
      });
      expect(res1.status).toBe(304);

      // Request with If-Modified-Since before custom date
      const res2 = await fetch(new URL(`/custom-last-modified.txt`, server.url), {
        headers: {
          "If-Modified-Since": "Tue, 20 Oct 2015 07:28:00 GMT",
        },
      });
      expect(res2.status).toBe(200);
    });
  });

  describe("File slicing", () => {
    it("serves complete file", async () => {
      const res = await fetch(new URL(`/partial.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("0123456789ABCDEF");
      expect(res.headers.get("Content-Length")).toBe("16");
    });

    it("serves sliced file", async () => {
      const res = await fetch(new URL(`/partial-slice.txt`, server.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("56789");
      expect(res.headers.get("Content-Length")).toBe("5");
    });
  });

  describe("Special status codes", () => {
    it("returns 204 for empty files with 200 status", async () => {
      const res = await fetch(new URL(`/empty.txt`, server.url));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("preserves custom status for empty files", async () => {
      const res = await fetch(new URL(`/empty-400.txt`, server.url));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("");
    });

    it("returns appropriate status for 304 responses", async () => {
      const res1 = await fetch(new URL(`/hello.txt`, server.url));
      const lastModified = res1.headers.get("Last-Modified");

      const res2 = await fetch(new URL(`/hello.txt`, server.url), {
        headers: {
          "If-Modified-Since": new Date(Date.parse(lastModified!) + 10000).toISOString(),
        },
      });

      expect(res2.status).toBe(304);
      expect(res2.headers.get("Content-Length")).toBeNull();
      expect(await res2.text()).toBe("");
    });
  });

  describe("Streaming and file types", () => {
    it("sets Content-Length for regular files", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url));
      expect(res.headers.get("Content-Length")).toBe("13");
    });

    it("handles HEAD requests with proper headers", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Length")).toBe("13");
      expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
      expect(res.headers.get("Last-Modified")).not.toBeNull();
      expect(await res.text()).toBe("");
    });

    it("handles abort/cancellation gracefully", async () => {
      const controller = new AbortController();
      const promise = fetch(new URL(`/large.txt`, server.url), {
        signal: controller.signal,
      });

      // Abort immediately
      controller.abort();

      await expect(promise).rejects.toThrow(/abort/i);
    });
  });

  describe("File not found handling", () => {
    it("falls back to handler when file doesn't exist", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/nonexistent.txt`, server.url));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`fallback: ${server.url}nonexistent.txt`);
      expect(handler.mock.calls.length).toBe(previousCallCount + 1);
    });

    it("falls back to handler when file is deleted after route creation", async () => {
      const previousCallCount = handler.mock.calls.length;
      const res = await fetch(new URL(`/will-be-deleted.txt`, server.url));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`fallback: ${server.url}will-be-deleted.txt`);
      expect(handler.mock.calls.length).toBe(previousCallCount + 1);
    });
  });

  describe("Content-Type detection", () => {
    it("detects text/plain for .txt files", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url));
      expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
    });

    it("detects application/json for .json files", async () => {
      const res = await fetch(new URL(`/json.json`, server.url));
      expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    });

    it("detects application/octet-stream for binary files", async () => {
      const res = await fetch(new URL(`/binary.bin`, server.url));
      expect(res.headers.get("Content-Type")).toMatch(/application\/octet-stream/);
    });
  });
});
