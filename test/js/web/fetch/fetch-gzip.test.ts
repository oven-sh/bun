import { Socket } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { gcTick } from "harness";
import { once } from "node:events";
import { createServer } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import path from "path";
import { gzipSync } from "zlib";

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
    // 127.0.0.1, not "localhost": on dual-stack hosts "localhost" can resolve
    // to ::1 while the listener binds 127.0.0.1 (or vice versa), so fetch hits
    // ConnectionRefused.
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

// RFC 1952 §2.2: a gzip file may contain multiple back-to-back members
// (`cat a.gz b.gz`). fetch() must decode all of them, not silently
// truncate to the first.
describe("fetch() with a concatenated multi-member gzip body", () => {
  const a = Buffer.from("Hello, ");
  const b = Buffer.from("multi-member ");
  const c = Buffer.from("gzip world!\n");
  const small = Buffer.concat([gzipSync(a), gzipSync(b), gzipSync(c)]);
  const smallExpected = Buffer.concat([a, b, c]).toString();

  const big1 = Buffer.alloc(300 * 1024, "A");
  const big2 = Buffer.alloc(300 * 1024, "B");
  const large = Buffer.concat([gzipSync(big1), gzipSync(big2)]);
  const largeExpected = Buffer.concat([big1, big2]);

  function serve(body: Buffer) {
    return Bun.serve({
      port: 0,
      fetch() {
        return new Response(body, {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/plain",
          },
        });
      },
    });
  }

  it("decodes all members (small body, libdeflate fast path)", async () => {
    using server = serve(small);
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(smallExpected);
  });

  it("decodes all members (large body)", async () => {
    using server = serve(large);
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    const got = Buffer.from(await res.arrayBuffer());
    expect(got.length).toBe(largeExpected.length);
    expect(got.equals(largeExpected)).toBe(true);
  });

  it("decodes all members (chunked transfer, zlib slow path)", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              for (let i = 0; i < small.length; i += 7) {
                controller.write(small.subarray(i, i + 7));
                await controller.flush();
              }
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "gzip",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(smallExpected);
  });

  // The body is decompressed incrementally, one network read at a time (the
  // Connection: close / streaming path — no Content-Length to buffer against).
  // If a gzip member's trailer lands exactly on a read boundary, the reader
  // sees StreamEnd with no input left: it must keep its inflate state alive for
  // the next read instead of finishing and silently dropping later members.
  //
  // We force that exact boundary with a raw TCP server that writes each member
  // as its own frame and only sends the next after the previous has fully
  // drained into the kernel — so member A's trailer ends a read before B's
  // bytes arrive. Small members keep the whole member inside one read (no
  // output-buffer-full splitting), making the StreamEnd-at-boundary
  // deterministic.
  it("decodes all members split across network reads (streaming slow path)", async () => {
    const partA = Buffer.from("first member payload");
    const partB = Buffer.from("second member payload");
    const partC = Buffer.from("third member payload");
    const members = [gzipSync(partA), gzipSync(partB), gzipSync(partC)];
    const expected = Buffer.concat([partA, partB, partC]).toString();

    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        drain(socket) {
          const q: Array<{ buf: Buffer; resolve: () => void }> = socket.data;
          while (q.length) {
            const head = q[0];
            const n = socket.write(head.buf);
            if (n < head.buf.length) {
              head.buf = head.buf.subarray(n);
              return;
            }
            q.shift();
            head.resolve();
          }
        },
        async open(socket) {
          const q: Array<{ buf: Buffer; resolve: () => void }> = (socket.data = []);
          // Resolve only once `buf` has fully drained into the kernel, so the
          // next write lands in a separate network read on the client.
          const send = (buf: Buffer) =>
            new Promise<void>(resolve => {
              if (q.length) {
                q.push({ buf, resolve });
                return;
              }
              const n = socket.write(buf);
              if (n < buf.length) q.push({ buf: buf.subarray(n), resolve });
              else resolve();
            });

          // Yield to the event loop's check phase between writes so the socket
          // flushes each member as its own send() before the next is queued —
          // a bare microtask can leave them in one TCP segment on fast loopback.
          const tick = () => new Promise<void>(r => setImmediate(r));

          await send(
            Buffer.from(
              "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n",
            ),
          );
          for (const member of members) {
            await send(member);
            await tick();
          }
          socket.end();
        },
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(expected);
  });
});
