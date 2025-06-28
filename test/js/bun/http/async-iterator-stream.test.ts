import { spawn } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("Streaming body via", () => {
  test("async generator function", async () => {
    using server = Bun.serve({
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
  });

  test("async generator function throws an error but continues to send the headers", async () => {
    const onMessage = mock(async url => {
      const response = await fetch(url);
      expect(response.headers.get("X-Hey")).toBe("123");
      subprocess?.kill();
    });

    await using subprocess = spawn({
      cwd: import.meta.dirname,
      cmd: [bunExe(), "async-iterator-throws.fixture.js"],
      env: bunEnv,
      ipc: onMessage,
      stdout: "inherit",
      stderr: "pipe",
    });

    let [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()]);
    expect(exitCode).toBeInteger();
    expect(stderr).toContain("error: Oops");
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  test("async generator aborted doesn't crash", async () => {
    var aborter = new AbortController();
    using server = Bun.serve({
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
    }
  });

  test("[Symbol.asyncIterator]", async () => {
    using server = Bun.serve({
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
  });

  test("[Symbol.asyncIterator] with a custom iterator", async () => {
    using server = Bun.serve({
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
          for (let method of ["arrayBuffer", "bytes", "text"]) {
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
