import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, rmScope, rss, tempDir, tempDirWithFiles } from "harness";
import { mkfifo } from "mkfifo";
import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import { connect } from "node:net";
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
  "bytes256.bin": Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
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
      "/hello-blob.txt": Bun.file(join(tempDir, "hello.txt")),
      "/with-etag.txt": new Response(Bun.file(join(tempDir, "hello.txt")), {
        headers: { "ETag": '"custom-etag"' },
      }),
      "/partial.txt": new Response(Bun.file(join(tempDir, "partial.txt"))),
      "/partial-slice.txt": new Response(Bun.file(join(tempDir, "partial.txt")).slice(5, 10)),
      // Rendering a handler response built from an unread Bun.file() stream
      // turns the stream back into the file Blob; the slice must survive that.
      "/partial-slice-stream-handler": () => new Response(Bun.file(join(tempDir, "partial.txt")).slice(5, 10).stream()),
      "/partial-open-slice-stream-handler": () =>
        new Response(Bun.file(join(tempDir, "partial.txt")).slice(10).stream()),
      "/partial-empty-slice-stream-handler": () =>
        new Response(Bun.file(join(tempDir, "partial.txt")).slice(5, 5).stream()),
      "/partial-stream-handler": () => new Response(Bun.file(join(tempDir, "partial.txt")).stream()),
      "/fd-not-supported.txt": (() => {
        // This would test file descriptors, but they're not supported yet
        return new Response(Bun.file(join(tempDir, "hello.txt")));
      })(),
      // Static route with user-set Content-Range — auto-Range must be disabled.
      "/user-content-range-route": new Response(Bun.file(join(tempDir, "partial.txt")), {
        headers: { "Content-Range": "bytes 0-15/100" },
      }),
      // Function routes (dynamic responses) — exercised by the fetch-handler
      // Range tests below. Kept as routes (not the `fetch` fallback) so they
      // don't perturb the fallback handler's mock call count.
      "/range-handler": () => new Response(Bun.file(join(tempDir, "partial.txt"))),
      "/user-content-range-handler": () =>
        new Response(Bun.file(join(tempDir, "partial.txt")), { headers: { "Content-Range": "bytes 0-15/100" } }),
      "/range-after-size": () => {
        const f = Bun.file(join(tempDir, "partial.txt"));
        void f.size;
        return new Response(f);
      },
      "/slice-escape": () => new Response(Bun.file(join(tempDir, "bytes256.bin")).slice(0, 100)),
      "/range-custom-headers": () =>
        new Response(Bun.file(join(tempDir, "partial.txt")), {
          headers: { "Cache-Control": "max-age=3600", "X-Custom": "abc" },
        }),
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

  describe.concurrent("Basic file serving", () => {
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
      // An empty file is a valid zero-byte representation: a plain 200 with
      // `Content-Length: 0`, the same framing every other empty body form
      // (`new Response("")`, `new Blob([])`, ...) gets.
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");

      const headers = res.headers.toJSON();
      delete headers.date;
      delete headers["last-modified"];

      expect(headers).toMatchInlineSnapshot(`
        {
          "content-length": "0",
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

  describe.concurrent("HTTP methods", () => {
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

  describe.concurrent("Custom headers and status", () => {
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

  describe.concurrent("Conditional requests", () => {
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

    it("If-Modified-Since wins over Range (304, no Content-Range)", async () => {
      // RFC 9110 §13.2.2: preconditions evaluate before Range. An unmodified
      // resource returns 304 even when a Range header is present.
      const res1 = await fetch(new URL(`/partial.txt`, server.url));
      const lastModified = res1.headers.get("Last-Modified");
      expect(lastModified).not.toBeEmpty();

      const res2 = await fetch(new URL(`/partial.txt`, server.url), {
        headers: {
          "If-Modified-Since": new Date(Date.parse(lastModified!) + 10000).toISOString(),
          "Range": "bytes=0-3",
        },
      });

      expect(res2.status).toBe(304);
      expect(res2.headers.get("content-range")).toBeNull();
      expect(await res2.text()).toBe("");
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

    describe.each(["/hello.txt", "/hello-blob.txt"])("If-None-Match on %s", path => {
      describe.each(["GET", "HEAD"])("%s", method => {
        it("returns 304 for If-None-Match: *", async () => {
          // RFC 9110 §13.1.2: `*` matches any current representation.
          const res = await fetch(new URL(path, server.url), {
            method,
            headers: { "If-None-Match": "*" },
          });
          expect(res.status).toBe(304);
          expect(await res.text()).toBe("");
        });

        it("ignores If-Modified-Since when If-None-Match is present and does not match", async () => {
          // RFC 9110 §13.2.2 step 4: If-Modified-Since is only evaluated when
          // If-None-Match is NOT present. A non-matching If-None-Match means
          // the condition is true: serve the representation (200), even though
          // If-Modified-Since alone would have produced 304.
          const lastModified = (await fetch(new URL(path, server.url))).headers.get("Last-Modified");
          expect(lastModified).not.toBeEmpty();

          const res = await fetch(new URL(path, server.url), {
            method,
            headers: {
              "If-None-Match": '"does-not-match"',
              "If-Modified-Since": lastModified!,
            },
          });
          expect(res.status).toBe(200);
          if (method === "GET") expect(await res.text()).toBe("Hello, World!");
        });

        it("still 304s for If-None-Match: * when If-Modified-Since is also present", async () => {
          const res = await fetch(new URL(path, server.url), {
            method,
            headers: {
              "If-None-Match": "*",
              "If-Modified-Since": "Tue, 01 Jan 1980 00:00:00 GMT",
            },
          });
          expect(res.status).toBe(304);
          expect(await res.text()).toBe("");
        });
      });
    });

    it("does not apply If-None-Match to POST requests on file routes", async () => {
      const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
        method: "POST",
        headers: { "If-None-Match": "*" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
    });

    it("returns 304 when If-None-Match matches a user-set ETag on a file route", async () => {
      const res = await fetch(new URL(`/with-etag.txt`, server.url), {
        headers: { "If-None-Match": '"custom-etag"' },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('"custom-etag"');
      expect(await res.text()).toBe("");
    });

    it("returns 200 when If-None-Match does not match a user-set ETag on a file route", async () => {
      const res = await fetch(new URL(`/with-etag.txt`, server.url), {
        headers: { "If-None-Match": '"other"' },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
    });

    // RFC 9110 §13.2.2 steps 1–2: If-Match / If-Unmodified-Since evaluate
    // first and short-circuit with 412 before If-None-Match / If-Modified-Since.
    describe.each(["GET", "HEAD"])("If-Match / If-Unmodified-Since (%s)", method => {
      it("If-Match: non-matching tag on a file route with ETag → 412", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"zz"' },
        });
        expect(res.status).toBe(412);
        expect(await res.text()).toBe("");
      });

      it("If-Match: matching tag on a file route with ETag → 200", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"custom-etag"' },
        });
        expect(res.status).toBe(200);
        if (method === "GET") expect(await res.text()).toBe("Hello, World!");
      });

      it("If-Match: * on a file route without a stored ETag → 200", async () => {
        const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
          method,
          headers: { "If-Match": "*" },
        });
        expect(res.status).toBe(200);
      });

      it("If-Match: tag list on a file route without a stored ETag → 412", async () => {
        const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
          method,
          headers: { "If-Match": '"anything"' },
        });
        expect(res.status).toBe(412);
        expect(await res.text()).toBe("");
      });

      it('If-Match: W/"custom-etag" uses strong compare → 412', async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": 'W/"custom-etag"' },
        });
        expect(res.status).toBe(412);
      });

      it("If-Unmodified-Since earlier than mtime → 412", async () => {
        const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
          method,
          headers: { "If-Unmodified-Since": "Mon, 01 Jan 2001 00:00:00 GMT" },
        });
        expect(res.status).toBe(412);
        expect(await res.text()).toBe("");
      });

      it("If-Unmodified-Since at or after mtime → 200", async () => {
        const lm = (await fetch(new URL(`/hello-blob.txt`, server.url))).headers.get("Last-Modified");
        expect(lm).not.toBeEmpty();
        const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
          method,
          headers: { "If-Unmodified-Since": lm! },
        });
        expect(res.status).toBe(200);
      });

      it("If-Match failure + If-None-Match match → 412 (not 304)", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"zz"', "If-None-Match": '"custom-etag"' },
        });
        expect(res.status).toBe(412);
      });

      it("If-Match failure + Range → 412 (no Content-Range)", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"zz"', "Range": "bytes=0-3" },
        });
        expect(res.status).toBe(412);
        expect(res.headers.get("content-range")).toBeNull();
        expect(await res.text()).toBe("");
      });

      it("If-Match present suppresses If-Unmodified-Since", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"custom-etag"', "If-Unmodified-Since": "Mon, 01 Jan 2001 00:00:00 GMT" },
        });
        expect(res.status).toBe(200);
      });
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
      // Warm up so one-time allocations (connection pool, file read buffers, response
      // body buffers that the allocator retains) aren't counted as a leak. RSS rarely
      // shrinks after GC on Linux, so the baseline must be taken at steady state.
      for (let i = 0; i < 5; i++) {
        const res = await fetch(new URL(`/large.txt`, server.url));
        await res.text();
      }

      Bun.gc(true);
      const baseline = (rss() / 1024 / 1024) | 0;

      // Make many requests to large file
      for (let i = 0; i < 50; i++) {
        const res = await fetch(new URL(`/large.txt`, server.url));
        expect(res.status).toBe(200);
        await res.text(); // Consume the response
      }

      Bun.gc(true);
      const final = (rss() / 1024 / 1024) | 0;
      const delta = final - baseline;

      // ASAN's quarantine retains freed allocations (default 256 MB) so RSS
      // deltas run far higher under bun-asan; widen the threshold there.
      expect(delta).toBeLessThan(isASAN ? 400 : 100); // Should not leak significant memory
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

  describe.concurrent("Last-Modified header handling", () => {
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

  describe.concurrent("File slicing", () => {
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

    it("serves the slice behind a sliced file's stream from a handler", async () => {
      const serve = async (pathname: string) => {
        const get = await fetch(new URL(pathname, server.url));
        const head = await fetch(new URL(pathname, server.url), { method: "HEAD" });
        return {
          body: await get.text(),
          contentLength: get.headers.get("Content-Length"),
          headContentLength: head.headers.get("Content-Length"),
        };
      };
      expect({
        "slice(5, 10)": await serve("/partial-slice-stream-handler"),
        "slice(10)": await serve("/partial-open-slice-stream-handler"),
        "slice(5, 5)": await serve("/partial-empty-slice-stream-handler"),
        "whole file": await serve("/partial-stream-handler"),
      }).toEqual({
        "slice(5, 10)": { body: "56789", contentLength: "5", headContentLength: "5" },
        "slice(10)": { body: "ABCDEF", contentLength: "6", headContentLength: "6" },
        "slice(5, 5)": { body: "", contentLength: "0", headContentLength: "0" },
        "whole file": { body: "0123456789ABCDEF", contentLength: "16", headContentLength: "16" },
      });
    });

    // The slice is shorter than the file, so the byte budget runs out before
    // the reader reports EOF: the response completes inline while a deferred
    // completion still hops through the event loop. Repeated requests must
    // each deliver exactly the slice and recycle the request context cleanly.
    it("truncated-length EOF path completes cleanly across repeated requests", async () => {
      for (let i = 0; i < 32; i++) {
        const res = await fetch(new URL(`/partial-slice.txt`, server.url));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("56789");
        expect(res.headers.get("Content-Length")).toBe("5");
      }
      // The pool is still healthy afterwards: an unrelated route responds.
      const check = await fetch(new URL(`/hello-blob.txt`, server.url));
      expect(check.status).toBe(200);
    });
  });

  describe.concurrent("Special status codes", () => {
    // Bun used to rewrite the default 200 of an empty file-backed body to
    // 204. No other empty body form got that treatment, HEAD of the same URL
    // did not, and a server-invented 204 dropped the Content-Type.
    it("returns 200 for empty files, for GET and HEAD alike", async () => {
      for (const method of ["GET", "HEAD"]) {
        const res = await fetch(new URL(`/empty.txt`, server.url), { method });
        expect({ method, status: res.status, contentLength: res.headers.get("Content-Length") }).toEqual({
          method,
          status: 200,
          contentLength: "0",
        });
        expect(await res.text()).toBe("");
      }
    });

    it("returns 200 for empty files served from the fetch handler, for GET and HEAD alike", async () => {
      const emptyPath = join(tempDir, "empty.txt");
      using handlerServer = Bun.serve({
        port: 0,
        fetch: () => new Response(Bun.file(emptyPath)),
      });
      for (const method of ["GET", "HEAD"]) {
        const res = await fetch(handlerServer.url, { method });
        expect({ method, status: res.status, contentLength: res.headers.get("Content-Length") }).toEqual({
          method,
          status: 200,
          contentLength: "0",
        });
        expect(await res.text()).toBe("");
      }
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

  describe.concurrent("Streaming and file types", () => {
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

  describe.concurrent("Content-Type detection", () => {
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

  describe.concurrent.each([
    ["FileRoute", "/partial.txt"],
    ["fetch handler", "/range-handler"],
  ])("Range requests via %s", (_label, path) => {
    const body = files["partial.txt"];

    it.each([
      ["bytes=0-3", 206, "0123", "bytes 0-3/16"],
      ["bytes=4-", 206, "456789ABCDEF", "bytes 4-15/16"],
      ["bytes=-4", 206, "CDEF", "bytes 12-15/16"],
      ["bytes=0-999", 206, body, "bytes 0-15/16"],
      ["Bytes = 2-5", 206, "2345", "bytes 2-5/16"],
    ])("%s → %d", async (range, status, expected, contentRange) => {
      const res = await fetch(new URL(path, server.url), { headers: { Range: range } });
      expect(res.status).toBe(status);
      expect(res.headers.get("content-range")).toBe(contentRange);
      expect(res.headers.get("content-length")).toBe(String(expected.length));
      expect(await res.text()).toBe(expected);
    });

    it("416 on start past EOF", async () => {
      const res = await fetch(new URL(path, server.url), { headers: { Range: "bytes=100-200" } });
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */16");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(await res.text()).toBe("");
    });

    it("ignores multi-range and serves full body", async () => {
      const res = await fetch(new URL(path, server.url), { headers: { Range: "bytes=0-1,4-5" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(body);
    });

    // RFC 9110 §14.1.2: first-pos, last-pos and suffix-length are 1*DIGIT.
    // A sign or a `_` separator makes the header unparseable, so it is ignored.
    it.each([
      "bytes=+0-+3",
      "bytes=+5-",
      "bytes=0-+3",
      "bytes=-+4",
      "bytes=0--0",
      "bytes=--0",
      "bytes=1_0-1_2",
      "bytes=-1_0",
    ])("ignores malformed position in %j and serves full body", async range => {
      const res = await fetch(new URL(path, server.url), { headers: { Range: range } });
      expect({
        status: res.status,
        contentRange: res.headers.get("content-range"),
        body: await res.text(),
      }).toEqual({ status: 200, contentRange: null, body });
    });

    it("ignores Range for non-GET/HEAD methods", async () => {
      // RFC 9110 §14.2: Range is only defined for GET.
      const res = await fetch(new URL(path, server.url), { method: "POST", headers: { Range: "bytes=0-3" } });
      expect(res.status).not.toBe(206);
      expect(res.headers.get("content-range")).toBeNull();
    });
  });

  describe.concurrent("Range with custom headers (fetch handler)", () => {
    it("416 preserves user headers", async () => {
      const res = await fetch(new URL("/range-custom-headers", server.url), { headers: { Range: "bytes=100-200" } });
      expect(res.status).toBe(416);
      expect(res.headers.get("cache-control")).toBe("max-age=3600");
      expect(res.headers.get("x-custom")).toBe("abc");
      expect(res.headers.get("content-range")).toBe("bytes */16");
    });

    it("206 preserves user headers", async () => {
      const res = await fetch(new URL("/range-custom-headers", server.url), { headers: { Range: "bytes=0-3" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("cache-control")).toBe("max-age=3600");
      expect(res.headers.get("x-custom")).toBe("abc");
      expect(await res.text()).toBe("0123");
    });
  });

  describe.concurrent("user-set Content-Range disables automatic Range handling", () => {
    const body = files["partial.txt"];

    it.each([
      ["FileRoute", "/user-content-range-route"],
      ["fetch handler", "/user-content-range-handler"],
    ])("via %s: client Range ignored, user Content-Range preserved", async (_label, path) => {
      const res = await fetch(new URL(path, server.url), { headers: { Range: "bytes=2-5" } });
      // User explicitly set Content-Range — they're managing partial responses
      // themselves. We must serve the full body with their header, exactly once.
      expect(await res.text()).toBe(body);
      expect(res.headers.get("content-range")).toBe("bytes 0-15/100");
    });
  });

  describe.concurrent("Range via fetch handler edge cases", () => {
    it("Range works after JS reads file.size before constructing Response", async () => {
      // Reading .size resolves the Blob.max_size sentinel; the Range guard must
      // also accept original_size == stat_size for this case.
      const res = await fetch(new URL("/range-after-size", server.url), { headers: { Range: "bytes=4-7" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 4-7/16");
      expect(await res.text()).toBe("4567");
    });

    it("Range header cannot escape a Bun.file().slice(0, n) window via fetch handler", async () => {
      const res = await fetch(new URL("/slice-escape", server.url), { headers: { Range: "bytes=200-220" } });
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Range must be ignored for sliced blobs: serve the 100-byte slice, never bytes 200-220.
      expect(bytes.length).toBe(100);
      expect(bytes[0]).toBe(0);
      expect(bytes[99]).toBe(99);
      expect(res.headers.get("content-range")).not.toContain("/256");
    });
  });
});

// A body write that returns backpressure must pause the reader until the
// socket drains. For a pollable fd (FIFO, character device, socket) the read
// loop re-arms its poll after EAGAIN, so a reader that is not paused keeps
// moving the source into the response's backpressure buffer, without a bound,
// while the client reads nothing. When the client reads again, on_writable
// must unpause the reader, or the response stalls. A client that disconnects
// frees the stream. If its poll is still armed, the next readable event reaches
// the freed reader. Bun.file(fd) keeps the fd open after the response ends, so
// that event comes as soon as the pipe has data.
for (const [source, then] of [
  ["path", "disconnect"],
  ["fd", "disconnect"],
  ["path", "resume"],
] as const) {
  test.concurrent.skipIf(isWindows)(
    `pollable Bun.file(${source}) response stops reading while the client does not read, then ${then === "resume" ? "resumes when the client reads" : "survives the disconnect"}`,
    async () => {
      using dir = tempDir("serve-fifo-backpressure", {
        "fixture.ts": `
import { connect } from "node:net";
import { constants, openSync, writeSync } from "node:fs";

const [fifoPath, limit, source, then] = process.argv.slice(2);
const LIMIT = Number(limit);

// Open the FIFO read+write so open() never blocks waiting for the other end
// and the pipe never reports HUP/EOF. With O_NONBLOCK a write to a full pipe
// fails with EAGAIN, so \`pumped\` grows only when the server reads the pipe.
const writerFd = openSync(fifoPath, constants.O_RDWR | constants.O_NONBLOCK);

const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname === "/alive") {
      return new Response("alive");
    }
    return new Response(source === "fd" ? Bun.file(writerFd) : Bun.file(fifoPath));
  },
});

