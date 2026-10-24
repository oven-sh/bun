import { spawn } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";
import { asyncIterableBodyShapes, settled } from "../../web/streams/async-iterable-body-shapes";

describe.concurrent("Streaming body via", () => {
  test("async generator function", async () => {
    const received = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response(async function* yo() {
          yield "Hello, ";
          await received.promise;
          yield Buffer.from("world!");
          return "not a chunk";
        });
      },
    });

    const res = await fetch(`${server.url}/`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.body!) {
      chunks.push(chunk);
      received.resolve();
    }

    expect(Buffer.concat(chunks).toString()).toBe("Hello, world!");
    expect(chunks).toHaveLength(2);
  });

  test("a hand-written async iterator without return() completes", async () => {
    // https://github.com/oven-sh/bun/pull/33193: the native converter crashed here.
    let i = 0;
    const text = await new Response({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve(i++ === 0 ? { value: "a", done: false } : ({ done: true } as any)),
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

  // An error from the generator with one of these codes reaches the consumer like any other error,
  // whether the generator throws it or a native call in the generator does. The upload throws once
  // its request is at the server, so the server sees an aborted body and not a complete one. text()
  // and read() keep nothing alive: one that never settles shows up as a missing outcome.
  test.each([
    ["ERR_INVALID_STATE", "const locked = new ReadableStream(); locked.getReader(); await locked.cancel();"],
    ["ERR_INVALID_THIS", "ReadableStream.prototype.tee.call({});"],
  ])("an %s error from the generator rejects the body", async (code, nativeThrow) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `async function* coded(gate) {
          yield "first;";
          await gate;
          throw Object.assign(new TypeError("coded"), { code: "${code}" });
        }
        async function* native(gate) {
          yield "first;";
          await gate;
          ${nativeThrow}
        }
        async function drain(reader) {
          while (!(await reader.read()).done);
          return "drained";
        }
        const outcomes = {};
        const record = (name, promise) =>
          promise.then(v => (outcomes[name] = "resolved " + v), e => (outcomes[name] = "rejected " + e.code));
        const atServer = { coded: Promise.withResolvers(), native: Promise.withResolvers() };
        const requestBodies = [];
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            const name = new URL(req.url).pathname.slice(1);
            atServer[name].resolve();
            const body = req.text().then(text => "complete, " + text.length + " bytes", () => "aborted");
            requestBodies.push(body.then(v => (outcomes[name + " request body"] = v)));
            await body;
            return new Response("done");
          },
        });
        const uploads = [];
        for (const gen of [coded, native]) {
          record(gen.name + " text()", new Response(gen()).text());
          record(gen.name + " read()", drain(new Response(gen()).body.getReader()));
          const body = gen(atServer[gen.name].promise);
          uploads.push(
            record(gen.name + " upload", fetch(server.url + gen.name, { method: "POST", body }).then(r => r.text())),
          );
        }
        Promise.all(uploads)
          .then(() => Promise.all(requestBodies))
          .then(() => server.stop(true));
        process.once("beforeExit", () => {
          for (const name of Object.keys(outcomes).sort()) console.log(name + ": " + outcomes[name]);
        });`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim().split(/\r?\n/)).toEqual([
      `coded read(): rejected ${code}`,
      "coded request body: aborted",
      `coded text(): rejected ${code}`,
      `coded upload: rejected ${code}`,
      `native read(): rejected ${code}`,
      "native request body: aborted",
      `native text(): rejected ${code}`,
      `native upload: rejected ${code}`,
    ]);
    expect(stderr).not.toContain(code);
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
    const text = await new Response({ [Symbol.asyncIterator]: () => iterator as any }).text();
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
    } catch (e: any) {
      expect(e).toBeInstanceOf(DOMException);
      expect(e.name).toBe("AbortError");
    }
  });

  test("[Symbol.asyncIterator]", async () => {
    const received = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,

      async fetch(req) {
        return new Response({
          async *[Symbol.asyncIterator]() {
            var controller = yield "my string goes here\n";
            var controller2 = yield Buffer.from("my buffer goes here\n");
            await received.promise;
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
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.body!) {
      chunks.push(chunk);
      received.resolve();
    }

    expect(Buffer.concat(chunks).toString()).toBe("my string goes here\nmy buffer goes here\nend!\n");
    expect(chunks).toHaveLength(2);
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
                return results.shift()!;
              },
            };
          },
        });
      },
    });

    const res = await fetch(server.url);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.body!) {
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
      expect(await new Response(body as any).text()).toBe("s1");
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
        ] as const) {
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

// A raw client that reads the response until `until` shows up. It does not hang up by itself.
async function connectAndRead(server: Bun.Server<undefined>, until: string) {
  const socket = net.connect(server.port!, "127.0.0.1");
  const seen = Promise.withResolvers<void>();
  let raw = "";
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"));
  socket.on("data", data => {
    raw += data.toString("latin1");
    if (raw.includes(until)) seen.resolve();
  });
  socket.on("error", seen.reject);
  socket.on("close", () => seen.resolve());
  await seen.promise;
  return socket;
}

// When the connection of a streaming response goes away, Bun.serve cancels the body with the
// connection-closed AbortError. An async-iterable body is closed the way `for await` leaves an
// iterator: return(). The error is not thrown into it.
describe.each(asyncIterableBodyShapes)("Bun.serve: %s is closed with return()", (_, make) => {
  // The body is the Response body itself, or it sits behind a stream that the server pumps.
  describe.each([
    ["as the Response body", (body: AsyncIterable<any>) => new Response(body)],
    [
      "behind pipeThrough()",
      (body: AsyncIterable<any>) => new Response(new Response(body).body!.pipeThrough(new TransformStream())),
    ],
    [
      "behind tee(), the other branch cancelled",
      (body: AsyncIterable<any>) => {
        const [a, b] = new Response(body).body!.tee();
        b.cancel();
        return new Response(a);
      },
    ],
  ])("%s", (_, wrap) => {
    test.concurrent("when the client hangs up", async () => {
      const shape = make();
      const aborted = Promise.withResolvers<void>();
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          req.signal.addEventListener("abort", () => aborted.resolve());
          return wrap(shape.body);
        },
      });
      const socket = await connectAndRead(server, "chunk");
      socket.destroy();
      await aborted.promise;
      expect(await settled(shape)).toEqual(shape.expected);
    });
  });

  test.concurrent("when server.stop(true) closes the connection", async () => {
    const shape = make();
    const server = Bun.serve({ port: 0, fetch: () => new Response(shape.body) });
    const socket = await connectAndRead(server, "chunk");
    try {
      await server.stop(true);
      expect(await settled(shape)).toEqual(shape.expected);
    } finally {
      socket.destroy();
    }
  });
});

