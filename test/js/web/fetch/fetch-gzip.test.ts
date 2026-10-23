import { Socket } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import { truncateSync } from "node:fs";
import { createServer } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import {
  brotliCompressSync,
  deflateRawSync,
  deflateSync,
  gzipSync,
  inflateRawSync,
  inflateSync,
  zstdCompressSync,
} from "node:zlib";
import path from "path";
import { upgradeHeaders } from "./websocket.helpers";

const gzipped = path.join(import.meta.dir, "fixture.html.gz");
const html = path.join(import.meta.dir, "fixture.html");
let htmlText: string;
beforeAll(async () => {
  htmlText = (await Bun.file(html).text()).replace(/\r\n/g, "\n");
});

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      gcTick();
      return new Response(require("fs").readFileSync(gzipped), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });
  gcTick();

  const res = await fetch(server.url, { verbose: true });
  gcTick();
  const arrayBuffer = await res.arrayBuffer();
  const clone = new Buffer(arrayBuffer);
  gcTick();
  await (async function () {
    const second = Buffer.from(htmlText);
    gcTick();
    expect(second.equals(clone)).toBe(true);
  })();
  gcTick();
});

it("fetch() with a redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(gzipped).arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      return Response.redirect("/redirect");
    },
  });

  const url = new URL("hey", server.url);
  const res = await fetch(url, { verbose: true });
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

it("fetch() with a protocol-relative redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req, server) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(gzipped).arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      const { host } = server.url;
      return Response.redirect(`://${host}/redirect`);
    },
  });

  const res = await fetch(new URL("hey", server.url), { verbose: true });
  expect(new URL(res.url)).toEqual(new URL("redirect", server.url));
  expect(res.redirected).toBe(true);
  expect(res.status).toBe(200);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

it("fetch() with a gzip response works (one chunk, streamed, with a delay)", async () => {
  using server = Bun.serve({
    port: 0,

    fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            await 2;

            const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
            controller.write(buffer);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": "1",
          },
        },
      );
    },
  });

  const res = await fetch(server.url);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

// RFC 9110 §8.4.1: content codings are case-insensitive. `x-gzip` is a
// registered deprecated alias of `gzip`. Node/undici lowercase the
// Content-Encoding value before matching and accept `x-gzip`; we must too,
// otherwise res.text()/res.json() silently return raw compressed bytes.
describe("fetch() decodes Content-Encoding case-insensitively", () => {
  const payload = JSON.stringify({ hello: "world", n: 42 });
  const bodies = {
    gzip: gzipSync(payload),
    deflate: deflateSync(payload),
    br: brotliCompressSync(payload),
    zstd: zstdCompressSync(payload),
  };
  // [Content-Encoding header value as sent on the wire, compressor]
  const cases: Array<[string, keyof typeof bodies]> = [
    ["gzip", "gzip"],
    ["GZIP", "gzip"],
    ["Gzip", "gzip"],
    ["x-gzip", "gzip"],
    ["X-Gzip", "gzip"],
    ["X-GZIP", "gzip"],
    ["deflate", "deflate"],
    ["Deflate", "deflate"],
    ["DEFLATE", "deflate"],
    ["br", "br"],
    ["BR", "br"],
    ["Br", "br"],
    ["zstd", "zstd"],
    ["ZSTD", "zstd"],
    ["Zstd", "zstd"],
    ["identity, gzip", "gzip"],
    ["gzip , identity", "gzip"],
    ["identity,br,identity", "br"],
  ];

  it.each(cases)("Content-Encoding: %s", async (enc, kind) => {
    // Use node:http so the header value reaches the wire exactly as written.
    const server = createServer((req, res) => {
      res.setHeader("Content-Encoding", enc);
      res.setHeader("Content-Type", "application/json");
      res.end(bodies[kind]);
    });
    await once(server.listen(0), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      // Must be the decoded JSON, not the raw compressed bytes.
      expect(await res.json()).toEqual({ hello: "world", n: 42 });
    } finally {
      server.close();
    }
  });

  // The subprocess reads via `res.body` (ReadableStream) so the
  // ResponseBodyStreaming signal is set, which makes the chunked-encoding
  // handler call `decompress_chunk` per on_data instead of buffering the
  // whole body first. Server writes yield to the event loop between chunks
  // so they arrive in separate TCP segments / on_data callbacks, driving
  // the decoder across multiple calls.
  describe.each(["gzip", "deflate", "br", "zstd"] as const)(
    "streaming %s decompression over multiple chunks",
    encoding => {
      it.concurrent.each(["0", "1"])("BUN_FEATURE_FLAG_NO_LIBDEFLATE=%s", async noLibdeflate => {
        // Body large enough that the compressed form spans many 17-byte writes.
        const expected = JSON.stringify({
          data: Array.from({ length: 64 }, (_, i) => ({ i, s: `item-${i}` })),
        });
        const compress = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync, zstd: zstdCompressSync };
        const compressed = compress[encoding](expected);
        const server = createNetServer(socket => {
          socket.setNoDelay(true);
          socket.write(
            "HTTP/1.1 200 OK\r\n" +
              `Content-Encoding: ${encoding}\r\n` +
              "Transfer-Encoding: chunked\r\n" +
              "Content-Type: application/json\r\n" +
              "Connection: close\r\n\r\n",
          );
          (async () => {
            for (let i = 0; i < compressed.length; i += 17) {
              const chunk = compressed.subarray(i, i + 17);
              socket.write(chunk.length.toString(16) + "\r\n");
              socket.write(chunk);
              socket.write("\r\n");
              await new Promise(r => setImmediate(r));
            }
            socket.end("0\r\n\r\n");
          })().catch(() => socket.destroy());
        });
        await once(server.listen(0), "listening");
        try {
          const { port } = server.address() as import("node:net").AddressInfo;
          await using proc = Bun.spawn({
            cmd: [
              bunExe(),
              "-e",
              `const res = await fetch(process.argv[1]);
               if (res.status !== 200) throw new Error("status " + res.status);
               const chunks = [];
               for await (const c of res.body) chunks.push(c);
               process.stdout.write(Buffer.concat(chunks).toString("utf8"));`,
              `http://127.0.0.1:${port}/`,
            ],
            env: { ...bunEnv, BUN_FEATURE_FLAG_NO_LIBDEFLATE: noLibdeflate },
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, stderr, exitCode }).toEqual({
            stdout: expected,
            stderr: expect.not.stringContaining("error"),
            exitCode: 0,
          });
        } finally {
          server.close();
        }
      });
    },
  );

  it("unknown Content-Encoding still passes through untouched", async () => {
    const server = createServer((req, res) => {
      res.setHeader("Content-Encoding", "foobar");
      res.setHeader("Content-Type", "text/plain");
      res.end("plain-text-body");
    });
    await once(server.listen(0), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("plain-text-body");
    } finally {
      server.close();
    }
  });

  // We can only strip one coding; a stacked Content-Encoding is passed through raw with the header intact.
  it.each(["gzip, br", "deflate, gzip"])("stacked Content-Encoding: %s passes through untouched", async enc => {
    const body = brotliCompressSync(gzipSync(payload));
    const server = createServer((req, res) => {
      res.setHeader("Content-Encoding", enc);
      res.end(body);
    });
    await once(server.listen(0), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get("content-encoding")).toBe(enc);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
    } finally {
      server.close();
    }
  });

  // RFC 9112 §6.1: `Transfer-Encoding: gzip, chunked` is chunked framing.
  it.each(["gzip, chunked", "identity,chunked", "Chunked"])("Transfer-Encoding: %s is chunked framing", async te => {
    const server = createNetServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.write(`HTTP/1.1 200 OK\r\nTransfer-Encoding: ${te}\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n`);
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("hello world");
    } finally {
      server.close();
    }
  });

  it.each(["chunked, gzip", "foobar"])("Transfer-Encoding: %s is rejected", async te => {
    const server = createNetServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.end(`HTTP/1.1 200 OK\r\nTransfer-Encoding: ${te}\r\nConnection: close\r\n\r\n0\r\n\r\n`);
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      expect(async () => await fetch(`http://127.0.0.1:${port}/`)).toThrow("UnsupportedTransferEncoding");
    } finally {
      server.close();
    }
  });
});