const CHUNK = Buffer.alloc(64 * 1024, 120);
let pumped = 0;
function fill() {
  try {
    for (;;) pumped += writeSync(writerFd, CHUNK);
  } catch (err) {
    if (err.code !== "EAGAIN") throw err;
  }
}

// Fills the pipe, then makes one request to this server. The server shares
// this event loop and must poll for I/O to answer. The full pipe is readable
// during that poll, so a reader with an armed poll reads it before the answer
// arrives. A paused reader leaves the pipe full. Returns the bytes that the
// server read.
async function fillAndPoll() {
  fill();
  const before = pumped;
  const res = await fetch("http://127.0.0.1:" + server.port + "/alive");
  await res.text();
  fill();
  return pumped - before;
}

// Waits for a request during which the server reads from the pipe. The bound
// on the request count makes a broken build fail with a message, not a hang.
async function waitForRead(label) {
  for (let i = 0; i < 200; i++) {
    if ((await fillAndPoll()) > 0) return console.log(label);
  }
  console.log("no read for " + label);
}

// Before the kernel socket buffers fill, each request shows a read. A paused
// reader shows none. The buffers on loopback hold a few MiB, and LIMIT is far
// above that.
async function waitForStall() {
  let read = 0;
  while (read < LIMIT) {
    const n = await fillAndPoll();
    if (n === 0) return console.log("stalled");
    read += n;
  }
  console.log("still reading after " + read + " bytes");
}

