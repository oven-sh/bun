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

describe("empty compressed responses", () => {
  // A response that declares Content-Encoding but sends zero body bytes must
  // resolve as an empty body, like Node — not fail with ZlibError.
  // https://github.com/oven-sh/bun/issues/23149
  for (const [name, write] of Object.entries({
    "chunked": `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
    "content-length-0": `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n`,
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
