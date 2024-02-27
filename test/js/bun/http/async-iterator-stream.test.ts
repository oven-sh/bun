import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv } from "harness";
import path from "path";

describe("Streaming body via", () => {
  test("async generator function", async () => {
    const server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response(async function* yo() {
          yield "Hello, ";
          await Bun.sleep(30);
          yield Buffer.from("world!");
          return "!";
        });
      },
    });

    const res = await fetch(`${server.url}/`);
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe("Hello, world!!");
    expect(chunks).toHaveLength(2);
    server.stop(true);
  });

  test("async generator function throws an error but continues to send the headers", async () => {
    const server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response(
          async function* () {
            throw new Error("Oops");
          },
          {
            headers: {
              "X-Hey": "123",
            },
          },
        );
      },
    });

    const res = await fetch(server.url);
    expect(res.headers.get("X-Hey")).toBe("123");
    server.stop(true);
  });

  test("async generator aborted doesn't crash", async () => {
    var aborter = new AbortController();
    const server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response(
          async function* yo() {
            queueMicrotask(() => aborter.abort());
            yield "123";
            await Bun.sleep(0);
          },
          {
            headers: {
              "X-Hey": "123",
            },
          },
        );
      },
    });
    try {
      const res = await fetch(`${server.url}/`, { signal: aborter.signal });
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect(e.name).toBe("AbortError");
    } finally {
      server.stop(true);
    }
  });

  test("[Symbol.asyncIterator]", async () => {
    const server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response({
          async *[Symbol.asyncIterator]() {
            var controller = yield "my string goes here\n";
            var controller2 = yield Buffer.from("my buffer goes here\n");
            await Bun.sleep(30);
            yield Buffer.from("end!\n");
            if (controller !== controller2 || typeof controller.sinkId !== "number") {
              throw new Error("Controller mismatch");
            }
            return "!";
          },
        });
      },
    });

    const res = await fetch(`${server.url}/`);
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe("my string goes here\nmy buffer goes here\nend!\n!");
    expect(chunks).toHaveLength(2);
    server.stop(true);
  });

  test("[Symbol.asyncIterator] with a custom iterator", async () => {
    const server = Bun.serve({
      port: 0,

      async fetch(req) {
        var hasRun = false;
        return new Response({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                await Bun.sleep(30);

                if (hasRun) {
                  return { value: Buffer.from("world!"), done: true };
                }

                hasRun = true;
                return { value: "Hello, ", done: false };
              },
            };
          },
        });
      },
    });

    const res = await fetch(server.url);
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe("Hello, world!");
    // TODO:
    // expect(chunks).toHaveLength(2);
    server.stop(true);
  });

  test("yield", async () => {
    const response = new Response({
      [Symbol.asyncIterator]: async function* () {
        const controller = yield "hello";
        await controller.end();
      },
    });

    expect(await response.text()).toBe("hello");
  });

  const callbacks = [
    {
      fn: async function* () {
        yield '"Hello, ';
        yield Buffer.from('world! #1"');
        return;
      },
      expected: '"Hello, world! #1"',
    },
    {
      fn: async function* () {
        yield '"Hello, ';
        await Bun.sleep(30);
        yield Buffer.from('world! #2"');
        return;
      },
      expected: '"Hello, world! #2"',
    },
    {
      fn: async function* () {
        yield '"Hello, ';
        await 42;
        yield Buffer.from('world! #3"');
        return;
      },
      expected: '"Hello, world! #3"',
    },
    {
      fn: async function* () {
        yield '"Hello, ';
        await 42;
        return Buffer.from('world! #4"');
      },
      expected: '"Hello, world! #4"',
    },
  ];

  for (let { fn, expected } of callbacks) {
    describe(expected, () => {
      for (let bodyInit of [fn, { [Symbol.asyncIterator]: fn }] as const) {
        for (let [label, constructFn] of [
          ["Response", () => new Response(bodyInit)],
          ["Request", () => new Request({ "url": "https://example.com", body: bodyInit })],
        ]) {
          for (let method of ["arrayBuffer", "text"]) {
            test(`${label}(${method})`, async () => {
              const result = await constructFn()[method]();
              expect(Buffer.from(result)).toEqual(Buffer.from(expected));
            });
          }

          test(`${label}(json)`, async () => {
            const result = await constructFn().json();
            expect(result).toEqual(JSON.parse(expected));
          });

          test(`${label}(blob)`, async () => {
            const result = await constructFn().blob();
            expect(await result.arrayBuffer()).toEqual(await new Blob([expected]).arrayBuffer());
          });
        }
      }
    });
  }
});