it("fetch() with a gzip response works (multiple chunks, TCP server)", async done => {
  const compressed = await Bun.file(gzipped).arrayBuffer();
  var socketToClose!: Socket;
  let pending,
    pendingChunks: any[] = [];
  const server = Bun.listen({
    // Explicit IPv4 loopback: "localhost" may bind only ::1 while fetch()
    // resolves it to 127.0.0.1, giving ConnectionRefused on some hosts.
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      drain(socket) {
        if (pending) {
          while (pendingChunks.length) {
            const chunk = pendingChunks.shift();
            const written = socket.write(chunk);

            if (written < chunk.length) {
              pendingChunks.push(chunk.slice(written));
              return;
            }
          }
          const resolv = pending;
          pending = null;
          resolv();
        }
      },
      async open(socket) {
        socketToClose = socket;

        var corked: any[] = [];
        var cork = true;
        let written = 0;
        let pendingChunks: any[] = [];
        async function write(chunk: any) {
          let defer = Promise.withResolvers();

          if (cork) {
            corked.push(chunk);
          }

          if (!cork && corked.length) {
            const toWrite = corked.join("");
            const wrote = socket.write(toWrite);
            if (wrote !== toWrite.length) {
              pendingChunks.push(toWrite.slice(wrote));
            }
            corked.length = 0;
          }

          if (!cork) {
            if (pendingChunks.length) {
              pendingChunks.push(chunk);
              pending = defer.resolve;
              await defer.promise;
              defer = Promise.withResolvers();
              pending = defer.resolve;
            }

            const written = socket.write(chunk);
            if (written < chunk.length) {
              console.log("written", written);
              pendingChunks.push(chunk.slice(written));
              pending = defer.resolve;
              await defer.promise;
              defer = Promise.withResolvers();
              pending = defer.resolve;
            }
          }

          const promise = defer.promise;
          if (pendingChunks.length) {
            pending = promise;
            await promise;
          } else {
            pending = null;
          }
        }
        await write("HTTP/1.1 200 OK\r\n");
        await write("Content-Encoding: gzip\r\n");
        await write("Content-Type: text/html; charset=utf-8\r\n");
        await write("Content-Length: " + compressed.byteLength + "\r\n");
        await write("X-WTF: " + "lol".repeat(1000) + "\r\n");
        await write("\r\n");
        for (var i = 100; i < compressed.byteLength; i += 100) {
          cork = false;
          await write(compressed.slice(i - 100, i));
        }
        await write(compressed.slice(i - 100));
        await write("\r\n");

        socket.flush();
      },
    },
  });
  await 1;

  const res = await fetch(`http://${server.hostname}:${server.port}`);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
  socketToClose.end();
  server.stop();
  done();
});

// A buffered (non-streaming) fetch() must be able to decompress a response
// body larger than 1 GiB. The HTTP client's Decompressor runs unbounded, the
// same as the original Zig implementation; only available memory limits it.
// Run in a subprocess so the ~1 GiB output buffer does not linger in the test
// process.
it("fetch() with a buffered gzip response whose decompressed size exceeds 1 GiB works", async () => {
  const fixture = /* js */ `
      import { createGzip } from "node:zlib";

      const CHUNK = Buffer.alloc(1024 * 1024);
      const N = 1025; // 1 GiB + 1 MiB
      const chunks = [];
      await new Promise((resolve, reject) => {
        const gz = createGzip();
        gz.on("data", c => chunks.push(c));
        gz.on("end", resolve);
        gz.on("error", reject);
        let i = 0;
        const pump = () => {
          while (i < N) {
            i++;
            if (!gz.write(CHUNK)) return void gz.once("drain", pump);
          }
          gz.end();
        };
        pump();
      });
      const body = Buffer.concat(chunks);

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch() {
          return new Response(body, {
            headers: {
              "Content-Encoding": "gzip",
              "Content-Length": String(body.length),
            },
          });
        },
      });
      try {
        const res = await fetch(\`http://127.0.0.1:\${server.port}/\`);
        const buf = await res.arrayBuffer();
        console.log("OK", buf.byteLength);
      } finally {
        server.stop(true);
      }
    `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: `OK ${1025 * 1024 * 1024}`,
    stderr: expect.not.stringContaining("error"),
    exitCode: 0,
  });
}, 60_000);

