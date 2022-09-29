import { file, gc, serve, ServeOptions } from "bun";
import { afterEach, describe, expect, it, test } from "bun:test";
import { readFileSync } from "fs";

afterEach(() => Bun.gc(true));

var port = 40001;

async function runInServer(
  opts: ServeOptions,
  cb: (url: string) => void | Promise<void>
) {
  var server;
  server = Bun.serve({
    ...opts,
    port: port++,
    fetch(req) {
      try {
        return opts.fetch(req);
      } catch (e) {
        console.error(e.message);
        console.log(e.stack);
        throw e;
      }
    },
    error(err) {
      console.log(err.message);
      console.log(err.stack);
      throw err;
    },
  });
  try {
    await cb(`http://${server.hostname}:${server.port}`);
  } catch (e) {
    throw e;
  } finally {
    setTimeout(() => {
      server && server.stop();
      server = undefined;
    }, 10);
  }
}

describe("reader works", function () {
  var bytes = new Uint8Array(64 * 64 * 64 * 64);
  bytes.fill(1, 0, 1024);
  bytes.fill(2, -1024, 1024);
  console.log("here");

  for (let huge of [
    bytes,
    bytes.buffer,
    new Blob([bytes]),
    new Uint16Array(bytes.buffer),
    new Uint32Array(bytes.buffer),
    new Float32Array(bytes.buffer),
    new Float64Array(bytes.buffer),
    new BigInt64Array(bytes.buffer),
    new BigUint64Array(bytes.buffer),
    new DataView(bytes.buffer),
    new Int16Array(bytes.buffer),
    new Int32Array(bytes.buffer),
    new Int8Array(bytes.buffer),
  ]) {
    it(`works with ${huge.constructor.name}`, async () => {
      var called = false;
      return await runInServer(
        {
          async fetch(req) {
            var reader = req.body.getReader();
            called = true;
            var buffers = [];
            while (true) {
              var { done, value } = await reader.read();
              if (done) break;
              buffers.push(value);
            }

            return new Response(new Blob(buffers), {
              headers: req.headers,
            });
          },
        },
        async (url) => {
          const response = await fetch(url, {
            body: huge,
            method: "POST",
            headers: {
              "content-type": "text/plain",
            },
          });
          expect(response.status).toBe(200);
          expect(Bun.hash(await response.arrayBuffer())).toBe(
            huge instanceof Blob
              ? Bun.hash(await huge.arrayBuffer())
              : huge instanceof ArrayBuffer
              ? Bun.hash(huge)
              : Bun.hash(huge.buffer || huge)
          );
          expect(response.headers.get("content-type")).toBe("text/plain");
          expect(called).toBe(true);
        }
      );
    });
  }
});

{
  const inputFixture = [
    ["Hello World", "Hello World"],
    ["Hello World 123", Buffer.from("Hello World 123").buffer],
    ["Hello World 456", Buffer.from("Hello World 456")],
  ];
  describe("echo", () => {
    for (const [name, input] of inputFixture) {
      test(`${name}`, async () => {
        return await runInServer(
          {
            fetch(req) {
              return new Response(req.body, { headers: req.headers });
            },
          },
          async (url) => {
            var request = new Request({
              body: input,
              method: "POST",
              url: url,
              headers: {
                "content-type": "text/plain",
              },
            });
            var response = await fetch(request);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("text/plain");
            expect(await response.text()).toBe(name);
          }
        );
      });
    }
  });
}
