import { Socket } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick } from "harness";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import path from "path";

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
      gcTick(true);
      return new Response(require("fs").readFileSync(gzipped), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });
  gcTick(true);

  const res = await fetch(server.url, { verbose: true });
  gcTick(true);
  const arrayBuffer = await res.arrayBuffer();
  const clone = new Buffer(arrayBuffer);
  gcTick(true);
  await (async function () {
    const second = Buffer.from(htmlText);
    gcTick(true);
    expect(second.equals(clone)).toBe(true);
  })();
  gcTick(true);
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
});

it("fetch() with a gzip response works (multiple chunks, TCP server)", async done => {
  const compressed = await Bun.file(gzipped).arrayBuffer();
  var socketToClose!: Socket;
  let pending,
    pendingChunks = [];
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
        let pendingChunks = [];
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
          socket.end(chunked ? "0\r\n\r\n" : undefined);
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
