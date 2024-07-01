import { Socket } from "bun";
import { it, expect } from "bun:test";
import { gcTick } from "harness";

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
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

  const res = await fetch(server.url, { verbose: true });
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
});

it("fetch() with a redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
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

  const url = new URL("hey", server.url);
  const res = await fetch(url, { verbose: true });
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
});

it("fetch() with a protocol-relative redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req, server) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer(), {
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
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
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
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
});

it("fetch() with a gzip response works (multiple chunks, TCP server)", async done => {
  const compressed = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
  var socketToClose!: Socket;
  const server = Bun.listen({
    hostname: "localhost",
    port: 0,
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

  const res = await fetch(`http://${server.hostname}:${server.port}`);
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(new Buffer(await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer())),
  ).toBe(true);
  socketToClose.end();
  server.stop();
  done();
});
