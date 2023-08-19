import { concatArrayBuffers, Socket, TCPSocketListener } from "bun";
import { it, expect } from "bun:test";
import { gcTick } from "harness";

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  var server = Bun.serve({
    port: 0,

    async fetch(req) {
      gcTick(true);
      return new Response(require("fs").readFileSync(import.meta.dir + "/fixture.html.gz"), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });
  gcTick(true);

  const res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
  gcTick(true);
  const arrayBuffer = await res.arrayBuffer();
  const clone = new Buffer(arrayBuffer);
  gcTick(true);
  await (async function () {
    const second = new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer());
    gcTick(true);
    expect(second.equals(clone)).toBe(true);
  })();
  gcTick(true);
  server.stop();
});

it("fetch() with a redirect that returns a buffered gzip response works (one chunk)", async () => {
  var server = Bun.serve({
    port: 0,

    async fetch(req) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      return Response.redirect("/redirect");
    },
  });

  const res = await fetch(`http://${server.hostname}:${server.port}/hey`, { verbose: true });
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
  server.stop();
});

it("fetch() with a protocol-relative redirect that returns a buffered gzip response works (one chunk)", async () => {
  const server = Bun.serve({
    port: 0,

    async fetch(req, server) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      return Response.redirect(`://${server.hostname}:${server.port}/redirect`);
    },
  });

  const res = await fetch(`http://${server.hostname}:${server.port}/hey`, { verbose: true });
  expect(res.url).toBe(`http://${server.hostname}:${server.port}/redirect`);
  expect(res.redirected).toBe(true);
  expect(res.status).toBe(200);
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);

  server.stop();
});

it("fetch() with a gzip response works (one chunk, streamed, with a delay)", async () => {
  var server = Bun.serve({
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

  const res = await fetch(`http://${server.hostname}:${server.port}`, {});
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
  server.stop();
});

it("fetch() with a gzip response works (multiple chunks, TCP server", async done => {
  const compressed = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
  var socketToClose!: Socket;
  const server = Bun.listen({
    port: 0,
    hostname: "0.0.0.0",
    socket: {
      async open(socket) {
        socketToClose = socket;

        var corked: any[] = [];
        var cork = true;
        async function write(chunk: any) {
          await new Promise<void>((resolve, reject) => {
            if (cork) {
              corked.push(chunk);
            }

            if (!cork && corked.length) {
              socket.write(corked.join(""));
              corked.length = 0;
            }

            if (!cork) {
              socket.write(chunk);
            }

            resolve();
          });
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
        socket.flush();
      },
      drain(socket) {},
    },
  });
  await 1;

  const res = await fetch(`http://${server.hostname}:${server.port}`, {});
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
  socketToClose.end();
  server.stop();
  done();
});

it("fetch() stream with gzip chunked response works (multiple chunks)", async () => {
  const content = "Hello, world!\n".repeat(5);
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            const data = Bun.gzipSync(content).buffer;
            const size = data.byteLength / 5;
            controller.write(data.slice(0, size));
            await controller.flush();
            await Bun.sleep(100);
            controller.write(data.slice(size, size * 2));
            await controller.flush();
            await Bun.sleep(100);
            controller.write(data.slice(size * 2, size * 3));
            await controller.flush();
            await Bun.sleep(100);
            controller.write(data.slice(size * 3, size * 5));
            await controller.flush();

            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/plain", "Content-Encoding": "gzip" } },
      );
    },
  });
  let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
  gcTick(true);
  const result = await res.text();
  gcTick(true);
  expect(result).toBe(content);

  res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
  gcTick(true);
  const reader = res.body?.getReader();

  let buffer = Buffer.alloc(0);
  let parts = 0;
  while (true) {
    gcTick(true);

    const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
    if (value) {
      buffer = Buffer.concat([buffer, value]);
    }
    parts++;
    if (done) {
      break;
    }
  }

  gcTick(true);
  expect(buffer.toString("utf8")).toBe(content);
  expect(parts).toBeGreaterThan(1);
});

it("fetch() stream with gzip response works (multiple parts)", async () => {
  const content = "a".repeat(64 * 1024);
  const data = Bun.gzipSync(content);

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(data, { status: 200, headers: { "Content-Type": "text/plain", "Content-Encoding": "gzip" } });
    },
  });
  let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
  gcTick(true);
  const result = await res.text();
  gcTick(true);
  expect(result).toBe(content);

  res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
  gcTick(true);
  const reader = res.body?.getReader();

  let buffer = Buffer.alloc(0);
  let parts = 0;
  while (true) {
    gcTick(true);

    const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
    if (value) {
      buffer = Buffer.concat([buffer, value]);
    }
    parts++;
    if (done) {
      break;
    }
  }

  gcTick(true);
  expect(buffer.toString("utf8")).toBe(content);
  expect(parts).toBeGreaterThan(1);
});