// setInterval() of node:timers/promises gives an iterator with return() and no throw(). Once
// the server stopped, a leaked interval is the only thing that can keep the child alive. The
// unref'd timer does not: it only ends a child that a leaked interval keeps alive.
test.concurrent("Bun.serve: a timers/promises interval as the body is cleared when the client hangs up", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import net from "node:net";
      import { setInterval as every } from "node:timers/promises";
      const aborted = Promise.withResolvers();
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          req.signal.addEventListener("abort", () => aborted.resolve());
          return new Response(every(1, "data: ping\\n\\n"), { headers: { "Content-Type": "text/event-stream" } });
        },
      });
      const socket = net.connect(server.port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n"));
      socket.on("data", data => {
        if (String(data).includes("ping")) socket.destroy();
      });
      await aborted.promise;
      await server.stop(true);
      console.log("stopped");
      setTimeout(() => {
        console.log("an interval is still running");
        process.exit(1);
      }, 2000).unref();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("stopped\n");
  expect(exitCode).toBe(0);
});

// The consumer failed, not the iterator: it refused a chunk. The iterator is closed the way
// `for await` closes one when the loop body throws, and the body rejects with the consumer's error.
describe.concurrent("an async-iterable body whose chunk the consumer refuses", () => {
  const refused = () => Symbol("not a chunk");
  const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));

  test.each(asyncIterableBodyShapes)("%s is closed with return()", async (_, make) => {
    const shape = make({ chunk: refused() });
    await expect(new Response(shape.body).text()).rejects.toBeInstanceOf(TypeError);
    expect(await settled(shape)).toEqual(shape.expected);
  });

  test("an iterator with next() and throw() only gets no call", async () => {
    const calls: string[] = [];
    const body = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: refused() }),
        throw: () => (calls.push("throw"), Promise.resolve({ done: true, value: undefined })),
      }),
    };
    await expect(new Response(body as any).text()).rejects.toBeInstanceOf(TypeError);
    await macrotask();
    expect(calls).toEqual([]);
  });

  // What return() throws replaces the consumer's error. What its promise rejects with does not.
  test.each([
    [
      "throws",
      () => {
        throw new Error("return() failed");
      },
      Error,
    ],
    ["rejects", () => Promise.reject(new Error("return() failed")), TypeError],
  ])("a return() that %s", async (_, returns, expected) => {
    let calls = 0;
    const body = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: refused() }),
        return() {
          calls++;
          return returns();
        },
      }),
    };
    const error = await new Response(body as any).text().then(
      () => undefined,
      e => e,
    );
    expect({ constructor: error?.constructor, calls }).toEqual({ constructor: expected, calls: 1 });
  });

  // The consumer is told at once. return() is called, and nothing waits for what it gives back:
  // a cleanup that never ends holds back neither the error nor the connection.
  describe("is told while the cleanup is still pending:", () => {
    const never = () => new Promise<never>(() => {});
    const handWritten = (closed: { calls: number }, result: () => unknown) => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: refused() }),
        return: () => (closed.calls++, result()),
      }),
    });
    // Each body counts its cleanups in `closed.calls`. None of the cleanups ever ends.
    const bodies: [name: string, make: (closed: { calls: number }) => AsyncIterable<unknown>][] = [
      ["a return() whose promise never settles", closed => handWritten(closed, never)],
      ["a return() whose thenable never calls back", closed => handWritten(closed, () => ({ then() {} }))],
      [
        "a generator whose finally never ends",
        closed =>
          (async function* () {
            try {
              yield refused();
            } finally {
              closed.calls++;
              await never();
            }
          })(),
      ],
      [
        "a generator over an iterator whose return() never settles",
        closed =>
          (async function* () {
            for await (const chunk of handWritten(closed, never)) yield chunk;
          })(),
      ],
      [
        // Built-ins only. The return() of this iterator cancels its branch, and that settles
        // only once the other branch is cancelled too.
        "the iterator of a tee() branch whose other branch is unread",
        closed => {
          const source = new ReadableStream({
            start(controller) {
              controller.enqueue({ not: "a chunk" });
            },
          });
          const iterator = source.tee()[0].values();
          const cancelBranch = iterator.return!;
          iterator.return = value => (closed.calls++, cancelBranch.call(iterator, value));
          return iterator;
        },
      ],
    ];

    // What the consumer hears. Nothing here waits on I/O, so a consumer that heard nothing
    // after these macrotasks waits on the cleanup.
    async function heard(consumed: Promise<unknown>) {
      let outcome = "nothing";
      consumed.then(
        () => (outcome = "a result"),
        error => (outcome = `a ${error?.constructor?.name}`),
      );
      for (let turn = 0; turn < 50 && outcome === "nothing"; turn++) await macrotask();
      return outcome;
    }

    const consumers: [name: string, consume: (response: Response) => Promise<unknown>][] = [
      ["text()", response => response.text()],
      ["arrayBuffer()", response => response.arrayBuffer()],
      ["reader.read()", response => response.body!.getReader().read()],
      [
        "for await",
        async response => {
          for await (const _ of response.body!);
        },
      ],
      ["pipeTo()", response => response.body!.pipeTo(new WritableStream())],
      ["Bun.readableStreamToText()", response => Bun.readableStreamToText(response.body!)],
    ];

    describe.each(bodies)("%s:", (_, make) => {
      test.each(consumers)("%s", async (_, consume) => {
        const closed = { calls: 0 };
        expect(await heard(consume(new Response(make(closed) as any)))).toBe("a TypeError");
        expect(closed.calls).toBe(1);
      });

      // A consumer that comes back after the failure gets the same error. It does not get a
      // clean end because the cleanup has not finished yet.
      test("a later read(), cancel() and closed", async () => {
        const closed = { calls: 0 };
        const reader = new Response(make(closed) as any).body!.getReader();
        const outcomes = [await heard(reader.read()), await heard(reader.read()), await heard(reader.cancel())];
        outcomes.push(await heard(reader.closed));
        expect(outcomes).toEqual(["a TypeError", "a TypeError", "a TypeError", "a TypeError"]);
        expect(closed.calls).toBe(1);
      });
    });

    // With idleTimeout: 0 only the failed body can close the connection. Bun.serve reports the
    // error of a response body on stderr, not through the `error` option. A connection that stays
    // open keeps the child alive after this test timed out, so the unref'd timer ends it.
    test("Bun.serve closes the connection", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          import net from "node:net";
          setTimeout(() => process.exit(1), 30_000).unref();
          const never = () => new Promise(() => {});
          const closed = { calls: 0 };
          const refused = () => Symbol("not a chunk");
          const handWritten = result => ({
            [Symbol.asyncIterator]: () => ({
              next: async () => ({ done: false, value: refused() }),
              return: () => (closed.calls++, result()),
            }),
          });
          const bodies = {
            "a promise that never settles": () => handWritten(never),
            "a thenable that never calls back": () => handWritten(() => ({ then() {} })),
            "a finally that never ends": () =>
              (async function* () {
                try {
                  yield refused();
                } finally {
                  closed.calls++;
                  await never();
                }
              })(),
            "a generator over an iterator whose return() never settles": () =>
              (async function* () {
                for await (const chunk of handWritten(never)) yield chunk;
              })(),
          };
          for (const [name, make] of Object.entries(bodies)) {
            closed.calls = 0;
            let errorOptionCalls = 0;
            const server = Bun.serve({
              port: 0,
              idleTimeout: 0,
              error: () => (errorOptionCalls++, new Response("from the error option")),
              fetch: () => new Response(make()),
            });
            let bytes = 0;
            const socket = net.connect(server.port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n"));
            socket.on("error", () => {});
            socket.on("data", data => (bytes += data.length));
            await new Promise(resolve => socket.on("close", resolve));
            console.log(name + ": closed after " + bytes + " bytes, return() calls: " + closed.calls + ", error option calls: " + errorOptionCalls);
            await server.stop(true);
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.split("\n")).toEqual([
        "a promise that never settles: closed after 0 bytes, return() calls: 1, error option calls: 0",
        "a thenable that never calls back: closed after 0 bytes, return() calls: 1, error option calls: 0",
        "a finally that never ends: closed after 0 bytes, return() calls: 1, error option calls: 0",
        "a generator over an iterator whose return() never settles: closed after 0 bytes, return() calls: 1, error option calls: 0",
        "",
      ]);
      expect(stderr.match(/^TypeError/gm)).toHaveLength(4);
      expect(exitCode).toBe(0);
    });
  });
});