// Raw client that sends the request and then does not read the response, so
// the body writes on the server side end up returning backpressure.
const socket = connect({ port: server.port, host: "127.0.0.1", pauseOnConnect: true });
socket.on("error", () => {});
await new Promise(resolve => socket.once("connect", resolve));
socket.write("GET /stream HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n");
socket.pause();

await waitForRead("streaming");
await waitForStall();

if (then === "resume") {
  // Read the response. The socket drains, and the server reads the pipe again.
  socket.on("data", () => {});
  socket.resume();
  await waitForRead("resumed");

  // Stop reading again before the disconnect. A stream that waits for pipe
  // data when its client disconnects stays allocated while the pipe is open,
  // and the leak check at exit reports it. A paused stream is freed.
  socket.pause();
  await waitForStall();
  socket.destroy();
  const res = await fetch("http://127.0.0.1:" + server.port + "/alive");
  await res.text();
} else {
  // Disconnect the stalled client. The server must survive the abort of the
  // backpressured file stream and still answer requests. The second request
  // polls with a full pipe, so a poll that the aborted stream left armed fires.
  socket.destroy();
  let res = await fetch("http://127.0.0.1:" + server.port + "/alive");
  console.log(await res.text());
  fill();
  res = await fetch("http://127.0.0.1:" + server.port + "/alive");
  console.log(await res.text());
}

