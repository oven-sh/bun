import { Socket } from "bun";
import { beforeAll, expect, it } from "bun:test";

import { createInternalStatsObject } from "bun:internal-for-testing";
import path from "path";

const gzipped = path.join(import.meta.dir, "fixture.html.gz");
let gzippedBlob: Blob;
const html = path.join(import.meta.dir, "fixture.html");
let htmlText: string;
beforeAll(async () => {
  htmlText = (await Bun.file(html).text()).replace(/\r\n/g, "\n");
  gzippedBlob = new Blob([await Bun.file(gzipped).arrayBuffer()]);
});

it("many concurrent decompression tasks that read to completion", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await Bun.sleep(0);
      return new Response(gzippedBlob, {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });
  const initialStats = createInternalStatsObject();
  for (let j = 0; j < 10; j++) {
    const count = 40;
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(fetch(server.url).then(res => res.text()));
    }
    const results = await Promise.all(promises);
    for (const text of results) {
      expect(text).toBe(htmlText);
    }
  }
  const finalStats = createInternalStatsObject();
  console.log(finalStats);

  expect(finalStats.concurrentDecompressionCount).toBeGreaterThan(
    // Not all will end up being concurrently decompressed, and that's okay.
    initialStats.concurrentDecompressionCount + 10 * 20,
  );
});

it("many concurrent decompression tasks that ignore the body", async () => {
  const arrayBuffer = await gzippedBlob.arrayBuffer();
  let promises: Promise<void>[] = [];
  let allPromises = Promise.withResolvers();
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await Bun.sleep(0);
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            const defer = Promise.withResolvers();
            promises.push(defer.promise);
            await Bun.sleep(1);
            await controller.write(arrayBuffer);
            await controller.end();
            defer.resolve();
            if (promises.length === 40) {
              allPromises.resolve();
            }
          },
        }),
        {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        },
      );
    },
  });

  for (let j = 0; j < 10; j++) {
    const count = 40;
    promises = [];
    allPromises = Promise.withResolvers();

    function wrap() {
      for (let i = 0; i < count; i++) {
        fetch(server.url).then(r => {});
      }
    }

    wrap();
    Bun.gc(true);
    await allPromises.promise;
    await Promise.all(promises);
  }
});

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      return new Response(require("fs").readFileSync(gzipped), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });

  const res = await fetch(server.url, { verbose: true });

  const arrayBuffer = await res.arrayBuffer();
  const clone = new Buffer(arrayBuffer);

  await (async function () {
    const second = Buffer.from(htmlText);

    expect(second.equals(clone)).toBe(true);
  })();
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

it("fetch() with a gzip response works (multiple chunks, TCP server)", async done => {
  const compressed = await Bun.file(gzipped).arrayBuffer();
  async function iterate() {
    var socketToClose!: Socket;
    let pending,
      pendingChunks = [];
    const server = Bun.listen({
      hostname: "localhost",
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
        drain(socket) {},
      },
    });
    await 1;

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const text = (await res.text()).replace(/\r\n/g, "\n");
    expect(text).toEqual(htmlText);
    socketToClose.end();
    server.stop();
  }

  // Run this once to test gzip decompression without concurrency
  {
    await iterate();
    Bun.sleep(2);
  }

  // Run this 10 times in parallel to test gzip decompression concurrency
  {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(iterate());
    }
    await Promise.all(promises);
  }

  done();
});