// return() can hand back something that only starts its work in then(), like a Bun.sql query.
// Bun adopts what return() gives back the way `await` does, so that work starts. Only cancel()
// waits for it to finish.
describe.concurrent("an async-iterable body whose return() gives back", () => {
  const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));
  const results: [name: string, make: (started: () => void) => unknown][] = [
    [
      "a thenable",
      started => ({
        then(resolve: (result: unknown) => void) {
          started();
          resolve({ done: true, value: undefined });
        },
      }),
    ],
    [
      "a Promise subclass that starts in then()",
      started =>
        new (class extends Promise<unknown> {
          then<A = unknown, B = never>(
            onfulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
            onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
          ): Promise<A | B> {
            started();
            return super.then(onfulfilled, onrejected);
          }
        })(resolve => resolve({ done: true, value: undefined })),
    ],
  ];
  const bodyOf = (chunks: unknown[], result: () => unknown) => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
      return: result,
    }),
  });

  describe.each(results)("%s", (_, make) => {
    test("after the last chunk", async () => {
      let started = 0;
      const body = bodyOf(["chunk"], () => make(() => started++));
      expect(await new Response(body as any).text()).toBe("chunk");
      for (let turn = 0; turn < 50 && !started; turn++) await macrotask();
      expect(started).toBe(1);
    });

    test("after a refused chunk", async () => {
      let started = 0;
      const body = bodyOf([Symbol("not a chunk")], () => make(() => started++));
      await expect(new Response(body as any).text()).rejects.toBeInstanceOf(TypeError);
      expect(started).toBe(1);
    });

    test("after the client hung up", async () => {
      let started = 0;
      const aborted = Promise.withResolvers<void>();
      let first = true;
      const body = {
        [Symbol.asyncIterator]: () => ({
          // One chunk, then nothing: the client hangs up on a quiet stream.
          next: () =>
            first ? ((first = false), Promise.resolve({ done: false, value: "chunk" })) : new Promise(() => {}),
          return: () => make(() => started++),
        }),
      };
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          req.signal.addEventListener("abort", () => aborted.resolve());
          return new Response(body as any);
        },
      });
      const socket = await connectAndRead(server, "chunk");
      socket.destroy();
      await aborted.promise;
      for (let turn = 0; turn < 50 && !started; turn++) await macrotask();
      expect(started).toBe(1);
    });
  });
});