server.stop(true);
process.exit(0);
`,
      });

      const fifoPath = join(String(dir), "stream.fifo");
      mkfifo(fifoPath);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.ts", fifoPath, String(32 * 1024 * 1024), source, then],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe(
        then === "resume" ? "streaming\nstalled\nresumed\nstalled" : "streaming\nstalled\nalive\nalive",
      );
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
  );
}

// A FIFO's stat size is 0, but the body length is unknown until EOF. Writing
// Content-Length from the stat size and then streaming the pipe to EOF puts
// body bytes on the wire past the declared length; on a keep-alive connection
// those bytes land where the client parses the next response's status line
// (RFC 9112 6.3). The response must be chunk-framed instead.
test.skipIf(isWindows)("Response(Bun.file(FIFO)) frames the body as chunked, not Content-Length: 0", async () => {
  using dir = tempDir("serve-fifo-framing", {});
  const fifoPath = join(String(dir), "body.fifo");
  mkfifo(fifoPath);

  // Hold the FIFO open read+write so the server's O_RDONLY|O_NONBLOCK open
  // always finds a writer (its reads EAGAIN instead of reporting EOF before we
  // write). The fd is released in `finally`; we do not close it mid-test to
  // signal EOF because the server's FIFO-EOF handling is platform-dependent
  // and not what this test is about.
  const writerFd = openSync(fifoPath, "r+");
  try {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response(Bun.file(fifoPath));
      },
    });

    const { promise: wireDone, resolve: resolveWire } = Promise.withResolvers<string>();
    let wire = "";
    const client = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open(s) {
          s.write("GET /fifo HTTP/1.1\r\nHost: x\r\n\r\n");
        },
        data(_s, d) {
          wire += Buffer.from(d).toString("latin1");
          if (wire.includes("PIPEBYTES!")) resolveWire(wire);
        },
        close() {
          resolveWire(wire);
        },
        error() {
          resolveWire(wire);
        },
      },
    });

    // The payload sits in the FIFO buffer (kept alive by writerFd) until the
    // server opens its read end; the server's first body write then carries it
    // to the wire together with whatever framing the head declared.
    writeSync(writerFd, "PIPEBYTES!");
    const captured = await wireDone;
    client.end();

    const head = captured.split("\r\n\r\n")[0];
    // The broken build wrote `content-length: 0` from the FIFO's stat size and
    // then emitted the pipe bytes raw after the head (body past the declared
    // length). With the fix the head carries no Content-Length and the first
    // body write enters chunked mode.
    expect({
      status: head.split("\r\n")[0],
      hasContentLength: /^content-length:/im.test(head),
      isChunked: /^transfer-encoding:\s*chunked/im.test(head),
      bodyDelivered: captured.includes("PIPEBYTES!"),
      bodyBytesPastContentLengthZero: /^content-length:\s*0$/im.test(head) && captured.includes("PIPEBYTES!"),
    }).toEqual({
      status: "HTTP/1.1 200 OK",
      hasContentLength: false,
      isChunked: true,
      bodyDelivered: true,
      bodyBytesPastContentLengthZero: false,
    });
  } finally {
    closeSync(writerFd);
  }
});

// A file route serves the window of the Bun.file() slice it was built from,
// given either the slice or its unread stream (which is turned back into the
// slice). FileRoute used to clamp the window to the file size without taking
// the offset off, and to send an empty window to EOF: on this 16-byte file
// slice(10) declared Content-Length: 16 and sent 6 bytes, slice(5, 5) declared
// 0 and sent 11. Only the wire shows that (RFC 9112 6.3); fetch() drops bytes
// past the declared length and turns a short body into a connection error.
test("file routes frame a slice that reaches or starts past EOF by the bytes they serve", async () => {
  using dir = tempDir("serve-file-route-slice-framing", { "partial.txt": "0123456789ABCDEF" });
  const file = () => Bun.file(join(String(dir), "partial.txt"));
  const windows = {
    "slice(5, 10)": () => file().slice(5, 10),
    "slice(10)": () => file().slice(10),
    "slice(10, 100)": () => file().slice(10, 100),
    "slice(5, 5)": () => file().slice(5, 5),
    "slice(100)": () => file().slice(100),
    "whole file": () => file(),
  };
  const names = Object.keys(windows) as (keyof typeof windows)[];
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: Object.fromEntries(
      names.flatMap((name, i) => [
        [`/blob/${i}`, new Response(windows[name]())],
        [`/stream/${i}`, new Response(windows[name]().stream())],
      ]),
    ),
    fetch: () => new Response("fallback", { status: 404 }),
  });

  // One GET on its own connection; `Connection: close` makes the server hang
  // up once it considers the response finished, so `body` is every byte that
  // followed the head, however many the head declared.
  async function wire(path: string) {
    const { promise, resolve } = Promise.withResolvers<string>();
    let captured = "";
    await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open(socket) {
          socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        },
        data(_socket, chunk) {
          captured += Buffer.from(chunk).toString("latin1");
        },
        close() {
          resolve(captured);
        },
        error() {
          resolve(captured);
        },
      },
    });
    const raw = await promise;
    const headEnd = raw.indexOf("\r\n\r\n");
    return {
      contentLength: /^content-length:\s*(\d+)/im.exec(raw.slice(0, headEnd))?.[1] ?? null,
      body: raw.slice(headEnd + 4),
    };
  }

  const results: Record<string, unknown> = {};
  for (const [i, name] of names.entries()) {
    results[name] = { blob: await wire(`/blob/${i}`), stream: await wire(`/stream/${i}`) };
  }

  const exactly = (body: string) => ({ contentLength: String(body.length), body });
  expect(results).toEqual({
    "slice(5, 10)": { blob: exactly("56789"), stream: exactly("56789") },
    "slice(10)": { blob: exactly("ABCDEF"), stream: exactly("ABCDEF") },
    "slice(10, 100)": { blob: exactly("ABCDEF"), stream: exactly("ABCDEF") },
    "slice(5, 5)": { blob: exactly(""), stream: exactly("") },
    "slice(100)": { blob: exactly(""), stream: exactly("") },
    "whole file": { blob: exactly("0123456789ABCDEF"), stream: exactly("0123456789ABCDEF") },
  });
});

// A request that declares a body arms the request-body (onData) callback on
// the uWS response before the fetch handler runs. uWS keeps a single shared
// userdata slot per response, so when the handler returns a file response
// without reading the body, FileResponseStream's own callback registrations
// repoint that slot at the stream object. The body callback must therefore be
// disarmed before the file stream starts; otherwise body bytes that arrive
// while the file is still streaming are delivered to the body callback with
// the wrong object behind the pointer.
test("file response with a pending request body keeps serving when body bytes arrive mid-stream", async () => {
  using dir = tempDir("serve-file-late-body", {
    "fixture.ts": `