describe("corrupt compressed responses", () => {
  // A body decompression failure is a body error: fetch() must resolve (status
  // and headers are available) and the body reader rejects. Previously, when
  // head+body arrived in a single read, the decompress error failed the HTTP
  // task before the head reached JS and fetch() itself rejected, so the error
  // surface depended on packet timing.
  const corrupt = (compress: (b: Buffer) => Buffer) => {
    const payload = compress(Buffer.alloc(18000, "The quick brown fox jumps over the lazy dog. "));
    // Flip a run of early bytes so every codec reports a decode error (br/zstd
    // store this input near-literally, so a single mid-stream flip passes).
    for (let i = 2; i < 8; i++) payload[i] ^= 0xff;
    return payload;
  };
  const bodies: Record<string, [Buffer, string]> = {
    gzip: [corrupt(gzipSync), "ZlibError"],
    deflate: [corrupt(deflateSync), "ZlibError"],
    br: [corrupt(brotliCompressSync), "BrotliDecompressionError"],
    zstd: [corrupt(zstdCompressSync), "ZstdDecompressionError"],
  };
  const listen = (srv: import("node:net").Server) =>
    new Promise<number>(r => srv.listen(0, "127.0.0.1", () => r((srv.address() as { port: number }).port)));

  for (const [encoding, [body, errorCode]] of Object.entries(bodies)) {
    for (const framing of ["content-length", "chunked"] as const) {
      it(`${encoding} ${framing}: fetch() resolves, body read rejects`, async () => {
        const head =
          framing === "content-length"
            ? `HTTP/1.1 200 OK\r\nx-marker: present\r\nContent-Encoding: ${encoding}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
            : `HTTP/1.1 200 OK\r\nx-marker: present\r\nContent-Encoding: ${encoding}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
        const payload =
          framing === "content-length"
            ? body
            : Buffer.concat([Buffer.from(body.length.toString(16) + "\r\n"), body, Buffer.from("\r\n0\r\n\r\n")]);

        // Single write so head+body land in one client read (the case that
        // previously rejected fetch()). The split-read timing was already
        // correct and is equivalent after this fix.
        const srv = createNetServer(sock => {
          sock.on("error", () => {});
          sock.end(Buffer.concat([Buffer.from(head), payload]));
        });
        const port = await listen(srv);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          expect(res.status).toBe(200);
          expect(res.headers.get("x-marker")).toBe("present");
          const bodyErr = await res.arrayBuffer().then(
            () => null,
            e => e,
          );
          expect(bodyErr).toBeInstanceOf(Error);
          expect((bodyErr as { code?: string }).code).toBe(errorCode);
          // The streaming body reader must surface the same failure.
          const res2 = await fetch(`http://127.0.0.1:${port}/`);
          expect(res2.status).toBe(200);
          const reader = res2.body!.getReader();
          let streamErr: unknown = null;
          try {
            while (!(await reader.read()).done) {}
          } catch (e) {
            streamErr = e;
          }
          expect(streamErr).toBeInstanceOf(Error);
          expect((streamErr as { code?: string }).code).toBe(errorCode);
        } finally {
          srv.close();
        }
      });
    }
  }

  it("redirect with a malformed chunked body: follow succeeds, manual surfaces the body error", async () => {
    // Redirects are followed on the response head (WHATWG HTTP-redirect fetch),
    // so a parse failure in the discarded 3xx body must not affect redirect:
    // "follow"; under redirect:"manual" the 302 body surfaces the error.
    await using final = Bun.serve({ port: 0, fetch: () => new Response("FINAL") });
    const location = `${final.url.origin}/final`;
    const srv = createNetServer(sock => {
      sock.on("error", () => {});
      sock.end(
        "HTTP/1.1 302 Found\r\n" +
          `Location: ${location}\r\n` +
          "Transfer-Encoding: chunked\r\n" +
          "Connection: close\r\n\r\n" +
          "ZZ\r\n",
      );
    });
    const port = await listen(srv);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: "follow" });
      expect({ status: res.status, redirected: res.redirected, url: res.url, body: await res.text() }).toEqual({
        status: 200,
        redirected: true,
        url: location,
        body: "FINAL",
      });

      // With redirect:"manual" the 302 *is* the final response.
      const manual = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      expect(manual.status).toBe(302);
      expect(manual.headers.get("location")).toBe(location);
      const bodyErr = await manual.arrayBuffer().then(
        () => null,
        e => e,
      );
      expect(bodyErr).toBeInstanceOf(Error);
      expect((bodyErr as { code?: string }).code).toBe("InvalidHTTPResponse");
    } finally {
      srv.close();
    }
  });

  describe("close-delimited (FIN) framing", () => {
    const FULL = 50000;
    const plain = Buffer.alloc(FULL, "A");
    const truncate = (b: Buffer) => b.subarray(0, b.length >> 1);
    const codecs: Record<string, [Buffer, string]> = {
      gzip: [truncate(gzipSync(plain)), "ZlibError"],
      deflate: [truncate(deflateSync(plain)), "ZlibError"],
      br: [truncate(brotliCompressSync(plain)), "BrotliDecompressionError"],
      zstd: [truncate(zstdCompressSync(plain)), "ZstdDecompressionError"],
    };

    for (const [encoding, [half, errorCode]] of Object.entries(codecs)) {
      it(`${encoding}: truncated stream rejects the body read`, async () => {
        const srv = createNetServer(sock => {
          sock.on("error", () => {});
          sock.once("data", () => {
            sock.write(`HTTP/1.1 200 OK\r\nContent-Encoding: ${encoding}\r\nConnection: close\r\n\r\n`);
            sock.end(half);
          });
        });
        const port = await listen(srv);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          expect(res.status).toBe(200);
          const bodyErr = await res.arrayBuffer().then(
            ab => ({ resolved: ab.byteLength }),
            e => e,
          );
          expect(bodyErr).toBeInstanceOf(Error);
          expect((bodyErr as { code?: string }).code).toBe(errorCode);

          const res2 = await fetch(`http://127.0.0.1:${port}/`);
          const reader = res2.body!.getReader();
          let streamErr: unknown = null;
          try {
            while (!(await reader.read()).done) {}
          } catch (e) {
            streamErr = e;
          }
          expect(streamErr).toBeInstanceOf(Error);
          expect((streamErr as { code?: string }).code).toBe(errorCode);
        } finally {
          srv.close();
        }
      });
    }

    for (const [encoding, compress] of [
      ["gzip", gzipSync],
      ["deflate", deflateSync],
      ["br", brotliCompressSync],
      ["zstd", zstdCompressSync],
    ] as const) {
      it(`${encoding}: complete stream resolves with the full body`, async () => {
        const body = compress(plain);
        const srv = createNetServer(sock => {
          sock.on("error", () => {});
          sock.once("data", () => {
            sock.write(`HTTP/1.1 200 OK\r\nContent-Encoding: ${encoding}\r\nConnection: close\r\n\r\n`);
            sock.end(body);
          });
        });
        const port = await listen(srv);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          const buf = Buffer.from(await res.arrayBuffer());
          expect({ status: res.status, len: buf.length, ok: buf.equals(plain) }).toEqual({
            status: 200,
            len: FULL,
            ok: true,
          });
        } finally {
          srv.close();
        }
      });
    }

    // A reset is not the FIN. On Linux the body read then fails with ECONNRESET. A stream that is short no
    // longer fails with the error of its decoder. A stream that reached an end of its own is cut too: the
    // server resets before the second gzip member, or the second zstd frame, leaves.
    const cutByReset: [name: string, encoding: string, payload: Buffer][] = [
      ...Object.entries(codecs).map(([encoding, [half]]): [string, string, Buffer] => [
        `${encoding}: truncated stream`,
        encoding,
        half,
      ]),
      ["gzip: the first of two members, whole", "gzip", gzipSync(plain)],
      ["zstd: the first of two frames, whole", "zstd", zstdCompressSync(plain)],
    ];
    for (const [name, encoding, payload] of cutByReset) {
      it(`${name}, then a reset: the body read rejects with ECONNRESET`, async () => {
        const sockets: import("node:net").Socket[] = [];
        const srv = createNetServer(sock => {
          sock.on("error", () => {});
          sock.once("data", () => {
            sockets.push(sock);
            const head = `HTTP/1.1 200 OK\r\nContent-Encoding: ${encoding}\r\nConnection: close\r\n\r\n`;
            sock.write(Buffer.concat([Buffer.from(head), payload]));
          });
        });
        const port = await listen(srv);
        try {
          // The client has the head when fetch() resolves, and the payload came with the head.
          const res = await fetch(`http://127.0.0.1:${port}/`);
          for (const sock of sockets) sock.resetAndDestroy();
          const read = await res.arrayBuffer().then(
            body => ({ resolved: body.byteLength }),
            (error: Error & { code?: string }) => ({ rejected: error.constructor.name, code: error.code }),
          );
          expect({ status: res.status, read }).toEqual({
            status: 200,
            // fetch() has this rule on Linux and Android. Elsewhere the read only has to settle.
            read: isLinux ? { rejected: "TypeError", code: "ECONNRESET" } : expect.anything(),
          });
        } finally {
          for (const sock of sockets) sock.destroy();
          srv.close();
        }
      });
    }

    it("identity: uncompressed close-delimited body is delivered intact", async () => {
      const body = Buffer.alloc(4096, "x");
      const srv = createNetServer(sock => {
        sock.on("error", () => {});
        sock.once("data", () => {
          sock.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
          sock.end(body);
        });
      });
      const port = await listen(srv);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
      } finally {
        srv.close();
      }
    });
  });

  it("redirect loop with a non-empty body rejects with TooManyRedirects", async () => {
    // Real-world 302s carry an HTML body, which routes the intermediate
    // head through clone_metadata(); hitting the redirect limit must still
    // reject fetch() rather than resolve with that 302.
    const body = "<html><body>Moved.</body></html>";
    const srv = createNetServer(sock => {
      sock.on("error", () => {});
      let acc = "";
      sock.on("data", d => {
        acc += d;
        if (!acc.includes("\r\n\r\n")) return;
        acc = "";
        sock.end(
          `HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${port}/loop\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        );
      });
    });
    const port = await listen(srv);
    try {
      const err = await fetch(`http://127.0.0.1:${port}/`).then(
        r => ({ status: r.status }),
        e => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: string }).code).toBe("TooManyRedirects");
    } finally {
      srv.close();
    }
  });
});

