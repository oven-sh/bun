import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, rmScope, rss, tempDir, tempDirWithFiles, tls } from "harness";
import { mkfifo } from "mkfifo";
import {
  closeSync,
  constants,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";

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
const ifRangeValidators = { "ETag": '"v1"', "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT" };

// toBe() elides the middle of multi-megabyte strings, so report the first character that differs.
function expectSameText(actual: string, expected: string) {
  expect(actual.length).toBe(expected.length);
  if (actual === expected) return;
  let at = 0;
  while (actual[at] === expected[at]) at++;
  const around = (text: string) => `index ${at}: ${text.slice(Math.max(0, at - 10), at + 10)}`;
  expect(around(actual)).toBe(around(expected));
}

describe("Bun.file in serve routes", () => {
  let server: Server<undefined>;
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

    const partialSlice = () => Bun.file(join(tempDir, "partial.txt")).slice(5, 10);
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
      "/slice-handler": () => new Response(partialSlice()),
      "/slice-handler-headers": () => new Response(partialSlice(), { headers: { "X-Custom": "1" } }),
      "/slice-handler-headers-read": () => {
        const res = new Response(partialSlice());
        res.headers.get("X-Custom");
        return res;
      },
      "/slice-handler-body-read": () => {
        const res = new Response(partialSlice());
        res.body;
        return res;
      },
      "/slice-handler-body-and-headers-read": () => {
        const res = new Response(partialSlice());
        res.body;
        res.headers.get("X-Custom");
        return res;
      },
      "/slice-handler-copy": () => {
        const res = new Response(partialSlice());
        return new Response(res.body, res);
      },
      "/slice-handler-copy-clone": () => {
        const res = new Response(partialSlice());
        return new Response(res.body, res).clone() as Response;
      },
      "/slice-handler-request-copy": () => {
        const req = new Request("http://example.com/", { method: "POST", body: partialSlice() });
        return new Response(req.body, req);
      },
      "/slice-handler-request-copy-headers-read": () => {
        const req = new Request("http://example.com/", { method: "POST", body: partialSlice() });
        req.headers.get("X-Custom");
        return new Response(req.body, req);
      },
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
      // If-Range tests: the same validators on a file route and on a handler response.
      "/if-range-route": new Response(Bun.file(join(tempDir, "partial.txt")), { headers: ifRangeValidators }),
      "/if-range-handler": () => new Response(Bun.file(join(tempDir, "partial.txt")), { headers: ifRangeValidators }),
      // Responds after the request callback returned, when the server no longer has the request's header buffer.
      "/if-range-async-handler": async () => {
        const file = Bun.file(join(tempDir, "partial.txt"));
        await file.exists();
        return new Response(file, { headers: ifRangeValidators });
      },
      "/if-range-weak-route": new Response(Bun.file(join(tempDir, "partial.txt")), { headers: { ETag: 'W/"v1"' } }),
      "/if-range-weak-handler": () =>
        new Response(Bun.file(join(tempDir, "partial.txt")), { headers: { ETag: 'W/"v1"' } }),
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
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("serves large file", async () => {
      const res = await fetch(new URL(`/large.txt`, server.url));
      expect(res.status).toBe(200);
      expectSameText(await res.text(), files["large.txt"]);

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
      expect(res.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
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
      expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
    });

    it("supports GET requests", async () => {
      const res = await fetch(new URL(`/hello.txt`, server.url), { method: "GET" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Hello, World!");
    });

    it("HEAD of a file from the fetch handler sends GET's headers and no body", async () => {
      using handlerServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(Bun.file(join(tempDir, "partial.txt"))),
      });

      // A raw socket shows any body bytes after the head.
      const { promise: closed, resolve, reject } = Promise.withResolvers<void>();
      let wire = "";
      await Bun.connect({
        hostname: "127.0.0.1",
        port: handlerServer.port,
        socket: {
          open: socket => void socket.write("HEAD / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"),
          data: (_, chunk) => void (wire += chunk.toString("latin1")),
          close: () => resolve(),
          error: (_, err) => reject(err),
        },
      });
      await closed;
      const [head, ...afterHead] = wire.split("\r\n\r\n");
      const lines = head.toLowerCase().split("\r\n");

      const ranged = await fetch(handlerServer.url, { method: "HEAD", headers: { Range: "bytes=2-5" } });
      const unsatisfiable = await fetch(handlerServer.url, { method: "HEAD", headers: { Range: "bytes=99-" } });

      expect({
        status: lines[0],
        contentType: lines.filter(line => line.startsWith("content-type:")),
        contentLength: lines.filter(line => line.startsWith("content-length:")),
        afterHead,
        ranged: {
          status: ranged.status,
          contentLength: ranged.headers.get("Content-Length"),
          contentRange: ranged.headers.get("Content-Range"),
        },
        unsatisfiable: { status: unsatisfiable.status, contentRange: unsatisfiable.headers.get("Content-Range") },
      }).toEqual({
        status: "http/1.1 200 ok",
        contentType: ["content-type: text/plain;charset=utf-8"],
        contentLength: ["content-length: 16"],
        afterHead: [""],
        ranged: { status: 206, contentLength: "4", contentRange: "bytes 2-5/16" },
        unsatisfiable: { status: 416, contentRange: "bytes */16" },
      });
    });

    it("sends the slice's length as Content-Length for a slice of an fd-backed file", async () => {
      const fd = openSync(join(tempDir, "partial.txt"), "r");
      try {
        using handlerServer = Bun.serve({
          port: 0,
          fetch: () => new Response(Bun.file(fd).slice(5, 10)),
        });
        const probe = async (method: string) => {
          const res = await fetch(handlerServer.url, { method });
          return { status: res.status, contentLength: res.headers.get("Content-Length"), body: await res.text() };
        };
        expect(await probe("HEAD")).toEqual({ status: 200, contentLength: "5", body: "" });
        expect(await probe("GET")).toEqual({ status: 200, contentLength: "5", body: "56789" });
      } finally {
        closeSync(fd);
      }
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

    it("sends a disposition type with the automatic Content-Disposition filename", async () => {
      using handlerServer = Bun.serve({
        port: 0,
        fetch: req => new Response(Bun.file(join(tempDir, new URL(req.url).pathname))),
      });
      const seen: Record<string, string | null> = {};
      for (const name of ["binary.bin", "hello.txt"]) {
        const res = await fetch(new URL(name, handlerServer.url));
        await res.arrayBuffer();
        seen[name] = res.headers.get("Content-Disposition");
      }
      expect(seen).toEqual({ "binary.bin": 'inline; filename="binary.bin"', "hello.txt": null });
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
        expect(res.headers.get("Content-Length")).toBe("13");
        expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
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
      // `/hello.txt` only accepts GET and HEAD, so a POST would hit the fallback handler.
      // `/hello-blob.txt` accepts every method.
      const res1 = await fetch(new URL(`/hello-blob.txt`, server.url));
      const lastModified = res1.headers.get("Last-Modified");
      expect(lastModified).not.toBeEmpty();
      const ifModifiedSince = new Date(Date.parse(lastModified!) + 10000).toISOString();

      const get = await fetch(new URL(`/hello-blob.txt`, server.url), {
        headers: { "If-Modified-Since": ifModifiedSince },
      });
      expect(get.status).toBe(304);
      expect(await get.text()).toBe("");

      const post = await fetch(new URL(`/hello-blob.txt`, server.url), {
        method: "POST",
        headers: { "If-Modified-Since": ifModifiedSince },
      });
      expect(post.status).toBe(200);
      expect(await post.text()).toBe("Hello, World!");
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
          expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
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
    // fetch() never reads a HEAD body, so the "" expected for HEAD can't catch body bytes on the wire.
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
        expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
      });

      it("If-Match: * on a file route without a stored ETag → 200", async () => {
        const res = await fetch(new URL(`/hello-blob.txt`, server.url), {
          method,
          headers: { "If-Match": "*" },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
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
        expect(await res.text()).toBe("");
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
        expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
      });

      it("If-Match failure + If-None-Match match → 412 (not 304)", async () => {
        const res = await fetch(new URL(`/with-etag.txt`, server.url), {
          method,
          headers: { "If-Match": '"zz"', "If-None-Match": '"custom-etag"' },
        });
        expect(res.status).toBe(412);
        expect(await res.text()).toBe("");
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
        expect(await res.text()).toBe(method === "GET" ? "Hello, World!" : "");
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
    test.each(["hello.txt", "large.txt"] as const)(
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

          for (const result of await Promise.all(promises)) {
            expectSameText(result, files[filename]);
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

    it("a handler's slice is a 206 with Content-Range until the handler passes or reads headers", async () => {
      const serve = async (pathname: string) => {
        const res = await fetch(new URL(pathname, server.url));
        return { status: res.status, contentRange: res.headers.get("Content-Range"), body: await res.text() };
      };
      const partial = { status: 206, contentRange: "bytes 5-9/*", body: "56789" };
      const whole = { status: 200, contentRange: null, body: "56789" };
      expect({
        "no headers": await serve("/slice-handler"),
        "body read": await serve("/slice-handler-body-read"),
        "copy": await serve("/slice-handler-copy"),
        "clone of a copy": await serve("/slice-handler-copy-clone"),
        "copy of a Request": await serve("/slice-handler-request-copy"),
        "headers": await serve("/slice-handler-headers"),
        "headers read": await serve("/slice-handler-headers-read"),
        "body and headers read": await serve("/slice-handler-body-and-headers-read"),
        "copy of a Request, headers read": await serve("/slice-handler-request-copy-headers-read"),
      }).toEqual({
        "no headers": partial,
        "body read": partial,
        "copy": partial,
        "clone of a copy": partial,
        "copy of a Request": partial,
        "headers": whole,
        "headers read": whole,
        "body and headers read": whole,
        "copy of a Request, headers read": whole,
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

    it("HEAD of a missing file or a directory from the fetch handler fails like GET", async () => {
      const fetchFile = (req: Request) =>
        new Response(Bun.file(new URL(req.url).pathname === "/dir" ? tempDir : join(tempDir, "nope.html")));
      using withoutError = Bun.serve({ port: 0, fetch: fetchFile });
      using withError = Bun.serve({
        port: 0,
        fetch: fetchFile,
        error: e => new Response(new Blob([`err ${e.code}`], { type: "text/x-error" }), { status: 500 }),
      });
      const probe = async (server: Server<undefined>, pathname: string, method: string) => {
        const res = await fetch(new URL(pathname, server.url), { method });
        return [res.status, res.headers.get("Content-Length"), res.headers.get("Content-Type"), await res.text()];
      };
      const results: Record<string, unknown> = {};
      for (const method of ["GET", "HEAD"]) {
        for (const pathname of ["/missing", "/dir"]) {
          results[`${method} ${pathname}`] = [
            await probe(withoutError, pathname, method),
            await probe(withError, pathname, method),
          ];
        }
      }
      expect(results).toEqual({
        "GET /missing": [
          [404, "0", null, ""],
          [500, "10", "text/x-error", "err ENOENT"],
        ],
        "GET /dir": [
          [404, "0", null, ""],
          [500, "10", "text/x-error", "err EISDIR"],
        ],
        "HEAD /missing": [
          [404, "0", null, ""],
          [500, "10", "text/x-error", ""],
        ],
        "HEAD /dir": [
          [404, "0", null, ""],
          [500, "10", "text/x-error", ""],
        ],
      });
    });

    it("error()'s Response doesn't get the failed file's Content-Type or filename", async () => {
      const replies = {
        stream: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("streamed"));
                controller.close();
              },
            }),
            { status: 500 },
          ),
        bodiless: () => new Response(null, { status: 404 }),
      };
      const probe = async (server: Server<undefined>, pathname: string, method: string) => {
        const res = await fetch(new URL(pathname, server.url), { method });
        await res.text();
        return [res.status, res.headers.get("Content-Type"), res.headers.get("Content-Disposition")];
      };
      for (const [name, reply] of Object.entries(replies)) {
        using afterFailedFile = Bun.serve({
          port: 0,
          fetch: req =>
            new Response(Bun.file(new URL(req.url).pathname === "/dir" ? tempDir : join(tempDir, "nope.html"))),
          error: reply,
        });
        const expected = [name === "stream" ? 500 : 404, null, null];
        for (const method of ["GET", "HEAD"]) {
          expect({
            name,
            method,
            missing: await probe(afterFailedFile, "/missing", method),
            dir: await probe(afterFailedFile, "/dir", method),
          }).toEqual({ name, method, missing: expected, dir: expected });
        }
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
      expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
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

      const error = await promise.then(
        () => null,
        e => e,
      );
      expect(error).toBeInstanceOf(DOMException);
      expect(error.name).toBe("AbortError");
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
      expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
    });

    it("detects application/json for .json files", async () => {
      const res = await fetch(new URL(`/json.json`, server.url));
      expect(res.headers.get("Content-Type")).toBe("application/json;charset=utf-8");
    });

    it("detects application/octet-stream for binary files", async () => {
      const res = await fetch(new URL(`/binary.bin`, server.url));
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
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
      expect({
        status: res.status,
        contentRange: res.headers.get("content-range"),
        body: await res.text(),
      }).toEqual({ status: 200, contentRange: null, body });
    });
  });

  // RFC 9110 §13.1.5: If-Range carries the validator of the partial copy the
  // client already has. Only a match may get a 206. Anything else means that
  // copy is of another version, so the server ignores Range and sends the
  // full 200 body.
  describe.concurrent.each([
    ["FileRoute", "/if-range-route", "/if-range-weak-route"],
    ["fetch handler", "/if-range-handler", "/if-range-weak-handler"],
    ["async fetch handler", "/if-range-async-handler", "/if-range-weak-handler"],
  ])("If-Range via %s", (_label, path, weakPath) => {
    const partial = { status: 206, contentRange: "bytes 4-7/16", body: "4567" };
    const full = { status: 200, contentRange: null, body: files["partial.txt"] };

    async function get(path: string, headers: Record<string, string>) {
      const res = await fetch(new URL(path, server.url), { headers });
      return { status: res.status, contentRange: res.headers.get("content-range"), body: await res.text() };
    }

    it.each([
      ["the ETag", '"v1"', partial],
      ["another ETag", '"v2"', full],
      ["the ETag as a weak tag", 'W/"v1"', full],
      ["the Last-Modified date", "Wed, 21 Oct 2015 07:28:00 GMT", partial],
      ["the Last-Modified date in the rfc850 form", "Wednesday, 21-Oct-15 07:28:00 GMT", partial],
      ["a date after Last-Modified", "Wed, 21 Oct 2015 07:28:01 GMT", full],
      ["a date before Last-Modified", "Wed, 21 Oct 2015 07:27:59 GMT", full],
      // No zone: the parse would depend on the server's time zone, so it never matches.
      ["the Last-Modified date in the asctime form", "Wed Oct 21 07:28:00 2015", full],
      ["the Last-Modified date with no zone", "Wed, 21 Oct 2015 07:28:00", full],
      ["neither an entity-tag nor a date", "v1", full],
    ])("If-Range is %s", async (_name, ifRange, expected) => {
      expect(await get(path, { "Range": "bytes=4-7", "If-Range": ifRange })).toEqual(expected);
    });

    it("a weak ETag on the response never matches", async () => {
      expect(await get(weakPath, { "Range": "bytes=4-7", "If-Range": 'W/"v1"' })).toEqual(full);
      expect(await get(weakPath, { "Range": "bytes=4-7", "If-Range": '"v1"' })).toEqual(full);
    });

    it("a failed If-Range also turns off 416", async () => {
      expect(await get(path, { "Range": "bytes=100-200", "If-Range": '"v2"' })).toEqual(full);
      expect(await get(path, { "Range": "bytes=100-200", "If-Range": '"v1"' })).toEqual({
        status: 416,
        contentRange: "bytes */16",
        body: "",
      });
    });

    it("If-Range without Range changes nothing", async () => {
      expect(await get(path, { "If-Range": '"v2"' })).toEqual(full);
    });
  });

  describe.concurrent("If-Range edge cases", () => {
    it("HEAD on a FileRoute mirrors GET", async () => {
      const head = async (ifRange: string) => {
        const res = await fetch(new URL("/if-range-route", server.url), {
          method: "HEAD",
          headers: { "Range": "bytes=4-7", "If-Range": ifRange },
        });
        return {
          status: res.status,
          contentRange: res.headers.get("content-range"),
          contentLength: res.headers.get("content-length"),
        };
      };
      expect(await head('"v1"')).toEqual({ status: 206, contentRange: "bytes 4-7/16", contentLength: "4" });
      expect(await head('"v2"')).toEqual({ status: 200, contentRange: null, contentLength: "16" });
    });

    it("FileRoute compares a date with the Last-Modified it sends", async () => {
      const url = new URL("/partial.txt", server.url);
      const lastModified = (await fetch(url)).headers.get("last-modified")!;
      expect(lastModified).not.toBeEmpty();

      const same = await fetch(url, { headers: { "Range": "bytes=4-7", "If-Range": lastModified } });
      expect(same.status).toBe(206);
      expect(await same.text()).toBe("4567");

      const earlier = new Date(Date.parse(lastModified) - 1000).toUTCString();
      const stale = await fetch(url, { headers: { "Range": "bytes=4-7", "If-Range": earlier } });
      expect(stale.status).toBe(200);
      expect(await stale.text()).toBe(files["partial.txt"]);
    });

    it.each([
      ["FileRoute", "/partial.txt"],
      ["fetch handler", "/range-handler"],
    ])("an entity-tag cannot match a %s response with no ETag", async (_label, path) => {
      const res = await fetch(new URL(path, server.url), { headers: { "Range": "bytes=4-7", "If-Range": '"v1"' } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-range")).toBeNull();
      expect(await res.text()).toBe(files["partial.txt"]);
    });

    it("a date cannot match a fetch handler response with no Last-Modified", async () => {
      const res = await fetch(new URL("/range-handler", server.url), {
        headers: { "Range": "bytes=4-7", "If-Range": "Wed, 21 Oct 2015 07:28:00 GMT" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(files["partial.txt"]);
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
      expect(bytes).toEqual(Uint8Array.from({ length: 100 }, (_, i) => i));
      expect(res.headers.get("content-range")).not.toContain("/256");
    });
  });
});

// What If-Range is for: the client has part of a file, and the file changes on
// disk before the client asks for the rest. A 206 here would splice the old
// first half onto the new second half.
test.concurrent("a download resumed with If-Range after the file changed gets the new file in full", async () => {
  using dir = tempDir("serve-if-range-resume", { "asset.bin": Buffer.alloc(400, "A") });
  const assetPath = join(String(dir), "asset.bin");
  utimesSync(assetPath, new Date("2020-01-02T03:04:05Z"), new Date("2020-01-02T03:04:05Z"));

  await using server = Bun.serve({
    port: 0,
    routes: { "/asset.bin": new Response(Bun.file(assetPath)) },
  });
  const url = new URL("/asset.bin", server.url);

  const first = await fetch(url, { headers: { "Range": "bytes=0-199" } });
  const validator = first.headers.get("last-modified")!;
  expect(validator).toBe("Thu, 02 Jan 2020 03:04:05 GMT");
  expect(await first.text()).toBe(Buffer.alloc(200, "A").toString());

  const unchanged = await fetch(url, { headers: { "Range": "bytes=200-", "If-Range": validator } });
  expect(unchanged.status).toBe(206);
  expect(await unchanged.text()).toBe(Buffer.alloc(200, "A").toString());

  writeFileSync(assetPath, Buffer.alloc(400, "B"));
  utimesSync(assetPath, new Date("2021-06-07T08:09:10Z"), new Date("2021-06-07T08:09:10Z"));

  const resumed = await fetch(url, { headers: { "Range": "bytes=200-", "If-Range": validator } });
  expect({
    status: resumed.status,
    contentRange: resumed.headers.get("content-range"),
    body: await resumed.text(),
  }).toEqual({ status: 200, contentRange: null, body: Buffer.alloc(400, "B").toString() });
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
      port: server.port!,
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

// Sends one request on its own connection. `Connection: close` makes the server hang up when it's done,
// so `body` is every byte after the head, whatever Content-Length says.
function wireResponse(port: number, method: "GET" | "HEAD", path: string, { secure = false, headers = "" } = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<{
    status: number;
    head: string;
    contentRange: string | null;
    contentLength: string | null;
    body: string;
  }>();
  const address = { host: "127.0.0.1", port };
  const socket = secure ? tlsConnect({ ...address, ca: tls.cert }) : netConnect(address);
  let raw = "";
  socket.setEncoding("latin1");
  socket.on("error", reject);
  socket.on("data", chunk => (raw += chunk));
  socket.on("close", () => {
    const headEnd = raw.indexOf("\r\n\r\n");
    if (headEnd === -1) return reject(new Error(`no response head in ${JSON.stringify(raw)}`));
    const head = raw.slice(0, headEnd);
    resolve({
      status: Number(head.split(" ")[1]),
      head,
      contentRange: /^content-range:\s*(.*)$/im.exec(head)?.[1] ?? null,
      contentLength: /^content-length:\s*(\d+)/im.exec(head)?.[1] ?? null,
      body: raw.slice(headEnd + 4),
    });
  });
  socket.write(`${method} ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${headers}\r\n`);
  return promise;
}

// fetch() rejects a response whose header has a control byte, so read the header off the wire.
test("omits the automatic Content-Disposition for a file name that a quoted-string can't carry", async () => {
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: req =>
      new Response(new File(["x"], new URL(req.url).searchParams.get("name")!, { type: "application/octet-stream" })),
  });
  const sent = (basename: string) => `inline; filename="${basename}"`;
  const expected: Record<string, string | null> = {
    "plain.bin": sent("plain.bin"),
    "tab\tname.bin": sent("tab\tname.bin"),
    "!#[]~.bin": sent("!#[]~.bin"),
    "café.bin": sent("café.bin"),
    'quo"te.bin': null,
    "ctl\x01name.bin": null,
    "del\x7fname.bin": null,
    // `\` is a path separator on Windows, so it never reaches the basename.
    "report\\": isWindows ? sent("report") : null,
    "back\\slash.bin": isWindows ? sent("slash.bin") : null,
  };
  const seen: Record<string, string | null> = {};
  for (const name of Object.keys(expected)) {
    const { head } = await wireResponse(server.port!, "GET", `/?name=${encodeURIComponent(name)}`);
    const value = /^content-disposition: (.*)$/im.exec(head)?.[1];
    seen[name] = value === undefined ? null : Buffer.from(value, "latin1").toString();
  }
  expect(seen).toEqual(expected);
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

  async function wire(path: string) {
    const { contentLength, body } = await wireResponse(server.port!, "GET", path);
    return { contentLength, body };
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

test("a Bun.file() route drops Transfer-Encoding and Content-Length from the Response's headers", async () => {
  using dir = tempDir("serve-file-route-framing-headers", { "a.txt": "file-body" });
  const file = Bun.file(join(String(dir), "a.txt"));
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/transfer-encoding": new Response(file, { headers: { "Transfer-Encoding": "chunked" } }),
      "/content-length": new Response(file, { headers: { "Content-Length": "3" } }),
      "/both": new Response(file, {
        headers: { "Transfer-Encoding": "chunked", "Content-Length": "3", "X-Kept": "yes" },
      }),
    },
  });
  const framing = async (method: "GET" | "HEAD", path: string) => {
    const { head, body } = await wireResponse(server.port!, method, path);
    const headers = head
      .toLowerCase()
      .split("\r\n")
      .filter(line => /^(content-length|transfer-encoding|x-kept):/.test(line));
    return { headers: headers.sort(), body };
  };
  expect({
    transferEncoding: await framing("GET", "/transfer-encoding"),
    contentLength: await framing("GET", "/content-length"),
    both: await framing("GET", "/both"),
    head: await framing("HEAD", "/both"),
  }).toEqual({
    transferEncoding: { headers: ["content-length: 9"], body: "file-body" },
    contentLength: { headers: ["content-length: 9"], body: "file-body" },
    both: { headers: ["content-length: 9", "x-kept: yes"], body: "file-body" },
    head: { headers: ["content-length: 9", "x-kept: yes"], body: "" },
  });
});

test("a fetch handler frames a Bun.file() slice by the bytes it serves", async () => {
  using dir = tempDir("serve-handler-slice-framing", {
    "partial.txt": "0123456789ABCDEF",
    "shrinks.txt": "0123456789ABCDEF",
  });
  const path = join(String(dir), "partial.txt");

  // Stored as 11 bytes from byte 5. The file then shrinks to 11 bytes, so only 6 are left from byte 5.
  const shrinks = Bun.file(join(String(dir), "shrinks.txt"));
  expect(shrinks.size).toBe(16);
  const sliceBeforeShrink = shrinks.slice(5);
  writeFileSync(join(String(dir), "shrinks.txt"), "0123456789A");

  const fd = openSync(path, "r");
  try {
    const windows: Record<string, () => Response> = {
      "slice(5, 21)": () => new Response(Bun.file(path).slice(5, 21)),
      "slice(5, 21) with a header": () => new Response(Bun.file(path).slice(5, 21), { headers: { "X-Custom": "1" } }),
      "slice(5, 21).stream()": () => new Response(Bun.file(path).slice(5, 21).stream()),
      "slice(16, 32)": () => new Response(Bun.file(path).slice(16, 32)),
      "slice(5, 20)": () => new Response(Bun.file(path).slice(5, 20)),
      "slice(0, 16)": () => new Response(Bun.file(path).slice(0, 16)),
      "slice(5) of a file that shrank": () => new Response(sliceBeforeShrink),
      "fd slice(5, 21)": () => new Response(Bun.file(fd).slice(5, 21)),
    };
    const names = Object.keys(windows);
    const handler = (req: Request) => windows[names[Number(new URL(req.url).pathname.slice(1))]]();
    await using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    await using secureServer = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: handler });

    const framing: Record<string, unknown> = {};
    const statuses: Record<string, unknown> = {};
    for (const [i, name] of names.entries()) {
      const get = await wireResponse(server.port!, "GET", `/${i}`);
      const secure = await wireResponse(secureServer.port!, "GET", `/${i}`, { secure: true });
      const head = await wireResponse(server.port!, "HEAD", `/${i}`);
      framing[name] = {
        get: { contentLength: get.contentLength, body: get.body },
        secure: { contentLength: secure.contentLength, body: secure.body },
        head: { contentLength: head.contentLength, body: head.body },
      };
      statuses[name] = [get, secure, head].map(({ status, contentRange }) => `${status} ${contentRange}`);
    }
    const exactly = (body: string) => ({
      get: { contentLength: String(body.length), body },
      secure: { contentLength: String(body.length), body },
      head: { contentLength: String(body.length), body: "" },
    });
    expect(framing).toEqual({
      "slice(5, 21)": exactly("56789ABCDEF"),
      "slice(5, 21) with a header": exactly("56789ABCDEF"),
      "slice(5, 21).stream()": exactly("56789ABCDEF"),
      "slice(16, 32)": exactly(""),
      "slice(5, 20)": exactly("56789ABCDEF"),
      "slice(0, 16)": exactly("0123456789ABCDEF"),
      "slice(5) of a file that shrank": exactly("56789A"),
      "fd slice(5, 21)": exactly("56789ABCDEF"),
    });
    const all = <T>(status: T) => [status, status, status];
    expect(statuses).toEqual({
      "slice(5, 21)": all("206 bytes 5-15/*"),
      "slice(5, 21) with a header": all("200 null"),
      "slice(5, 21).stream()": all("206 bytes 5-15/*"),
      "slice(16, 32)": all(expect.stringMatching(/^206 /)),
      "slice(5, 20)": all("206 bytes 5-15/*"),
      "slice(0, 16)": all("200 null"),
      "slice(5) of a file that shrank": all("206 bytes 5-10/*"),
      "fd slice(5, 21)": all("200 null"),
    });
  } finally {
    closeSync(fd);
  }
});

test("reads a Bun.file(fd) body at its offset, not at the descriptor's position", async () => {
  using dir = tempDir("serve-fd-position", { "partial.txt": "0123456789ABCDEF" });
  const fd = openSync(join(String(dir), "partial.txt"), "r");
  try {
    const readAtPosition = (length: number) => {
      const buffer = Buffer.alloc(length);
      return buffer.toString("latin1", 0, readSync(fd, buffer, 0, length, null));
    };
    expect(readAtPosition(3)).toBe("012");

    const handler = (req: Request) =>
      new Response(req.url.endsWith("/slice") ? Bun.file(fd).slice(0, 4) : Bun.file(fd));
    await using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    await using secureServer = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: handler });
    const get = async (port: number, path: string, options?: { secure?: boolean; headers?: string }) => {
      const { status, contentLength, body } = await wireResponse(port, "GET", path, options);
      return `${status} ${contentLength} ${body}`;
    };
    expect({
      whole: await get(server.port!, "/"),
      again: await get(server.port!, "/"),
      secure: await get(secureServer.port!, "/", { secure: true }),
      slice: await get(server.port!, "/slice"),
      range: await get(server.port!, "/", { headers: "Range: bytes=0-3\r\n" }),
      nextByteAtPosition: readAtPosition(1),
    }).toEqual({
      whole: "200 16 0123456789ABCDEF",
      again: "200 16 0123456789ABCDEF",
      secure: "200 16 0123456789ABCDEF",
      slice: "200 4 0123",
      range: "206 4 0123",
      nextByteAtPosition: "3",
    });
  } finally {
    closeSync(fd);
  }
});

// kqueue doesn't wake a FIFO reader when an empty pipe's last writer closes.
test.skipIf(!isLinux)("Response(Bun.file(fifo)) ends the body when the EOF arrives after the data", async () => {
  using dir = tempDir("serve-fifo-eof", {});
  const fifo = join(String(dir), "body.fifo");
  mkfifo(fifo);
  // Open for read and write so that neither the open nor the write blocks until the server opens the FIFO.
  const writer = openSync(fifo, "r+");
  writeSync(writer, "hello");
  await using server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(fifo)) });

  const response = await fetch(server.url);
  const reader = response.body!.getReader();
  const first = await reader.read();
  closeSync(writer);
  const last = await reader.read();
  expect({ first: Buffer.from(first.value!).toString(), done: last.done }).toEqual({ first: "hello", done: true });
});

describe.concurrent("Bun.file() body that ends short of its Content-Length", () => {
  // Resolves once the server closes the connection. `onBody` runs on the first body bytes.
  function getUntilClosed(server: Server<undefined>, secure: boolean, pathname: string, onBody = () => {}) {
    const { promise, resolve, reject } = Promise.withResolvers<{ head: string; bodyLength: number; body: string }>();
    const address = { host: "127.0.0.1", port: server.port! };
    const socket = secure ? tlsConnect({ ...address, ca: tls.cert }) : netConnect(address);
    let received = "";
    let head = "";
    let bodyLength = 0;
    let body = "";
    socket.on("error", reject);
    socket.on("close", () => resolve({ head, bodyLength, body }));
    socket.on("data", chunk => {
      if (!head) {
        received += chunk.toString("latin1");
        const headEnd = received.indexOf("\r\n\r\n");
        if (headEnd < 0) return;
        head = received.slice(0, headEnd).toLowerCase();
        chunk = Buffer.from(received.slice(headEnd + 4), "latin1");
      }
      if (chunk.length === 0) return;
      if (bodyLength === 0) onBody();
      bodyLength += chunk.length;
      if (body.length < 64) body += chunk.toString("latin1", 0, 64);
    });
    socket.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\n\r\n`);
    return promise;
  }

  // Sparse, and far bigger than the loopback socket buffers, so the server can't send it all before it shrinks.
  const SIZE = 256 * 1024 * 1024;

  test.each([
    ["fetch handler", "/big.bin", false],
    ["fetch handler", "/big.bin", true],
    ["file route", "/route", false],
    ["directory route", "/dir/big.bin", true],
  ] as const)("closes the connection when the file shrinks mid-body (%s %s, tls: %p)", async (_, pathname, secure) => {
    using dir = tempDir("serve-file-shrinks", { "big.bin": "" });
    const path = join(String(dir), "big.bin");
    truncateSync(path, SIZE);
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      tls: secure ? tls : undefined,
      routes: { "/route": new Response(Bun.file(path)), "/dir/*": { dir: String(dir) } },
      fetch: () => new Response(Bun.file(path)),
    });
    let pendingWhenShrunk = -1;
    const { head, bodyLength } = await getUntilClosed(server, secure, pathname, () => {
      pendingWhenShrunk = server.pendingRequests;
      truncateSync(path, 4096);
    });
    expect({ pendingWhenShrunk, contentLength: /^content-length: (\d+)$/m.exec(head)?.[1] }).toEqual({
      pendingWhenShrunk: 1,
      contentLength: String(SIZE),
    });
    expect(bodyLength).toBeLessThan(SIZE);
  });

  test.each([false, true])("keeps the connection open after a complete body (tls: %p)", async secure => {
    using dir = tempDir("serve-file-complete", {
      "small.bin": Buffer.alloc(1000, "a"),
      "large.bin": Buffer.alloc(2 * 1024 * 1024, "b"),
    });
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: secure ? tls : undefined,
      fetch: req => new Response(Bun.file(join(String(dir), new URL(req.url).pathname))),
    });
    const address = { host: "127.0.0.1", port: server.port! };
    const socket = secure ? tlsConnect({ ...address, ca: tls.cert }) : netConnect(address);
    try {
      const chunks: Buffer[] = [];
      let closed = false;
      let wake = Promise.withResolvers<void>();
      socket.on("error", error => wake.reject(error));
      socket.on("close", () => ((closed = true), wake.resolve()));
      socket.on("data", chunk => (chunks.push(chunk), wake.resolve()));
      const get = async (pathname: string) => {
        socket.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\n\r\n`);
        let received = Buffer.alloc(0);
        while (true) {
          received = Buffer.concat([received, ...chunks.splice(0)]);
          const headEnd = received.indexOf("\r\n\r\n");
          if (headEnd >= 0) {
            const head = received.toString("latin1", 0, headEnd).toLowerCase();
            const contentLength = Number(/^content-length: (\d+)$/m.exec(head)?.[1]);
            if (received.length >= headEnd + 4 + contentLength)
              return { contentLength, bodyLength: received.length - headEnd - 4, close: head.includes("connection:") };
          }
          if (closed) throw new Error(`the server closed the connection during ${pathname}`);
          await wake.promise;
          wake = Promise.withResolvers();
        }
      };
      const complete = (length: number) => ({ contentLength: length, bodyLength: length, close: false });
      expect([await get("/small.bin"), await get("/large.bin"), await get("/small.bin")]).toEqual([
        complete(1000),
        complete(2 * 1024 * 1024),
        complete(1000),
      ]);
    } finally {
      socket.destroy();
    }
  });

  // fstat() reports a whole page for a sysfs attribute, and read() returns a few bytes.
  test.skipIf(!isLinux)("sends a file whose stat size overstates it, then closes the connection", async () => {
    const attribute = "/sys/devices/system/cpu/online";
    const content = readFileSync(attribute, "latin1");
    const { size } = statSync(attribute);
    expect(size).toBeGreaterThan(content.length);
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      fetch: () => new Response(Bun.file(attribute)),
    });
    const { head, body } = await getUntilClosed(server, false, "/");
    expect({ headers: head.split("\r\n").filter(line => /^(content-length|connection):/.test(line)), body }).toEqual({
      headers: [`content-length: ${size}`, "connection: close"],
      body: content,
    });
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
  expect(stderr).toBe("");
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

// https://github.com/oven-sh/bun/issues/4292
test.concurrent.each([true, false])(
  "Response(Bun.file()) that can't be opened responds 404 or 403 (development: %p)",
  async development => {
    using dir = tempDir("serve-file-open-error", { "ok.txt": "ok", "noperm.txt": "secret", "sub/.keep": "" });
    const paths = ["/ok.txt", "/missing.txt", "/ok.txt/child"];
    // open() on a directory fails with a different errno on Windows.
    if (!isWindows) paths.push("/sub");
    // Root and Windows ignore the mode bits.
    const canDeny = !isWindows && process.getuid!() !== 0;
    if (canDeny) paths.push("/noperm.txt");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:fs").chmodSync("noperm.txt", 0);
        const fetchFile = req => new Response(Bun.file("." + new URL(req.url).pathname));
        const codes = [];
        const servers = {
          none: Bun.serve({ port: 0, development: ${development}, fetch: fetchFile }),
          undefined: Bun.serve({ port: 0, development: ${development}, fetch: fetchFile, error: e => void codes.push(e.code) }),
          response: Bun.serve({ port: 0, development: ${development}, fetch: fetchFile, error: e => new Response(e.code, { status: 410 }) }),
        };
        for (const [name, server] of Object.entries(servers)) {
          for (const path of ${JSON.stringify(paths)}) {
            const res = await fetch(new URL(path, server.url));
            console.log(name, path, res.status, res.statusText, res.headers.get("content-length"), await res.text());
          }
          server.stop(true);
        }
        console.log(codes.join());
      `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const defaults = (name: string) => [
      `${name} /ok.txt 200 OK 2 ok`,
      `${name} /missing.txt 404 Not Found 0 `,
      `${name} /ok.txt/child 404 Not Found 0 `,
      ...(isWindows ? [] : [`${name} /sub 404 Not Found 0 `]),
      ...(canDeny ? [`${name} /noperm.txt 403 Forbidden 0 `] : []),
    ];
    const codes = ["ENOENT", "ENOTDIR", ...(isWindows ? [] : ["EISDIR"]), ...(canDeny ? ["EACCES"] : [])];
    expect({ stdout: stdout.split("\n"), stderr }).toEqual({
      stdout: [
        ...defaults("none"),
        ...defaults("undefined"),
        "response /ok.txt 200 OK 2 ok",
        ...codes.map((code, i) => `response ${paths[i + 1]} 410 Gone ${code.length} ${code}`),
        codes.join(),
        "",
      ],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.each([
  ["throws", `() => { throw new Error("boom") }`, "boom"],
  ["rejects", `() => Promise.reject(new Error("boom"))`, "boom"],
  ["returns another missing file", `() => new Response(Bun.file("./404.html"))`, "404.html"],
])("Response(Bun.file(missing)) responds 500 when error() %s", async (_, error, reported) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      using server = Bun.serve({
        port: 0,
        development: false,
        fetch: () => new Response(Bun.file("./missing.txt")),
        error: ${error},
      });
      console.log((await fetch(server.url)).status);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("500\n");
  expect(stderr).toContain(reported);
  expect(exitCode).toBe(1);
});

// Installs a seccomp filter that fails sendfile(2) with SENDFILE_ERRNO, except for a call that asks for SENDFILE_ALLOW_COUNT bytes.
const sendfileRefusedFixture = `
const { dlopen, ptr } = require("bun:ffi");
const { SENDFILE_ERRNO, SENDFILE_ALLOW_COUNT, FILE } = process.env;
let prctl;
for (const name of ["libc.so.6", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1"]) {
  try {
    prctl = dlopen(name, { prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" } }).symbols.prctl;
    break;
  } catch {}
}
const LD_W_ABS = 0x20, JEQ_K = 0x15, RET_K = 0x06, RET_ALLOW = 0x7fff0000, RET_ERRNO = 0x00050000;
const instructions = [
  [LD_W_ABS, 0, 0, 0], // seccomp_data.nr
  [JEQ_K, 0, 3, process.arch === "x64" ? 40 : 71], // __NR_sendfile
  [LD_W_ABS, 0, 0, 40], // low half of seccomp_data.args[3], the count
  [JEQ_K, 1, 0, Number(SENDFILE_ALLOW_COUNT)],
  [RET_K, 0, 0, RET_ERRNO | Number(SENDFILE_ERRNO)],
  [RET_K, 0, 0, RET_ALLOW],
];
const filter = new DataView(new ArrayBuffer(instructions.length * 8));
instructions.forEach(([code, jt, jf, k], i) => {
  filter.setUint16(i * 8, code, true);
  filter.setUint8(i * 8 + 2, jt);
  filter.setUint8(i * 8 + 3, jf);
  filter.setUint32(i * 8 + 4, k, true);
});
const program = new DataView(new ArrayBuffer(16));
program.setUint16(0, instructions.length, true);
program.setBigUint64(8, BigInt(ptr(filter)), true);
const PR_SET_NO_NEW_PRIVS = 38, PR_SET_SECCOMP = 22, SECCOMP_MODE_FILTER = 2n;
if (!prctl || prctl(PR_SET_NO_NEW_PRIVS, 1n, 0n, 0n, 0n) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, BigInt(ptr(program)), 0n, 0n))
  process.exit(3);
if (!FILE) process.exit(0);

using server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: req => (req.url.endsWith("/probe") ? new Response("ok") : new Response(Bun.file(FILE))),
});
const { promise, resolve, reject } = Promise.withResolvers();
const chunks = [];
const client = require("node:net").connect(server.port, "127.0.0.1");
client.pause();
client.on("data", chunk => chunks.push(chunk));
client.on("close", resolve);
client.on("error", reject);
client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
// The server handles this request after the one above, so its first sendfile(2) call has returned.
await (await fetch(new URL("/probe", server.url))).text();
client.resume();
await promise;
const wire = Buffer.concat(chunks);
const headEnd = wire.indexOf("\\r\\n\\r\\n");
const body = wire.subarray(headEnd + 4);
console.log(JSON.stringify({
  status: wire.toString("latin1", 0, wire.indexOf("\\r\\n")),
  contentLength: /^content-length: (\\d+)$/im.exec(wire.toString("latin1", 0, headEnd))?.[1],
  bodyLength: body.length,
  bodyMatches: body.equals(require("node:fs").readFileSync(FILE)),
}));
`;

const canFilterSyscalls =
  isLinux &&
  (await Bun.spawn({
    cmd: [bunExe(), "-e", sendfileRefusedFixture],
    env: { ...bunEnv, SENDFILE_ERRNO: "22", SENDFILE_ALLOW_COUNT: "0" },
    stdio: ["ignore", "ignore", "ignore"],
  }).exited) === 0;

describe.skipIf(!canFilterSyscalls)("falls back to read() and write() when sendfile(2) is refused", () => {
  test.concurrent.each([
    ["with EINVAL", 22, 2 * 1024 * 1024, false],
    ["with ENOSYS", 38, 2 * 1024 * 1024, false],
    ["with EOPNOTSUPP", 95, 2 * 1024 * 1024, false],
    ["with EPERM", 1, 2 * 1024 * 1024, false],
    // Bigger than the loopback socket buffers, so the first call can't send the whole file to the paused client.
    ["after the first call sent part of the file", 22, 16 * 1024 * 1024, true],
  ])("%s", async (_, errno, size, allowFirstCall) => {
    const content = Buffer.alloc(size);
    for (let i = 0; i < size; i += 4096) content.writeUInt32LE(i, i);
    using dir = tempDir("serve-sendfile-refused", { "large.bin": content });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", sendfileRefusedFixture],
      env: {
        ...bunEnv,
        FILE: join(String(dir), "large.bin"),
        SENDFILE_ERRNO: String(errno),
        SENDFILE_ALLOW_COUNT: String(allowFirstCall ? size : 0),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      status: "HTTP/1.1 200 OK",
      contentLength: String(size),
      bodyLength: size,
      bodyMatches: true,
    });
    expect(exitCode).toBe(0);
  });
});

// Linux file responses >= 1MB go through sendfile(2), which writes straight to
// the socket fd. When the response header block only partially reaches the
// kernel (its tail parked in the userspace socket buffer), the first sendfile
// round must wait for that tail to flush; otherwise file bytes overtake it and
// the client sees file bytes interleaved before the end of the headers. The
// big x-pad header is far larger than the kernel send buffer, so every header
// write is partial. The separate client processes supply the concurrent reads
// that open kernel buffer space between the header write and the sendfile call.
test.skipIf(!isLinux)(
  "sendfile does not overtake a buffered response header tail",
  async () => {
    const FILE_SIZE = 4 * 1024 * 1024;
    const PAD_SIZE = 16 * 1024 * 1024;
    // The race hinges on scheduler placement of the reader relative to the
    // server thread, which is sticky per process; fresh client processes re-roll
    // it, so several short-lived clients catch what one long-lived client can
    // miss.
    const ITERATIONS_PER_CLIENT = 8;
    const CLIENTS_PER_WAVE = 3;
    const WAVES = 3;

    using dir = tempDir("serve-sendfile-tail", {
      "client-fixture.ts": `
      // One GET per fresh connection, read with plain blocking recv(2) via
      // FFI. SO_RCVBUF pins the receive window far below the header block, so
      // the server's header write always stalls with most of the block parked
      // in userspace. Each recv() of a full window sends a window-update ACK,
      // which opens kernel send-buffer space. On many connections one of them
      // lands between the partial header write and the first sendfile call.
      // The file is all 0xEE and the header block is ASCII, so any 0xEE before
      // the header terminator means sendfile bytes jumped ahead of the tail.
      import { dlopen, ptr } from "bun:ffi";

      const port = Number(process.env.PORT);
      const padSize = Number(process.env.PAD_SIZE);
      const fileSize = Number(process.env.FILE_SIZE);
      const iterations = Number(process.env.ITERATIONS);

      const spec = {
        socket: { args: ["i32", "i32", "i32"], returns: "i32" },
        connect: { args: ["i32", "ptr", "u32"], returns: "i32" },
        send: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
        recv: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
        setsockopt: { args: ["i32", "i32", "i32", "ptr", "u32"], returns: "i32" },
        close: { args: ["i32"], returns: "i32" },
      } as const;
      function openLibc() {
        for (const name of ["libc.so.6", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1"]) {
          try {
            return dlopen(name, spec).symbols;
          } catch {}
        }
        throw new Error("could not dlopen libc");
      }
      const libc = openLibc();

      // struct sockaddr_in { u16 family; u16 port (BE); u32 addr (BE); pad }
      const addr = new Uint8Array(16);
      new DataView(addr.buffer).setUint16(0, 2, true); // AF_INET
      new DataView(addr.buffer).setUint16(2, port, false);
      addr.set([127, 0, 0, 1], 4);

      // struct timeval { i64 sec; i64 usec } for SO_RCVTIMEO (SOL_SOCKET=1, 20)
      const timeo = new Uint8Array(16);
      new DataView(timeo.buffer).setBigInt64(0, 10n, true);
      // SO_RCVBUF (SOL_SOCKET=1, 8). Setting it also turns off receive buffer
      // autotuning, so the window doesn't depend on the host's tcp_rmem.
      const rcvbuf = new Int32Array([16 * 1024]);

      const request = Buffer.from("GET /file HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
      const terminator = Buffer.from("\\r\\n\\r\\n");
      const expectedPad = Buffer.alloc(padSize, "p");
      const expectedBody = Buffer.alloc(fileSize, 0xee);
      // No other header contains a run of pad bytes this long.
      const padMarker = expectedPad.subarray(0, 64);
      // Fits the pad, the file and the other headers. Receiving straight into
      // it keeps the per-recv work small and the window-update ACKs frequent.
      const wire = Buffer.alloc(padSize + fileSize + 64 * 1024);

      function iteration(): { kind: string; detail?: string } {
        const fd = libc.socket(2, 1, 0); // AF_INET, SOCK_STREAM
        if (fd < 0) return { kind: "socket-failed" };
        try {
          if (libc.setsockopt(fd, 1, 20, ptr(timeo), 16) !== 0) {
            return { kind: "setsockopt-failed" };
          }
          if (libc.setsockopt(fd, 1, 8, ptr(rcvbuf), 4) !== 0) {
            return { kind: "setsockopt-failed" };
          }
          if (libc.connect(fd, ptr(addr), 16) !== 0) {
            return { kind: "connect-failed" };
          }
          if (libc.send(fd, ptr(request), request.length, 0) !== BigInt(request.length)) {
            return { kind: "send-failed" };
          }

          // Read until header terminator + fileSize body bytes. The keep-alive
          // socket never closes on its own, so an exact byte target is
          // required. Check header bytes as they arrive and stop at the first
          // file byte, or the exact-length accounting would wait out the
          // receive timeout on the scrambled stream.
          let total = 0;
          let padStart = -1;
          let verified = 0; // wire offset up to which the x-pad value has been compared
          let hdrEnd = -1;
          let expected = padSize + fileSize; // lower bound until hdrEnd is known
          let corrupt = "";
          while (total < expected && total < wire.length) {
            const n = Number(libc.recv(fd, ptr(wire, total), Math.min(256 * 1024, wire.length - total), 0));
            if (n <= 0) break; // EOF, error, or SO_RCVTIMEO after a 10s stall
            total += n;
            if (hdrEnd !== -1) continue;

            if (padStart === -1) {
              padStart = wire.subarray(0, total).indexOf(padMarker);
              if (padStart === -1) {
                if (total < 32 * 1024) continue;
                return { kind: "no-pad", detail: "no x-pad value in the first " + total + " bytes" };
              }
              verified = padStart;
            }
            const padEnd = padStart + padSize;
            if (verified < padEnd) {
              const upto = Math.min(total, padEnd);
              const want = expectedPad.subarray(verified - padStart, upto - padStart);
              if (!wire.subarray(verified, upto).equals(want)) {
                const at = wire.subarray(0, upto).indexOf(0xee, verified);
                corrupt =
                  at === -1
                    ? "x-pad bytes differ in [" + verified + ", " + upto + ")"
                    : "file byte at " + at + " inside the x-pad value";
                break;
              }
              verified = upto;
            }
            if (verified === padEnd) {
              const seen = wire.subarray(0, total);
              const fileByte = seen.indexOf(0xee, padEnd);
              const found = seen.indexOf(terminator, padEnd);
              // Legit only when the body start (terminator end) is at or
              // before the first file byte.
              if (found !== -1 && (fileByte === -1 || found + 4 <= fileByte)) {
                hdrEnd = found;
                expected = hdrEnd + 4 + fileSize;
              } else if (fileByte !== -1) {
                corrupt = "file byte at " + fileByte + " before the header terminator";
                break;
              }
            }
          }

          if (corrupt) return { kind: "corrupt", detail: corrupt + ", read " + total };
          if (hdrEnd === -1) return { kind: "no-header-end", detail: "got " + total };
          // Everything in the header block outside the pad.
          const head = wire.toString("latin1", 0, padStart) + wire.toString("latin1", padStart + padSize, hdrEnd);
          if (head.includes("\\xee")) {
            return { kind: "corrupt", detail: "file byte before the x-pad value" };
          }
          if (!head.startsWith("HTTP/1.1 200 OK\\r\\n")) {
            return { kind: "bad-status", detail: head.slice(0, 64) };
          }
          const contentLength = /^content-length: (\\d+)$/im.exec(head)?.[1];
          if (contentLength !== String(fileSize)) {
            return { kind: "bad-content-length", detail: String(contentLength) };
          }
          const body = wire.subarray(hdrEnd + 4, total);
          if (body.length !== fileSize) {
            return { kind: "bad-body-length", detail: body.length + " of " + fileSize + ", total " + total };
          }
          if (!body.equals(expectedBody)) return { kind: "bad-body-byte" };
          return { kind: "ok" };
        } finally {
          libc.close(fd);
        }
      }

      const failures: { kind: string; detail?: string }[] = [];
      let ok = 0;
      for (let i = 0; i < iterations; i++) {
        const r = iteration();
        if (r.kind === "ok") ok++;
        else failures.push(r);
        if (r.kind !== "ok") break; // the first failure decides the verdict
      }
      console.log(JSON.stringify({ ok, failures }));
    `,
    });
    await Bun.write(join(String(dir), "file.bin"), Buffer.alloc(FILE_SIZE, 0xee));

    // Built once. A debug build takes about 70ms to validate a 16MB header value.
    const headers = new Headers({ "x-pad": Buffer.alloc(PAD_SIZE, "p").toString() });
    await using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch() {
        return new Response(Bun.file(join(String(dir), "file.bin")), { headers });
      },
    });

    const clean = { stdout: JSON.stringify({ ok: ITERATIONS_PER_CLIENT, failures: [] }), stderr: "", exitCode: 0 };
    for (let wave = 0; wave < WAVES; wave++) {
      await using clients = new AsyncDisposableStack();
      const procs = Array.from({ length: CLIENTS_PER_WAVE }, () =>
        clients.use(
          Bun.spawn({
            cmd: [bunExe(), join(String(dir), "client-fixture.ts")],
            env: {
              ...bunEnv,
              PORT: String(server.port),
              PAD_SIZE: String(PAD_SIZE),
              FILE_SIZE: String(FILE_SIZE),
              ITERATIONS: String(ITERATIONS_PER_CLIENT),
            },
            stderr: "pipe",
          }),
        ),
      );
      const results = await Promise.all(
        procs.map(async proc => {
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stdout: stdout.trim(), stderr, exitCode };
        }),
      );
      expect(results).toEqual(Array(CLIENTS_PER_WAVE).fill(clean));
    }
  },
  30_000,
);

test("sends a Bun.file() body in response to TRACE", async () => {
  using dir = tempDir("serve-file-trace", { "payload.txt": "0123456789ABCDEF" });
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response(Bun.file(join(String(dir), "payload.txt"))),
  });

  // A raw socket, so the result doesn't depend on how fetch() reads a TRACE response.
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let received = "";
  await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port!,
    socket: {
      open: socket => void socket.write("TRACE / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
      data: (_socket, chunk) => void (received += chunk.toString("latin1")),
      close: () => resolve(received),
      error: (_socket, err) => reject(err),
    },
  });
  const [head, body] = (await promise).split("\r\n\r\n");
  expect(head.toLowerCase()).toContain("content-length: 16");
  expect(body).toBe("0123456789ABCDEF");
});

test.each([
  [205, "0", ""],
  [307, "5", "hello"],
  [308, "5", "hello"],
])("a %d Bun.file() route sends a Content-Length on a keep-alive connection", async (status, contentLength, body) => {
  using dir = tempDir("serve-file-route-status", { "f.txt": "hello" });
  await using server = Bun.serve({
    port: 0,
    routes: { "/r": new Response(Bun.file(join(String(dir), "f.txt")), { status, headers: { Location: "/" } }) },
  });

  const res = await fetch(`${server.url}r`, { redirect: "manual" });
  expect({ status: res.status, contentLength: res.headers.get("content-length") }).toEqual({ status, contentLength });
  expect(await res.text()).toBe(body);
});

// Unix-socket listeners reach the same Linux sendfile path as TCP (the
// response handle is transport-agnostic), so pin body integrity for a >=1MB
// file over AF_UNIX too.
test.skipIf(!isLinux)("sendfile serves an intact >=1MB file over a unix socket listener", async () => {
  using dir = tempDir("serve-sendfile-unix", {});
  const data = Buffer.alloc(2 * 1024 * 1024, 0xee);
  await Bun.write(join(String(dir), "file.bin"), data);

  const unix = join(String(dir), "s.sock");
  await using server = Bun.serve({
    unix,
    fetch() {
      return new Response(Bun.file(join(String(dir), "file.bin")));
    },
  });

  const res = await fetch("http://localhost/file", { unix });
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());
  expect(body.length).toBe(data.length);
  expect(body.compare(data)).toBe(0);
});

// Sends a request, waits for the response head and then resets the connection.
async function abortAfterResponseHead(port: number) {
  const { promise: sawBytes, resolve } = Promise.withResolvers<void>();
  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(s) {
        s.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      },
      data: () => resolve(),
      close: () => resolve(),
      error: () => resolve(),
    },
  });
  await sawBytes;
  client.terminate();
}

test.skipIf(isWindows)("aborted Response(Bun.file(FIFO)) without a writer closes its fd", async () => {
  using dir = tempDir("serve-fifo-abort-leak", {});
  const fifoPath = join(String(dir), "unwritten.fifo");
  mkfifo(fifoPath);

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(Bun.file(fifoPath)),
  });

  const countFds = () => readdirSync(isLinux ? "/proc/self/fd" : "/dev/fd").length;
  const baseline = countFds();
  for (let i = 0; i < 16; i++) await abortAfterResponseHead(server.port);

  const deadline = Date.now() + 5000;
  while (countFds() > baseline + 4 && Date.now() < deadline) await Bun.sleep(10);
  expect(countFds()).toBeLessThanOrEqual(baseline + 4);
});

test.skipIf(isWindows)("the next response can read a FIFO fd after an aborted Response(Bun.file(fd))", async () => {
  using dir = tempDir("serve-fifo-fd-abort", {});
  const fifoPath = join(String(dir), "fd.fifo");
  mkfifo(fifoPath);
  const fd = openSync(fifoPath, constants.O_RDONLY | constants.O_NONBLOCK);
  // Without a writer, macOS reads EOF and the first response ends before the abort.
  const writer = openSync(fifoPath, "w");
  try {
    const aborted = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.resolve());
        return new Response(Bun.file(fd));
      },
    });
    await abortAfterResponseHead(server.port);
    await aborted.promise;

    writeSync(writer, "hello");
    closeSync(writer);
    expect(await fetch(server.url).then(res => res.text())).toBe("hello");
  } finally {
    closeSync(fd);
  }
});

test.concurrent.skipIf(isWindows)(
  "a handler that answers with Bun.file(FIFO) while its request body fails on maxRequestBodySize",
  async () => {
    using dir = tempDir("serve-fifo-body-limit", {
      "fixture.ts": `
import { closeSync, constants, openSync, writeSync } from "node:fs";
const fifo = process.argv[2];
// A writer that stays open, so the read end waits for bytes and sees no end.
const writer = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
const answer = Promise.withResolvers<void>();
const bodyOfX = Promise.withResolvers<ReadableStream>();
const attached = Promise.withResolvers<void>();
using server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  development: false,
  maxRequestBodySize: 32,
  error() {
    answer.resolve();
    return new Response("err", { status: 500 });
  },
  async fetch(req) {
    if (req.method === "GET") return new Response("ok");
    if (new URL(req.url).pathname === "/x") {
      bodyOfX.resolve(req.body!);
      await answer.promise;
      return new Response(Bun.file(fifo));
    }
    const other = await bodyOfX.promise;
    // One turn of the event loop later the server has taken the response of /y.
    setImmediate(attached.resolve);
    return new HTMLRewriter().on("p", { element() {} }).transform(new Response(other));
  },
});
function post(path: string) {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const status = fetch(server.url.origin + path, {
    method: "POST",
    body: new ReadableStream<Uint8Array>({ start: c => void (body = c) }),
  }).then(
    res => res.status,
    e => e.code,
  );
  return { status, overflow: () => body.enqueue(new Uint8Array(48)) };
}
const y = post("/y");
const x = post("/x");
await attached.promise;
x.overflow();
await x.status;
const status = await y.status;
// The FIFO becomes readable after the connection of /x is gone.
for (let i = 0; i < 10; i++) await fetch(server.url).then(res => res.text());
writeSync(writer, Buffer.alloc(4096, "z"));
const later = await fetch(server.url).then(res => res.text());
closeSync(writer);
console.log(JSON.stringify({ status, later, pendingRequests: server.pendingRequests }));
`,
    });
    const fifoPath = join(String(dir), "body.fifo");
    mkfifo(fifoPath);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts", fifoPath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ status: 500, later: "ok", pendingRequests: 0 });
    expect(exitCode).toBe(0);
  },
);