import { connect } from "node:net";
import { join } from "node:path";

// Large enough that the response cannot be fully absorbed by kernel socket
// buffers, so the file is still streaming when the late body bytes arrive.
const filePath = join(import.meta.dir, "big.bin");
await Bun.write(filePath, Buffer.alloc(32 * 1024 * 1024, 97));

const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname === "/alive") {
      return new Response("still-serving");
    }
    // Never reads req.body: the request-body callback stays armed when the
    // file response starts.
    return new Response(Bun.file(filePath));
  },
});

const socket = connect({ port: server.port, host: "127.0.0.1" });
socket.setNoDelay(true);
socket.on("error", () => {});
await new Promise(resolve => socket.once("connect", resolve));

const done = Promise.withResolvers();
let sentBody = false;
let tail = "";
socket.on("data", chunk => {
  tail = (tail + chunk.toString("latin1")).slice(-4096);
  if (!sentBody) {
    // First response bytes: the handler has returned and the file response
    // stream has started. Now deliver the withheld request body, plus a
    // pipelined request so the connection produces an observable outcome
    // (either the server closes it, or it eventually answers the GET).
    sentBody = true;
    console.log("file-response-started");
    socket.write(Buffer.alloc(65536, 0x41));
    socket.write("GET /alive HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n");
  } else if (tail.includes("still-serving")) {
    done.resolve("pipelined-response");
  }
});
socket.on("close", () => done.resolve("closed"));