// RFC 9112 section 8: a response with no Content-Length and no chunked framing ends when the server closes
// the connection. A reset is not that close, so the body it cuts short fails with ECONNRESET. Node's fetch
// resolves such a body with the part that arrived.
describe("close-delimited body: a reset is not the end of the body", () => {
  type NetSocket = import("node:net").Socket;
  const HEAD = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
  const trusted = { tls: { ca: tlsCert.cert } };

  // A promise as a value to compare: what it resolved with, or the class and the code of its error.
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      value => ({ resolved: value }),
      (error: Error & { code?: string }) => ({ rejected: error.constructor.name, code: error.code }),
    );
  // The rule is compiled for Linux and Android. Elsewhere every close still ends such a body, so there the
  // read of a cut body only has to settle.
  const cut = isLinux ? { rejected: "TypeError", code: "ECONNRESET" } : expect.anything();
  // fetch() and the read of the body, for a server that resets on its own. Off Linux that reset can take the
  // head with it (Windows drops what the client has yet to read), so there the exchange only has to settle.
  const exchange = (response: Promise<Response>) =>
    settled(response.then(async res => ({ status: res.status, text: await settled(res.text()) })));
  const cutExchange = isLinux ? { resolved: { status: 200, text: cut } } : expect.anything();
  // What an exchange delivered: the text of the body, or "rejected" when fetch() or the read rejected.
  const delivered = (outcome: any): string => outcome.resolved?.text?.resolved ?? "rejected";
  // A framed answer with no body.
  const EMPTY = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

  // A raw server. `respond` runs once for each connection, when the request head is in: `request` is the
  // head and the bytes of the body that came with it.
  async function serve(
    respond: (socket: NetSocket, request: string) => void,
    { tls, unix }: { tls?: import("node:tls").TlsOptions; unix?: string } = {},
  ) {
    const sockets = new Set<NetSocket>();
    const onConnection = (socket: NetSocket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let request = "";
      const onData = (data: Buffer) => {
        request += data.toString("latin1");
        if (!request.includes("\r\n\r\n")) return;
        socket.off("data", onData);
        respond(socket, request);
      };
      socket.on("data", onData);
    };
    const server = tls
      ? createTlsServer({ ...tlsCert, ...tls }, onConnection)
      : createNetServer({ allowHalfOpen: true }, onConnection);
    await once(unix ? server.listen(unix) : server.listen(0, "127.0.0.1"), "listening");
    const port = unix ? 0 : (server.address() as import("node:net").AddressInfo).port;
    return {
      port,
      url: unix ? "http://localhost/" : `${tls ? "https" : "http"}://127.0.0.1:${port}/`,
      // Resets every open connection: the client gets no FIN.
      reset() {
        for (const socket of sockets) if (!socket.destroyed) socket.resetAndDestroy();
      },
      // close() alone waits for the connections that are still open.
      async [Symbol.asyncDispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
      },
    };
  }

  // TLS has no call that resets a connection, or that ends it without a close_notify: a TCP relay in front
  // of the TLS server does both. With `bareFin` the close_notify of the origin does not reach the client and
  // its FIN does. With "then reset" the relay also leaves the upload unread from the answer on, so its close
  // after that FIN resets. With `alertThenReset` the close_notify reaches the client, the upload stays unread
  // too, and a reset takes the place of the FIN. All three need a TLS 1.2 origin, where the type of a record
  // is readable. With `tunnel` the relay is a CONNECT proxy: it answers the CONNECT of the client first.
  async function relayTo(
    origin: { port: number },
    { bareFin, alertThenReset, tunnel }: { bareFin?: true | "then reset"; alertThenReset?: true; tunnel?: true } = {},
  ) {
    const clients = new Set<NetSocket>();
    let tunnels = 0;
    const relay = createNetServer(client => {
      const upstream = connect(origin.port, "127.0.0.1");
      clients.add(client);
      client.on("error", () => {});
      upstream.on("error", () => {});
      client.on("close", () => {
        clients.delete(client);
        upstream.destroy();
      });
      // The client sends nothing after its CONNECT until the answer to it is in.
      let connectHead = tunnel ? "" : undefined;
      client.on("data", data => {
        if (connectHead === undefined) return void upstream.write(data);
        connectHead += data.toString("latin1");
        if (!connectHead.includes("\r\n\r\n")) return;
        connectHead = undefined;
        tunnels++;
        client.write("HTTP/1.1 200 Connection established\r\n\r\n");
      });
      let records = Buffer.alloc(0);
      // For `alertThenReset`: the records that the kernel has yet to take, and whether the origin has ended.
      let unflushed = 0;
      let originEnded = false;
      const resetWhenFlushed = () => {
        if (originEnded && unflushed === 0 && !client.destroyed) client.resetAndDestroy();
      };
      upstream.on("data", (data: Buffer) => {
        if (!bareFin && !alertThenReset) return void client.write(data);
        records = Buffer.concat([records, data]);
        // A record: its type (1 byte), a version (2), a length (2), then that many bytes.
        while (records.length >= 5 && records.length >= 5 + records.readUInt16BE(3)) {
          const record = records.subarray(0, 5 + records.readUInt16BE(3));
          records = records.subarray(record.length);
          if (record[0] === 21 && bareFin) continue; // an alert: the close_notify
          // Application data: the answer.
          if (record[0] === 23 && (bareFin === "then reset" || alertThenReset)) client.pause();
          if (!alertThenReset) {
            client.write(record);
            continue;
          }
          unflushed++;
          client.write(record, () => {
            unflushed--;
            resetWhenFlushed();
          });
        }
      });
      // Every byte of the origin is in by now, and the end() of `client` sends its FIN after them.
      upstream.on("end", () => {
        originEnded = true;
        if (alertThenReset) resetWhenFlushed();
        else if (bareFin === "then reset") client.end(() => client.destroy());
        else if (bareFin) client.end();
      });
    });
    await once(relay.listen(0, "127.0.0.1"), "listening");
    const { port } = relay.address() as import("node:net").AddressInfo;
    return {
      url: `https://127.0.0.1:${port}/`,
      // For the `proxy` option of fetch(), with `tunnel`.
      proxy: `http://127.0.0.1:${port}`,
      // The CONNECT requests that the relay answered.
      get tunnels() {
        return tunnels;
      },
      // Resets every client: no close_notify and no FIN.
      reset() {
        for (const client of clients) if (!client.destroyed) client.resetAndDestroy();
      },
      async [Symbol.asyncDispose]() {
        for (const client of clients) client.destroy();
        relay.close();
      },
    };
  }

  // A file for a Bun.file upload: 4 MiB, which is more than the socket takes while the server does not read.
  // It is a file of holes, so that no data goes to the disk.
  function uploadFile() {
    const dir = tempDir("fetch-cut-upload", { upload: "" });
    const file = path.join(String(dir), "upload");
    truncateSync(file, 4 * 1024 * 1024);
    return { file, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  // A request body that keeps coming, one chunk for each turn of the event loop, until the request is over.
  function endlessUpload() {
    let open = true;
    const chunk = new Uint8Array(64 * 1024).fill(117);
    const body = new ReadableStream({
      async pull(controller) {
        await new Promise(resolve => setImmediate(resolve));
        if (open) controller.enqueue(chunk);
      },
      cancel() {
        open = false;
      },
    });
    return { body, [Symbol.dispose]: () => void (open = false) };
  }

  // An ambient NO_PROXY that lists 127.0.0.1 makes fetch() ignore its `proxy` option. The HTTP client sees
  // an assignment to process.env and not a delete, so this restores with an assignment too.
  function withoutNoProxy() {
    const saved = [process.env.NO_PROXY, process.env.no_proxy];
    process.env.NO_PROXY = process.env.no_proxy = "";
    return {
      [Symbol.dispose]() {
        process.env.NO_PROXY = saved[0] ?? "";
        process.env.no_proxy = saved[1] ?? "";
      },
    };
  }

  describe.each([
    ["HTTP/1.1 with Connection: close", HEAD],
    ["HTTP/1.0", "HTTP/1.0 200 OK\r\n\r\n"],
    ["HTTP/1.1 with no Connection: close and no length", "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n"],
  ])("%s", (_, head) => {
    // Each test resets the connection when fetch() has resolved: the client has the head and "half" by then.
    const serveHalf = () => serve(socket => void socket.write(head + "half"));

    it("fetch() resolves with the head, then text() rejects", async () => {
      await using server = await serveHalf();
      const res = await fetch(server.url);
      server.reset();
      expect({ status: res.status, text: await settled(res.text()) }).toEqual({ status: 200, text: cut });
    });

    it("a stream reader gets the chunk that arrived, then rejects", async () => {
      await using server = await serveHalf();
      const reader = (await fetch(server.url)).body!.getReader();
      const first = await reader.read();
      server.reset();
      expect({ first: Buffer.from(first.value!).toString(), next: await settled(reader.read()) }).toEqual({
        first: "half",
        next: cut,
      });
    });

    it("Bun.write() rejects", async () => {
      await using server = await serveHalf();
      using dir = tempDir("fetch-cut-body", {});
      const res = await fetch(server.url);
      server.reset();
      expect(await settled(Bun.write(path.join(String(dir), "body"), res))).toEqual(cut);
    });
  });

  it("the head, part of the body and the reset at once: fetch() resolves, then the read rejects", async () => {
    await using server = await serve(socket => void socket.write(HEAD + "half", () => socket.resetAndDestroy()));
    expect(await exchange(fetch(server.url))).toEqual(cutExchange);
  });

  // The accepted break. A reset is not the end of the body, and fetch() cannot know that every byte of the
  // answer arrived. So the read also fails for a server that closes with a reset after a whole reply, with
  // nothing of the request left unread. Node's fetch resolves both of these.
  it.each([
    ["a whole reply", "the whole body"],
    ["a reply with no body", ""],
  ])("the accepted break: %s, then a reset with no FIN: the read rejects", async (_, body) => {
    await using server = await serve(socket => void socket.write(HEAD + body, () => socket.resetAndDestroy()));
    expect(await exchange(fetch(server.url))).toEqual(cutExchange);
  });

  it("a slow reader: 4 MiB, then the reset, and only then the read", async () => {
    const answer = Buffer.concat([Buffer.from(HEAD), Buffer.alloc(4 * 1024 * 1024, "x")]);
    // The reset comes when the kernel has taken the whole body, or at the latest when the client has the
    // head: a kernel that does not buffer 4 MiB for a reader that stopped must not hang the test.
    await using server = await serve(socket => void socket.write(answer, () => server.reset()));
    const res = await fetch(server.url);
    server.reset();
    const length = await settled(res.arrayBuffer().then(body => body.byteLength));
    expect({ status: res.status, length }).toEqual({ status: 200, length: cut });
  });

  // The order that decides for a slow reader: the reset is pending when fetch() stops reading, which it does
  // when 256 KiB of the body wait for a reader. The first part of the body stays below that mark. The part
  // that crosses it and the reset then come in one turn of the server, so the client meets that order in
  // most runs. fetch-syscall-fault.test.ts has it in every run, for builds with fault injection.
  // Linux only: the order exists only under the rule, and the steps depend on when this client stops reading.
  it.skipIf(!isLinux)(
    "a slow reader: the part that crosses the pause mark and the reset at once: every run rejects",
    async () => {
      const first = Buffer.concat([Buffer.from(HEAD), Buffer.alloc(256 * 1024 - 1024, "x")]);
      const outcomes: unknown[] = [];
      for (let run = 0; run < 10; run++) {
        const firstWritten = Promise.withResolvers<NetSocket>();
        await using server = await serve((socket, request) => {
          if (request.startsWith("GET /turn ")) return void socket.end(EMPTY);
          // Or the kernel can hold the second part back until the client acknowledges the first one, and the
          // reset then drops it.
          socket.setNoDelay(true);
          socket.write(first, () => firstWritten.resolve(socket));
        });
        // A request that starts now, when it is over: the HTTP thread of the client has taken what the other
        // connection had for it before.
        const turn = async () => void (await (await fetch(server.url + "turn")).arrayBuffer());
        const res = await fetch(server.url);
        const socket = await firstWritten.promise;
        await turn();
        socket.write(Buffer.alloc(2048, "y"));
        socket.resetAndDestroy();
        await turn();
        outcomes.push({ status: res.status, length: await settled(res.arrayBuffer().then(body => body.byteLength)) });
      }
      expect(outcomes).toEqual(Array(10).fill({ status: 200, length: cut }));
    },
  );

  it("a streamed upload in flight: every run rejects", async () => {
    await using server = await serve(socket => {
      socket.pause(); // the upload stays unread
      socket.write(HEAD + "half", () => socket.resetAndDestroy());
    });
    const outcomes: unknown[] = [];
    // The call of the client that meets the reset differs from run to run: a recv(), or the send() of a chunk.
    for (let run = 0; run < 30; run++) {
      using upload = endlessUpload();
      outcomes.push(await exchange(fetch(server.url, { method: "POST", body: upload.body, duplex: "half" })));
    }
    expect(outcomes).toEqual(Array(30).fill(cutExchange));
  });

  // A Bun.file upload over http goes out with sendfile(). A sendfile() that fails rejects fetch() with its
  // own errno, so this upload is outside the rule: the error is not always ECONNRESET. One of the two calls
  // meets the reset in every run, so no run delivers the cut body.
  it("a Bun.file upload in flight: no run delivers the cut body", async () => {
    using upload = uploadFile();
    await using server = await serve(socket => {
      socket.pause(); // the upload stays unread
      socket.write(HEAD + "half", () => socket.resetAndDestroy());
    });
    const outcomes: string[] = [];
    for (let run = 0; run < 10; run++) {
      const body = Bun.file(upload.file);
      outcomes.push(delivered(await exchange(fetch(server.url, { method: "POST", body }))));
    }
    expect(outcomes).toEqual(Array(10).fill(isLinux ? "rejected" : expect.anything()));
  });

  it("https: fetch() resolves with the head, then text() rejects", async () => {
    await using origin = await serve(socket => void socket.write(HEAD + "half"), { tls: {} });
    await using relay = await relayTo(origin);
    const res = await fetch(relay.url, trusted);
    relay.reset();
    expect({ status: res.status, text: await settled(res.text()) }).toEqual({ status: 200, text: cut });
  });

  it("https: a reset after the server read the whole upload", async () => {
    const upload = Buffer.alloc(1024 * 1024, "u");
    await using origin = await serve(
      (socket, request) => {
        let read = request.length - request.indexOf("\r\n\r\n") - 4;
        const answerWhenWhole = () => void (read === upload.length && socket.write(HEAD + "half"));
        socket.on("data", data => {
          read += data.length;
          answerWhenWhole();
        });
        answerWhenWhole();
      },
      { tls: {} },
    );
    await using relay = await relayTo(origin);
    const res = await fetch(relay.url, { ...trusted, method: "POST", body: upload });
    relay.reset();
    expect({ status: res.status, text: await settled(res.text()) }).toEqual({ status: 200, text: cut });
  });

  // A TLS connection that had a send() rejected keeps the old rule: its close does not say how the read side
  // ended. So a run in which a send() of the upload meets the reset first still resolves with the part that
  // arrived, as before. Every other run rejects.
  it.each([
    ["does not read", (socket: NetSocket) => void socket.pause()],
    ["reads", (socket: NetSocket) => void socket.resume()],
  ])(
    "https, a streamed upload in flight that the server %s: a run rejects, or ends as before",
    async (_, takeUpload) => {
      await using origin = await serve(
        socket => {
          takeUpload(socket);
          socket.write(HEAD + "half");
        },
        { tls: {} },
      );
      await using relay = await relayTo(origin);
      const unexpected: unknown[] = [];
      for (let run = 0; run < 10; run++) {
        using upload = endlessUpload();
        const res = await fetch(relay.url, { ...trusted, method: "POST", body: upload.body, duplex: "half" });
        relay.reset();
        const text = (await settled(res.text())) as { resolved?: string; code?: string };
        const asTheRuleSays = text.code === "ECONNRESET";
        const asBefore = text.resolved === "half";
        if (res.status !== 200 || (isLinux && !asTheRuleSays && !asBefore))
          unexpected.push({ status: res.status, text });
      }
      expect(unexpected).toEqual([]);
    },
  );

  // fetch() sends an idempotent request again when a connection from the keep-alive pool closes before the
  // response began. A reset in the body is not that close: the request went out once, and the read rejects.
  it.each([
    ["part of the body", "half"],
    ["the head and no byte of the body", ""],
  ])("a connection from the keep-alive pool, reset after %s: the request is not sent again", async (_, part) => {
    // "<connection>:<path>" for each request head, in the order in which the server got them.
    const seen: string[] = [];
    const sockets = new Set<NetSocket>();
    let connections = 0;
    let cutSocket: NetSocket | undefined;
    const server = createNetServer(socket => {
      const id = ++connections;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let buffered = "";
      socket.on("data", data => {
        buffered += data.toString("latin1");
        for (let end; (end = buffered.indexOf("\r\n\r\n")) !== -1;) {
          const requestPath = buffered.slice(0, end).split(" ")[1];
          buffered = buffered.slice(end + 4);
          seen.push(`${id}:${requestPath}`);
          if (requestPath !== "/cut") {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
          } else if (!cutSocket) {
            cutSocket = socket;
            socket.write("HTTP/1.1 200 OK\r\n\r\n" + part);
          } else {
            // A second /cut, which must not come. It ends with a FIN, so the read settles and `seen` shows it.
            socket.end("HTTP/1.1 200 OK\r\n\r\n" + part);
          }
        }
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      const warm = await (await fetch(base + "/warm")).text();
      const res = await fetch(base + "/cut");
      cutSocket!.resetAndDestroy();
      const text = await settled(res.text());
      const after = await (await fetch(base + "/after")).text();
      expect({ warm, status: res.status, text, after, seen }).toEqual({
        warm: "ok",
        status: 200,
        text: cut,
        after: "ok",
        // /cut went out once, on the connection of /warm. The other connection is the one of /after.
        seen: ["1:/warm", "1:/cut", "2:/after"],
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  it("an unread cut body is no unhandled rejection, and a late text() rejects at once", async () => {
    const script = /* js */ `
      import { once } from "node:events";
      import { createServer } from "node:net";

      const sockets = [];
      const server = createServer(socket => {
        socket.on("error", () => {});
        socket.once("data", () => {
          socket.write(${JSON.stringify(HEAD + "half")});
          sockets.push(socket);
        });
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const url = "http://127.0.0.1:" + server.address().port + "/";
      const settled = promise =>
        promise.then(
          text => "resolved " + text,
          error => error.constructor.name + " " + error.code,
        );

      const unread = await fetch(url);
      const watched = await fetch(url);
      // In the order of the requests: when the second read has settled, the client has seen the first reset too.
      for (const socket of sockets) socket.resetAndDestroy();
      const watchedRead = await settled(watched.text());
      // An unhandled rejection ends the process in one of these turns.
      for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
      const late = unread.text();
      const lateIs = Bun.peek.status(late);
      console.log(JSON.stringify({ status: unread.status, watched: watchedRead, lateIs, late: await settled(late) }));
      server.close();
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let result: unknown = stdout;
    try {
      result = JSON.parse(stdout);
    } catch {}
    expect({ result, stderr, exitCode }).toEqual({
      result: isLinux
        ? { status: 200, watched: "TypeError ECONNRESET", lateIs: "rejected", late: "TypeError ECONNRESET" }
        : expect.objectContaining({ status: 200 }),
      stderr: "",
      exitCode: 0,
    });
  });

  // `return new Response(upstream.body)`: the proxy must not turn the cut into a complete chunked message.
  it("a Bun.serve proxy of a cut body reports it, and does not terminate its own body as complete", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import net from "node:net";
        // The upstream resets only once "chunk-a" has provably reached the
        // client of the proxy.
        const chunkReachedClient = Promise.withResolvers();
        const upstream = net.createServer(socket => {
          socket.on("error", () => {});
          socket.once("data", () => {
            socket.write("HTTP/1.1 200 OK\\r\\nConnection: close\\r\\n\\r\\nchunk-a");
            chunkReachedClient.promise.then(() => socket.resetAndDestroy());
          });
        });
        await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
        const server = Bun.serve({
          port: 0,
          development: false,
          async fetch() {
            const res = await fetch("http://127.0.0.1:" + upstream.address().port + "/");
            return new Response(res.body);
          },
        });
        const wire = await new Promise(resolve => {
          const chunks = [];
          const sock = net.connect(server.port, "127.0.0.1", () => {
            sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
          });
          sock.on("data", d => {
            chunks.push(d);
            if (Buffer.concat(chunks).includes("chunk-a")) chunkReachedClient.resolve();
          });
          sock.on("error", () => {});
          sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
        });
        console.log(JSON.stringify({
          statusLine: wire.split("\\r\\n")[0],
          cleanChunkedTerminator: wire.endsWith("0\\r\\n\\r\\n"),
          body: wire.split("\\r\\n\\r\\n").slice(1).join("\\r\\n\\r\\n"),
        }));
        server.stop(true);
        upstream.close();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: stdout.trim() ? JSON.parse(stdout) : stdout, exitCode }).toEqual({
      result: isLinux
        ? { statusLine: "HTTP/1.1 200 OK", cleanChunkedTerminator: false, body: "7\r\nchunk-a\r\n" }
        : // Either end of the body is right here: the request only has to finish.
          expect.objectContaining({ statusLine: "HTTP/1.1 200 OK" }),
      exitCode: 0,
    });
    // The failure must still reach the operator.
    if (isLinux) expect(stderr).toContain("ECONNRESET");
  });

  // These pass with and without the rule: they pin the ends of a connection that still complete the body.
  describe("still the end of the body", () => {
    const WHOLE = "the whole body";
    const whole = { resolved: WHOLE };
    // The answer, a FIN (on TLS after a close_notify), and a close with the upload unread: that close resets.
    const endThenReset = (socket: NetSocket) => {
      socket.pause();
      socket.end(HEAD + WHOLE, () => socket.destroy());
    };
    // Uploads that such a server does not read. What the client meets first differs from run to run: the
    // end of the stream, the reset, or a send() that fails with EPIPE.
    async function uploads(runs: number, bytes: number, url: string, init: BunFetchRequestInit = {}) {
      const body = Buffer.alloc(bytes, "u");
      const outcomes: unknown[] = [];
      for (let run = 0; run < runs; run++) {
        outcomes.push(await settled(fetch(url, { ...init, method: "POST", body }).then(res => res.text())));
      }
      return outcomes;
    }

    it("a FIN", async () => {
      await using server = await serve(socket => void socket.end(HEAD + WHOLE));
      expect(await settled(fetch(server.url).then(res => res.text()))).toEqual(whole);
    });

    // The next three and the unix socket one are not for Windows: it drops what the client has yet to read
    // when the reset arrives, and that can be the answer (fetch.tls.test.ts skips "reads a response that the
    // server sent before it reset the upload" for this).
    it.skipIf(isWindows)("a FIN, then a reset", async () => {
      await using server = await serve(endThenReset);
      expect(await uploads(10, 4 * 1024 * 1024, server.url)).toEqual(Array(10).fill(whole));
    });

    // A Bun.file upload is outside the rule (see "a Bun.file upload in flight" above): a sendfile() that
    // meets the reset rejects fetch(), as it did before the rule. No run resolves with less than the whole
    // body.
    it.skipIf(isWindows)("a FIN, then a reset, with a Bun.file upload in flight: never a short body", async () => {
      using upload = uploadFile();
      await using server = await serve(endThenReset);
      const outcomes: string[] = [];
      for (let run = 0; run < 10; run++) {
        const body = Bun.file(upload.file);
        outcomes.push(delivered(await exchange(fetch(server.url, { method: "POST", body }))));
      }
      expect(outcomes.filter(body => body !== WHOLE && body !== "rejected")).toEqual([]);
    });

    it.skipIf(isWindows)("https: a close_notify, then a reset", async () => {
      await using server = await serve(endThenReset, { tls: {} });
      expect(await uploads(6, 4 * 1024 * 1024, server.url, trusted)).toEqual(Array(6).fill(whole));
    });

    // The close_notify of the origin ended its stream. Here the reset that follows it comes with no FIN, so
    // a send() of the upload can fail with ECONNRESET before the client reads the close_notify. The body is
    // whole all the same.
    it.skipIf(isWindows)("https: a close_notify, then a reset with no FIN", async () => {
      await using origin = await serve(socket => void socket.end(HEAD + WHOLE), { tls: { maxVersion: "TLSv1.2" } });
      await using relay = await relayTo(origin, { alertThenReset: true });
      expect(await uploads(6, 8 * 1024 * 1024, relay.url, trusted)).toEqual(Array(6).fill(whole));
    });

    it.skipIf(isWindows)("https: a FIN with no close_notify, then a reset", async () => {
      await using origin = await serve(socket => void socket.end(HEAD + WHOLE), { tls: { maxVersion: "TLSv1.2" } });
      await using relay = await relayTo(origin, { bareFin: "then reset" });
      expect(await uploads(4, 8 * 1024 * 1024, relay.url, trusted)).toEqual(Array(4).fill(whole));
    });

    it("https: a FIN with no close_notify", async () => {
      await using origin = await serve(socket => void socket.end(HEAD + WHOLE), { tls: { maxVersion: "TLSv1.2" } });
      await using relay = await relayTo(origin, { bareFin: true });
      expect(await settled(fetch(relay.url, trusted).then(res => res.text()))).toEqual(whole);
    });

    // A raw node:net server on a socket path, like the ones in fetch.unix.test.ts. On a unix socket a reset
    // only says that the peer closed with input unread: it comes for a whole answer too.
    it.skipIf(isWindows)("over a unix socket: the answer, an end, then a close with the upload unread", async () => {
      using dir = tempDir("fetch-cut-unix", {});
      const unix = path.join(String(dir), "server.sock");
      await using server = await serve(endThenReset, { unix });
      expect(await uploads(10, 8 * 1024 * 1024, server.url, { unix })).toEqual(Array(10).fill(whole));
    });

    // With no end() the client gets a reset after the answer in every run: the upload is unread.
    it.skipIf(isWindows)("over a unix socket: the answer, then a close with the upload unread and no end", async () => {
      using dir = tempDir("fetch-cut-unix", {});
      const unix = path.join(String(dir), "server.sock");
      await using server = await serve(
        socket => {
          socket.pause();
          socket.write(HEAD + WHOLE, () => socket.destroy());
        },
        { unix },
      );
      expect(await uploads(10, 8 * 1024 * 1024, server.url, { unix })).toEqual(Array(10).fill(whole));
    });

    // Behind a CONNECT proxy the connection of the client ends with the teardown of the proxy, whatever the
    // origin did. The rule does not apply to a body that comes through such a tunnel: a reset ends it.
    it("through a CONNECT proxy: the whole answer, then the reset of the proxy", async () => {
      // The origin leaves its connection open after the answer, so the reset of the proxy is the end.
      await using origin = await serve(socket => void socket.write(HEAD + WHOLE), { tls: {} });
      await using proxy = await relayTo(origin, { tunnel: true });
      using _ = withoutNoProxy();
      const res = await fetch(origin.url, { ...trusted, proxy: proxy.proxy });
      const reader = res.body!.getReader();
      const first = await reader.read();
      proxy.reset();
      expect({
        status: res.status,
        tunnels: proxy.tunnels,
        first: Buffer.from(first.value!).toString(),
        next: await settled(reader.read()),
      }).toEqual({ status: 200, tunnels: 1, first: WHOLE, next: { resolved: { done: true, value: undefined } } });
    });

    it("a reset of a 101-upgraded stream: done is true", async () => {
      await using server = await serve(
        socket =>
          void socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nfirst",
          ),
      );
      const ended = Promise.withResolvers<void>();
      const res = await fetch(server.url, {
        method: "GET",
        headers: upgradeHeaders(),
        // The upload side of the stream stays open until the read side has ended.
        async *body() {
          await ended.promise;
        },
      });
      const reader = res.body!.getReader();
      const first = await reader.read();
      server.reset();
      const next = await settled(reader.read());
      ended.resolve();
      expect({ status: res.status, first: Buffer.from(first.value!).toString(), next }).toEqual({
        status: 101,
        first: "first",
        next: { resolved: { done: true, value: undefined } },
      });
    });

    it("chunked: a reset after the last chunk, before the CRLF that ends the trailers", async () => {
      await using server = await serve(
        socket => void socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nHello\r\n0\r\n"),
      );
      const res = await fetch(server.url);
      server.reset();
      expect(await settled(res.text())).toEqual({ resolved: "Hello" });
    });

    it("gzip with a Content-Length: a reset after the last byte, before a reader decodes the body", async () => {
      // One libdeflate call inflates a gzip body of this size, so the client holds it whole and undecoded
      // until a reader attaches.
      const plain = Buffer.alloc(1024 * 1024, "The quick brown fox jumps over the lazy dog. ");
      const wire = gzipSync(plain);
      const head = `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${wire.length}\r\n\r\n`;
      await using server = await serve(socket => void socket.write(Buffer.concat([Buffer.from(head), wire])));
      const res = await fetch(server.url);
      server.reset();
      // A few turns of the event loop let the client meet the reset before a reader attaches. The body is
      // whole in either order.
      for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
      const body = Buffer.from(await res.arrayBuffer());
      expect({ length: body.length, same: body.equals(plain) }).toEqual({ length: plain.length, same: true });
    });
  });
});

// RFC 1952 §2.2: a gzip file is a sequence of members. Concatenated members
// (cat a.gz b.gz, bgzf, pigz, pre-compressed segment stitching) must all be
// decoded. Previously fetch() silently returned only the first member.
describe("fetch() decodes multi-member Content-Encoding: gzip", () => {
  const P1 = Buffer.alloc(18000, "The quick brown fox jumps over the lazy dog. ");
  const P2 = Buffer.alloc(14000, "SECOND-MEMBER-");
  const M1 = gzipSync(P1);
  const M2 = gzipSync(P2);
  const BODY = Buffer.concat([M1, M2]);
  const EXPECT = Buffer.concat([P1, P2]).toString("utf8");

  type Case = [label: string, pieces: Buffer[], chunked: boolean];
  const cases: Case[] = [
    ["content-length, one write", [BODY], false],
    [
      "content-length, split mid member #1 trailer",
      [BODY.subarray(0, M1.length - 5), BODY.subarray(M1.length - 5)],
      false,
    ],
    ["content-length, split at member boundary", [M1, M2], false],
    ["chunked, one chunk", [BODY], true],
    ["chunked, one chunk per member", [M1, M2], true],
    // gzip padding: trailing zeros after the last member must be tolerated.
    ["content-length, trailing zero padding", [Buffer.concat([BODY, Buffer.alloc(8)])], false],
    // Trailing non-gzip-magic bytes after the last member must be tolerated
    // as garbage (not treated as another member), matching browsers/curl/Go.
    ["content-length, trailing CRLF garbage", [Buffer.concat([BODY, Buffer.from("\r\n")])], false],
  ];

  describe.each(["0", "1"])("BUN_FEATURE_FLAG_NO_LIBDEFLATE=%s", noLibdeflate => {
    it.concurrent.each(cases)("%s", async (_label, pieces, chunked) => {
      const total = pieces.reduce((n, p) => n + p.length, 0);
      const server = createNetServer(socket => {
        socket.on("error", () => {});
        socket.setNoDelay(true);
        const head = chunked
          ? "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
          : `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${total}\r\nConnection: close\r\n\r\n`;
        socket.write(head);
        (async () => {
          for (const p of pieces) {
            if (chunked) {
              socket.write(p.length.toString(16) + "\r\n");
              socket.write(p);
              socket.write("\r\n");
            } else {
              socket.write(p);
            }
            await new Promise(r => setImmediate(r));
          }
          socket.end(chunked ? "0\r\n\r\n" : (undefined as any));
        })().catch(() => socket.destroy());
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      try {
        const { port } = server.address() as import("node:net").AddressInfo;
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const res = await fetch(process.argv[1]);
             const buf = Buffer.from(await res.arrayBuffer());
             process.stdout.write(buf);`,
            `http://127.0.0.1:${port}/`,
          ],
          env: { ...bunEnv, BUN_FEATURE_FLAG_NO_LIBDEFLATE: noLibdeflate },
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ len: stdout.length, stdout, stderr, exitCode }).toEqual({
          len: EXPECT.length,
          stdout: EXPECT,
          stderr: expect.not.stringContaining("error"),
          exitCode: 0,
        });
      } finally {
        server.close();
      }
    });
  });

  // A single valid gzip member followed by non-gzip-magic trailing bytes
  // must still decode successfully (prior Bun behavior, and what browsers /
  // curl / Go do). The multi-member loop only resumes on 0x1f so stray
  // CRLF/footer junk from misconfigured origins does not fail the fetch.
  it.concurrent.each(["0", "1"])("single member with trailing garbage (NO_LIBDEFLATE=%s)", async noLibdeflate => {
    const body = Buffer.concat([M1, Buffer.from("\r\ngarbage")]);
    const server = createNetServer(socket => {
      socket.on("error", () => {});
      socket.end(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
          ),
          body,
        ]),
      );
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const res = await fetch(process.argv[1]);
           process.stdout.write(Buffer.from(await res.arrayBuffer()));`,
          `http://127.0.0.1:${port}/`,
        ],
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_LIBDEFLATE: noLibdeflate },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ len: stdout.length, stdout, stderr, exitCode }).toEqual({
        len: P1.length,
        stdout: P1.toString(),
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
    } finally {
      server.close();
    }
  });

  // Last member's ISIZE trailer > 512 KiB (LibdeflateState::shared_buffer) so
  // the libdeflate fast path takes the decompress_to_vec branch, which must
  // also detect unconsumed input and fall through.
  it.concurrent("content-length, last member > 512 KiB (decompress_to_vec branch)", async () => {
    const big = Buffer.alloc(600 * 1024, "BIG-LAST-MEMBER-");
    const body = Buffer.concat([M1, gzipSync(big)]);
    const server = createNetServer(socket => {
      socket.on("error", () => {});
      socket.end(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
          ),
          body,
        ]),
      );
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const expected = Buffer.concat([P1, big]);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const res = await fetch(process.argv[1]);
           const buf = Buffer.from(await res.arrayBuffer());
           console.log(buf.length, Bun.hash(buf).toString(16));`,
          `http://127.0.0.1:${port}/`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: `${expected.length} ${Bun.hash(expected).toString(16)}`,
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
    } finally {
      server.close();
    }
  });

  // Streaming body path (ResponseBodyStreaming signal set): exercises the
  // per-chunk Decompressor::decompress_chunk path with a member boundary
  // between chunks.
  it.concurrent("streaming body, member boundary between chunks", async () => {
    const server = createNetServer(socket => {
      socket.on("error", () => {});
      socket.setNoDelay(true);
      socket.write(
        "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
      );
      (async () => {
        for (const p of [M1, M2]) {
          socket.write(p.length.toString(16) + "\r\n");
          socket.write(p);
          socket.write("\r\n");
          await new Promise(r => setImmediate(r));
        }
        socket.end("0\r\n\r\n");
      })().catch(() => socket.destroy());
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const res = await fetch(process.argv[1]);
           const chunks = [];
           for await (const c of res.body) chunks.push(c);
           process.stdout.write(Buffer.concat(chunks));`,
          `http://127.0.0.1:${port}/`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ len: stdout.length, stdout, stderr, exitCode }).toEqual({
        len: EXPECT.length,
        stdout: EXPECT,
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
    } finally {
      server.close();
    }
  });
});