// The body gave its last chunk, so the consumer already has everything. return() is still
// called once. What its promise does afterwards changes nothing for the consumer.
describe.concurrent("an async-iterable body that ends by itself", () => {
  // text(): the direct controller closes the source when the body ends. Bun.serve and Bun.write():
  // a native sink ends the body without that close. A rejection nobody handles would print the
  // error and exit with code 1.
  test("a return() whose promise rejects is not reported", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { rmSync } from "node:fs";
         import { tmpdir } from "node:os";
         import { join } from "node:path";
         let calls = 0;
         const rejections = {
           "at once": () => Promise.reject(new Error("the cleanup failed")),
           "later": () => new Promise((_, reject) => setImmediate(() => reject(new Error("the cleanup failed")))),
         };
         const body = rejected => {
           const chunks = ["chunk1;", "chunk2;"];
           return {
             [Symbol.asyncIterator]: () => ({
               next: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
               return: () => (calls++, rejected()),
             }),
           };
         };
         const consumers = {
           "text()": rejected => new Response(body(rejected)).text(),
           "Bun.serve": async rejected => {
             await using server = Bun.serve({ port: 0, fetch: () => new Response(body(rejected)) });
             return await (await fetch(server.url)).text();
           },
           "Bun.write()": async rejected => {
             const path = join(tmpdir(), "async-iterator-stream-" + process.pid + ".txt");
             try {
               await Bun.write(path, new Response(body(rejected)));
               return await Bun.file(path).text();
             } finally {
               rmSync(path, { force: true });
             }
           },
         };
         for (const [when, rejected] of Object.entries(rejections)) {
           for (const [name, consume] of Object.entries(consumers)) {
             calls = 0;
             const got = await consume(rejected);
             for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
             console.log(name + ", rejects " + when + ": " + got + " return() calls: " + calls);
           }
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n")).toEqual([
      "text(), rejects at once: chunk1;chunk2; return() calls: 1",
      "Bun.serve, rejects at once: chunk1;chunk2; return() calls: 1",
      "Bun.write(), rejects at once: chunk1;chunk2; return() calls: 1",
      "text(), rejects later: chunk1;chunk2; return() calls: 1",
      "Bun.serve, rejects later: chunk1;chunk2; return() calls: 1",
      "Bun.write(), rejects later: chunk1;chunk2; return() calls: 1",
      "",
    ]);
    expect(stderr).not.toContain("the cleanup failed");
    expect(exitCode).toBe(0);
  });

  // Nothing of a finished body hangs on what return() gave back: one promise that stays pending
  // for the life of the process does not keep the bodies that shared it.
  test("is not kept alive by a return() whose promise stays pending", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { heapStats } from "bun:jsc";
         const pending = new Promise(() => {});
         const body = () => {
           const chunks = ["chunk"];
           return {
             [Symbol.asyncIterator]: () => ({
               next: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
               return: () => pending,
             }),
           };
         };
         let read = 0;
         for (let i = 0; i < 100; i++) read += (await new Response(body()).text()).length;
         for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
         Bun.gc(true);
         Bun.gc(true);
         console.log(JSON.stringify({ read, kept: heapStats().objectTypeCounts.AsyncIteratorSourceOperation ?? 0 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { read, kept } = JSON.parse(stdout);
    expect(read).toBe(500);
    // 100 without the fix. Not an exact 0: the count is taken from a live heap.
    expect(kept).toBeLessThan(10);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// The iterator failed by itself. Like `for await`, nothing more is called on it.
describe.concurrent("an async-iterable body whose iterator fails is not called again when", () => {
  const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));
  const failed = () => new Error("next() failed");
  // Bun reads `next` once when it makes the body, then once for each chunk.
  const nextThatThrowsOnRead = (read: number) => {
    let reads = 0;
    return {
      get next() {
        if (++reads === read) throw failed();
        return async () => ({ done: false, value: "chunk" });
      },
    };
  };
  test.each([
    [
      "next() throws",
      {
        next() {
          throw failed();
        },
      },
      "next() failed",
    ],
    ["next() rejects at once", { next: () => Promise.reject(failed()) }, "next() failed"],
    [
      "next() rejects later",
      {
        async next() {
          await macrotask();
          throw failed();
        },
      },
      "next() failed",
    ],
    ["next() gives a result that is not an object", { next: async () => 1 }, "not an object"],
    [
      "the `done` getter of a result throws",
      {
        next: async () => ({
          get done() {
            throw failed();
          },
        }),
      },
      "next() failed",
    ],
    ["the `next` getter throws for the first chunk", nextThatThrowsOnRead(2), "next() failed"],
    ["the `next` getter throws for the second chunk", nextThatThrowsOnRead(3), "next() failed"],
  ])("%s", async (_, iterator, message) => {
    const calls: string[] = [];
    const body = {
      [Symbol.asyncIterator]: () =>
        Object.defineProperties(iterator, {
          return: { value: () => (calls.push("return"), Promise.resolve({ done: true, value: undefined })) },
          throw: { value: () => (calls.push("throw"), Promise.resolve({ done: true, value: undefined })) },
        }),
    };
    await expect(new Response(body as any).text()).rejects.toThrow(message);
    await macrotask();
    expect(calls).toEqual([]);
  });
});
