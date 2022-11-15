import { concatArrayBuffers } from "bun";
import { it, describe, expect } from "bun:test";
import fs from "fs";
import { gc } from "./gc";

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  var server = Bun.serve({
    port: 6025,

    async fetch(req) {
      return new Response(
        await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer(),
        {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        },
      );
    },
  });

  const res = await fetch(
    `http://${server.hostname}:${server.port}`,
    {},
    { verbose: true },
  );
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(
      new Buffer(
        await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer(),
      ),
    ),
  ).toBe(true);
  server.stop();
});

it("fetch() with a gzip response works (one chunk)", async () => {
  var server = Bun.serve({
    port: 6023,

    fetch(req) {
      return new Response(Bun.file(import.meta.dir + "/fixture.html.gz"), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });

  const res = await fetch(`http://${server.hostname}:${server.port}`);
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(
      new Buffer(
        await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer(),
      ),
    ),
  ).toBe(true);
  server.stop();
});

it("fetch() with a gzip response works (multiple chunks)", async () => {
  var server = Bun.serve({
    port: 6024,

    fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            var chunks: ArrayBuffer[] = [];
            const buffer = await Bun.file(
              import.meta.dir + "/fixture.html.gz",
            ).arrayBuffer();
            var remaining = buffer;
            for (var i = 100; i < buffer.byteLength; i += 100) {
              var chunk = remaining.slice(0, i);
              remaining = remaining.slice(i);
              controller.write(chunk);
              chunks.push(chunk);
              await controller.flush();
            }

            await controller.flush();
            // sanity check
            expect(
              new Buffer(concatArrayBuffers(chunks)).equals(new Buffer(buffer)),
            ).toBe(true);

            controller.end();
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
    new Buffer(arrayBuffer).equals(
      new Buffer(
        await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer(),
      ),
    ),
  ).toBe(true);
  server.stop();
});

it("fetch() with a gzip response works (multiple chunks, TCP server)", async (done) => {
  const compressed = await Bun.file(
    import.meta.dir + "/fixture.html.gz",
  ).arrayBuffer();
  const server = Bun.listen({
    port: 4024,
    hostname: "0.0.0.0",
    socket: {
      async open(socket) {
        var corked: any[] = [];
        var cork = true;
        async function write(chunk) {
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
        await socket.end();
      },
      drain(socket) {},
    },
  });
  await 1;

  const res = await fetch(`http://${server.hostname}:${server.port}`, {});
  const arrayBuffer = await res.arrayBuffer();
  expect(
    new Buffer(arrayBuffer).equals(
      new Buffer(
        await Bun.file(import.meta.dir + "/fixture.html").arrayBuffer(),
      ),
    ),
  ).toBe(true);
  server.stop();
  done();
});