describe("empty compressed responses", () => {
  // A response that declares Content-Encoding but sends zero body bytes must
  // resolve as an empty body, like Node — not fail with ZlibError.
  // https://github.com/oven-sh/bun/issues/23149
  for (const [name, write] of Object.entries({
    "chunked": `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
    "content-length-0": `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n`,
    "close-delimited": `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nConnection: close\r\n\r\n`,
  })) {
    it(`empty gzip body via ${name} resolves as empty`, async () => {
      // end() rather than write(): FIN the connection after the response so
      // nothing is left parked in the keep-alive pool when the server closes.
      const raw = createNetServer(socket => void socket.end(write));
      await new Promise<void>(resolve => raw.listen(0, () => resolve()));
      const port = (raw.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(await res.text()).toBe("");
      } finally {
        raw.close();
      }
    });
  }
});

describe("Content-Encoding: deflate, zlib-wrapped or raw", () => {
  const plain = Buffer.alloc(2000, "The quick brown fox jumps over the lazy dog. ");

  // The first byte of a zlib stream holds the window size. It is 0x78 only for a 15-bit window.
  it.each([9, 10, 11, 12, 13, 14, 15])("decodes a zlib stream with a %i-bit window", async windowBits => {
    const body = deflateSync(plain, { windowBits });
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(body, { headers: { "Content-Encoding": "deflate" } }),
    });
    const res = await fetch(server.url);
    expect(await res.text()).toBe(plain.toString());
  });

  // A stored block (RFC 1951 section 3.2.4). Bits 3 to 7 of its first byte are padding and its second
  // byte is the low byte of LEN, so a raw deflate stream can start with almost any two bytes.
  const stored = (first: number, data: Buffer) => {
    const header = Buffer.alloc(5);
    header[0] = first;
    header.writeUInt16LE(data.length, 1);
    header.writeUInt16LE(~data.length & 0xffff, 3);
    return Buffer.concat([header, data]);
  };
  const rawStartingWith = (first: number, len: number) =>
    Buffer.concat([stored(first, plain.subarray(0, len)), stored(0x01, plain.subarray(len))]);
  // A 32K-window zlib stream whose header declares a 512-byte window. Its matches reach back 4096 bytes.
  const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 2654435761) >>> 24));
  const lyingWindow = deflateSync(Buffer.concat([noise, noise]));
  lyingWindow.set([0x18, 0x19]);
  // One body that is valid as a zlib stream and as raw deflate, with different content. As zlib: the header
  // 78 9c, a fixed-Huffman block of three literals, a stored block, the Adler-32. As raw deflate: 78 opens a
  // stored block of 0x0a9c bytes, and the five bytes after that block open a stored block that ends the body.
  const zlibReading = Buffer.alloc(2753, "zlib, not raw deflate. ");
  zlibReading.set([0x56, 0x05, 0x48]);
  zlibReading.set(stored(0x01, Buffer.alloc(39)).subarray(0, 5), 2713);
  const twoReadings = Buffer.concat([
    Buffer.from([0x78, 0x9c, 0x0a, 0x63, 0xf5, 0x00]),
    stored(0x04, zlibReading.subarray(3)),
    Buffer.from(Bun.hash.adler32(zlibReading).toString(16).padStart(8, "0"), "hex"),
  ]);

  const decodes: Record<string, Buffer> = {
    raw: deflateRawSync(plain),
    raw78: rawStartingWith(0x78, 1000), // 78 e8: the first byte of a zlib stream, but not a zlib header
    wb9: deflateSync(plain, { windowBits: 9 }),
    wb15: deflateSync(plain),
    twoReadings, // fetch() must return the zlib reading
  };
  const fails: Record<string, Buffer> = {
    rawPassing1950: rawStartingWith(0x78, 769), // 78 01: raw deflate that starts with a valid zlib header
    lyingWindow,
    oneByte: Buffer.from([0x78]), // the body ends while the decoder waits for the second header byte
  };

  // One process is server and client. No timer: the server writes the head and the first `split` body
  // bytes in one write, and the rest only after the client's fetch() promise settled.
  const fixture = /* js */ `
    const input = JSON.parse(process.argv[1], (key, value) =>
      typeof value === "string" ? Buffer.from(value, "base64") : value,
    );
    const cells = new Map();
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        async data(socket, request) {
          const { framing, bytes, split, headersSeen } = cells.get(String(request).split(" ")[1]);
          const head = Buffer.from(
            "HTTP/1.1 200 OK\\r\\nContent-Encoding: deflate\\r\\nConnection: close\\r\\n" +
              (framing === "length" ? "Content-Length: " + bytes.length + "\\r\\n" : "") +
              (framing === "chunked" ? "Transfer-Encoding: chunked\\r\\n" : "") +
              "\\r\\n",
          );
          const piece = data =>
            framing !== "chunked" || data.length === 0
              ? data
              : Buffer.concat([Buffer.from(data.length.toString(16) + "\\r\\n"), data, Buffer.from("\\r\\n")]);
          const tail = Buffer.from(framing === "chunked" ? "0\\r\\n\\r\\n" : "");
          if (split === 0) return void socket.end(Buffer.concat([head, piece(bytes), tail]));
          socket.write(Buffer.concat([head, piece(bytes.subarray(0, split))]));
          await headersSeen;
          socket.end(Buffer.concat([piece(bytes.subarray(split)), tail]));
        },
        error() {},
      },
    });
    const results = {};
    await Promise.all(
      Object.entries(input.bodies).flatMap(([body, bytes]) =>
        ["length", "chunked", "close"].flatMap(framing =>
          [0, 1, 2].map(async (split, i) => {
            const { promise: headersSeen, resolve } = Promise.withResolvers();
            const path = "/" + body + "/" + framing + "/" + split;
            cells.set(path, { framing, bytes, split, headersSeen });
            const result = await fetch("http://127.0.0.1:" + server.port + path)
              .finally(resolve)
              .then(res => res.arrayBuffer())
              .then(
                decoded => (Buffer.from(decoded).equals(input.decoded[body] ?? input.plain) ? "ok" : "wrong bytes"),
                e => e.code,
              );
            ((results[body] ??= {})[framing] ??= [])[i] = result;
          }),
        ),
      ),
    );
    server.stop(true);
    console.log(JSON.stringify(results, (key, value) => (Array.isArray(value) ? value.join(" ") : value)));
  `;
  const base64 = (buffers: Record<string, Buffer>) =>
    Object.fromEntries(Object.entries(buffers).map(([name, bytes]) => [name, bytes.toString("base64")]));
  const input = JSON.stringify({
    plain: plain.toString("base64"),
    bodies: base64({ ...decodes, ...fails }),
    // The content that fetch() must return, for a body that does not hold `plain`.
    decoded: base64({ twoReadings: zlibReading }),
  });
  // One word per split (0, 1, 2) in each framing.
  const everyCell = (result: string) => {
    const row = [result, result, result].join(" ");
    return { length: row, chunked: row, close: row };
  };

  it.concurrent.each(["0", "1"])(
    "the read boundary and the framing do not change the result (BUN_FEATURE_FLAG_NO_LIBDEFLATE=%s)",
    async noLibdeflate => {
      // node:zlib reads `twoReadings` both ways.
      expect(inflateSync(twoReadings)).toEqual(zlibReading);
      expect(inflateRawSync(twoReadings)).not.toEqual(zlibReading);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture, input],
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_LIBDEFLATE: noLibdeflate },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let results: unknown = stdout;
      try {
        results = JSON.parse(stdout);
      } catch {}
      expect({
        results,
        errorLines: stderr.split("\n").filter(line => line.includes("Decompression error")).length,
        exitCode,
      }).toEqual({
        results: {
          ...Object.fromEntries(Object.keys(decodes).map(body => [body, everyCell("ok")])),
          ...Object.fromEntries(Object.keys(fails).map(body => [body, everyCell("ZlibError")])),
        },
        // Only a body that fails prints an error: one line for each of its nine cells.
        errorLines: Object.keys(fails).length * 9,
        exitCode: 0,
      });
    },
  );
});