// Headers only: declare a 64 KiB body but withhold it until the file response
// has started.
socket.write("POST /upload HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 65536\\r\\n\\r\\n");

await done.promise;
socket.destroy();

// The server must still answer fresh requests after consuming the late body bytes.
const res = await fetch("http://127.0.0.1:" + server.port + "/alive");
console.log(await res.text());
server.stop(true);
process.exit(0);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("file-response-started\nstill-serving");
  expect(exitCode).toBe(0);
}, 30_000);

// On Windows, FileResponseStream closes its fd via Closer::close in Drop AND
// WindowsBufferedReader::Drop closed the same CRT fd via File::start_close
// (CLOSE_HANDLE was cleared on the reader but never honored). Between the two
// async uv_fs_close calls, an unrelated open could be handed the recycled
// slot and have it closed under it. On POSIX the reader honors CLOSE_HANDLE,
// so this is effectively a Windows regression test.
test.skipIf(!isWindows)(
  "Response(Bun.file) does not double-close the fd on Windows",
  async () => {
    using dir = tempDir("serve-file-double-close", {
      "served.bin": Buffer.alloc(32 * 1024, 65),
      "victim.json": JSON.stringify({ ok: true }),
      "fixture.ts": /* ts */ `
import { openSync, fstatSync, closeSync } from "node:fs";
let serverError: unknown;
const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(Bun.file("served.bin"));
  },
  error(e) {
    serverError ??= e;
    return new Response("err", { status: 500 });
  },
});
const url = "http://127.0.0.1:" + server.port + "/";
let canaryHits = 0;
for (let round = 0; round < 160; round++) {
  const tasks: Promise<unknown>[] = [];
  // Full fetches: each one drops a FileResponseStream on completion.
  for (let i = 0; i < 48; i++) tasks.push(fetch(url).then(r => r.arrayBuffer()));
  // Aborted fetches: each one drops a FileResponseStream from on_aborted,
  // which is where the double-close raced most readily against new opens.
  for (let i = 0; i < 48; i++) {
    const c = new AbortController();
    tasks.push(
      fetch(url, { signal: c.signal })
        .then(r => { c.abort(); return r.arrayBuffer().catch(() => {}); })
        .catch(() => {}),
    );
  }
  // Victim Bun.file().text() reads (async uv_fs_open -> uv_fs_fstat).
  for (let i = 0; i < 16; i++) {
    tasks.push(Bun.file("victim.json").json().then(v => {
      if (!v.ok) throw new Error("wrong contents");
    }));
  }
  await Promise.all(tasks);
  if (serverError) throw serverError;
  // Canary: a synchronously opened fd must still be valid on the next tick.
  // The second queued uv_fs_close runs on the threadpool and, without the
  // fix, can close this exact recycled slot.
  const canary = openSync("victim.json", "r");
  await Bun.sleep(0);
  try { fstatSync(canary); } catch { canaryHits++; }
  try { closeSync(canary); } catch {}
}
server.stop(true);
if (canaryHits) throw new Error("double-close closed " + canaryHits + " canary fds");
console.log("OK");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
  },
  60_000,
);

// FileRoute borrows the blob store's path slice for the duration of the
// request (no per-request copy). A burst of concurrent requests under ASAN
// would surface a use-after-free if that borrow were unsound.
test("file route serves a burst of concurrent requests after reloads", async () => {
  using dir = tempDir("file-route-path-borrow", {
    "hello.txt": "hello from file route",
  });
  const body = "hello from file route";
  const file = () => new Response(Bun.file(join(String(dir), "hello.txt")));

  await using server = Bun.serve({
    port: 0,
    routes: { "/f": file() },
    fetch: () => new Response("fallback", { status: 404 }),
  });

  // Reload a few times so the file route's blob store is replaced between
  // bursts; the last config wins.
  for (let i = 0; i < 3; i++) {
    server.reload({
      routes: { "/a": new Response("a-old"), "/f": file(), "/b": new Response("b") },
      fetch: () => new Response("fallback", { status: 404 }),
    });
    server.reload({
      routes: { "/a": new Response("a-new"), "/f": file(), "/b": new Response("b") },
      fetch: () => new Response("fallback", { status: 404 }),
    });
  }

  const N = 64;
  const bodies = await Promise.all(Array.from({ length: N }, () => fetch(`${server.url}f`).then(r => r.text())));
  expect(bodies).toEqual(Array(N).fill(body));

  // HEAD goes through FileRoute::on with the same borrowed path.
  const headBodies = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${server.url}f`, { method: "HEAD" }).then(async r => ({
        status: r.status,
        len: r.headers.get("content-length"),
        body: await r.text(),
      })),
    ),
  );
  expect(headBodies).toEqual(Array(N).fill({ status: 200, len: String(body.length), body: "" }));

  const a = await fetch(`${server.url}a`).then(r => r.text());
  expect(a).toBe("a-new");
});

// RFC 9110 §9.3.8: a TRACE response carries content. Announcing Content-Length
// and then sending zero bytes desyncs the connection. Read the wire directly so
// the assertion does not depend on Bun's own HTTP client.
test("TRACE response backed by Bun.file sends the body", async () => {
  using dir = tempDir("bun-serve-file-trace", { "hello.txt": "Hello, World!" });

  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response(Bun.file(join(String(dir), "hello.txt"))),
  });

  const wire = (method: string) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = connect(server.port, "127.0.0.1", () => {
        socket.write(`${method} / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      socket.on("data", chunk => chunks.push(chunk));
      socket.on("error", reject);
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
    });

  const [trace, head] = await Promise.all([wire("TRACE"), wire("HEAD")]);

  expect(trace).toMatch(/^content-length: 13\r$/im);
  expect(trace).toEndWith("\r\n\r\nHello, World!");

  // HEAD is the one method still terminated at the end of the header section.
  expect(head).toMatch(/^content-length: 13\r$/im);
  expect(head).toEndWith("\r\n\r\n");
});
