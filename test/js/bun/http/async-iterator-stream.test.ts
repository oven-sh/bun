import { spawn } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("Streaming body via", () => {
  // The two-chunk tests hold the generator until the client has read the first chunk. That is what
  // proves the body streams; a sleep does not, because fetch hands the reader everything its HTTP
  // thread has received since the last read as one chunk.
  test("async generator function", async () => {
    const firstChunkRead = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response(async function* yo() {
          yield "Hello, ";
          await firstChunkRead.promise;
          yield Buffer.from("world!");
          return "not a chunk";
        });
      },
    });

    const res = await fetch(`${server.url}/`);
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(new TextDecoder().decode(chunk));
      firstChunkRead.resolve();
    }

    expect(chunks).toEqual(["Hello, ", "world!"]);
  });

  test("a hand-written async iterator without return() completes", async () => {
    // https://github.com/oven-sh/bun/pull/33193: the native converter crashed here.
    let i = 0;
    const text = await new Response({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve(i++ === 0 ? { value: "a", done: false } : { done: true }),
      }),
    }).text();
    expect(text).toBe("a");
  });

  // An erroring async-iterable body delivers the error to the consumer exactly once. These assert
  // in a subprocess because a second, internal rejection would surface as an unhandledRejection.
  test("an iterator whose next() rejects and has no throw() rejects the body", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `await new Response({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("nrej")), return: () => Promise.resolve({ done: true }) }) }).text().then(() => console.log("resolved"), e => console.log("rejected", e.constructor.name, e.message));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("rejected Error nrej");
    expect(stderr).not.toContain("nrej");
    expect(exitCode).toBe(0);
  });

  test("a throwing async generator body does not leak an unhandled rejection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `async function* gen() {
          yield new Uint8Array([1, 2, 3]);
          throw new Error("gen boom");
        }
        await new Response(gen()).text().then(
          () => { throw new Error("should have rejected"); },
          e => console.log("caught:", e.message),
        );`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("caught: gen boom\n");
    // A second, internal rejection would print the error again and exit nonzero.
    expect(stderr).not.toContain("gen boom");
    expect(exitCode).toBe(0);
  });

  test("an iterator returning thenables (non-native promises) streams", async () => {
    let n = 0;
    const iterator = {
      next() {
        const i = n++;
        return {
          then(resolve: (v: any) => void) {
            queueMicrotask(() => resolve(i < 3 ? { value: "t" + i, done: false } : { done: true }));
          },
        };
      },
      return: () => Promise.resolve({ done: true }),
    };
    const text = await new Response({ [Symbol.asyncIterator]: () => iterator }).text();
    expect(text).toBe("t0t1t2");
  });

  test("a non-object iteration result rejects with a TypeError", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `await new Response({ [Symbol.asyncIterator]: () => ({ next: async () => undefined }) }).text().then(() => console.log("resolved"), e => console.log("rejected", e.constructor.name));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("rejected TypeError");
    expect(stderr).not.toContain("TypeError");
    expect(exitCode).toBe(0);
  });

  // The generator fails before producing any chunk. The status and headers
  // were already committed to uWS, so the server closes the connection without
  // a complete response instead of sending them with an empty body and a clean
  // chunked terminator.
  test("async generator function throws an error before its first chunk closes the connection", async () => {
    let outcome: string | undefined;
    const onMessage = mock(async url => {
      outcome = await fetch(url).then(
        response => `resolved ${response.status}`,
        (err: any) => `rejected ${err.code}`,
      );
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

    let [exitCode, stderr] = await Promise.all([subprocess.exited, subprocess.stderr.text()]);
    expect(exitCode).toBeInteger();
    expect(outcome).toBe("rejected ECONNRESET");
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
    const firstChunkRead = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response({
          async *[Symbol.asyncIterator]() {
            var controller = yield "my string goes here\n";
            var controller2 = yield Buffer.from("my buffer goes here\n");
            await firstChunkRead.promise;
            yield Buffer.from("end!\n");
            if (controller !== controller2 || typeof controller.sinkId !== "number") {
              throw new Error("Controller mismatch");
            }
            return "not a chunk";
          },
        });
      },
    });

    const res = await fetch(`${server.url}/`);
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(new TextDecoder().decode(chunk));
      firstChunkRead.resolve();
    }

    // The two yields before the await are one chunk: the response sink queues
    // small writes and flushes them once the microtask queue drains.
    expect(chunks).toEqual(["my string goes here\nmy buffer goes here\n", "end!\n"]);
  });

  test("[Symbol.asyncIterator] with a custom iterator", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(req) {
        const results = [
          { value: "Hello, ", done: false },
          { value: Buffer.from("world!"), done: false },
          { value: Buffer.from("not a chunk"), done: true },
        ];
        return new Response({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                await Bun.sleep(30);
                return results.shift();
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

  // IteratorStepValue semantics, like `for await`, ReadableStream.from() and node: once `done`
  // is true the result's `value` is the iterator's return value, not a chunk of the body.
  describe("the value of a done result is not part of the body", () => {
    async function* gen() {
      yield "chunk;";
      return "RETURN-VALUE";
    }

    test("async generator return value", async () => {
      expect(await new Response(gen()).text()).toBe("chunk;");
      expect(await new Response(gen).text()).toBe("chunk;");
      expect(await new Request("https://example.com", { method: "POST", body: gen() }).text()).toBe("chunk;");
    });

    test("hand-written async iterator", async () => {
      let i = 0;
      const body = {
        [Symbol.asyncIterator]: () => ({
          next: async () => (i++ === 0 ? { value: "a", done: false } : { value: "X", done: true }),
        }),
      };
      expect(await new Response(body).text()).toBe("a");
    });

    test("sync generator under Symbol.asyncIterator", async () => {
      const body = {
        [Symbol.asyncIterator]: function* () {
          yield "s1";
          return "SYNC-RETURN";
        },
      };
      expect(await new Response(body).text()).toBe("s1");
    });

    test("Bun.serve response body", async () => {
      using server = Bun.serve({
        port: 0,
        fetch: () => new Response(gen()),
      });
      const res = await fetch(server.url);
      expect(await res.text()).toBe("chunk;");
    });
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
        yield Buffer.from('world! #4"');
        return "not a chunk";
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
