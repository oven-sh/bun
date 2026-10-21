import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { Readable } from "node:stream";
import { asyncIterableBodyShapes, handWrittenBodyShapes, settled } from "../streams/async-iterable-body-shapes";
import { delegating, lazy } from "../streams/lazy-promise";

test("Response.bytes() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.bytes(); } catch {}
      try { resp.bytes(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

test("Response.arrayBuffer() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.arrayBuffer(); } catch {}
      try { resp.arrayBuffer(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

// Read in-process, the generator is driven by the reader: Bun pulls at most one chunk past what
// the reader took, then waits for the next read.
for (const [label, make] of [
  ["Response", (gen: AsyncIterable<Uint8Array>) => new Response(gen)],
  [
    "Request",
    (gen: AsyncIterable<Uint8Array>) => new Request("http://localhost/", { method: "POST", body: gen, duplex: "half" }),
  ],
] as const) {
  test(`new ${label}(asyncGenerator).body read in-process is pull-driven`, async () => {
    const macrotask = () => new Promise(resolve => setImmediate(resolve));
    const CHUNKS = 50;
    const CHUNK = 64 * 1024;
    let produced = 0;
    async function* gen() {
      for (let i = 0; i < CHUNKS; i++) {
        produced++;
        yield new Uint8Array(CHUNK).fill(i & 0xff);
      }
    }
    const reader = make(gen()).body!.getReader();
    const first = await reader.read();
    expect(first.value!.byteLength).toBe(CHUNK);
    // The reader is idle: the generator gets at most one chunk ahead.
    await macrotask();
    await macrotask();
    expect(produced).toBeLessThanOrEqual(2);

    const second = await reader.read();
    expect(second.value!.byteLength).toBe(CHUNK);

    let total = first.value!.byteLength + second.value!.byteLength;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    expect(total).toBe(CHUNKS * CHUNK);
    expect(produced).toBe(CHUNKS);
  });
}

// Canceling the body in-process reaches the generator: it is returned, not drained in the
// background.
test("breaking out of for await over an async generator body stops the generator", async () => {
  const macrotask = () => new Promise(resolve => setImmediate(resolve));
  let produced = 0;
  let finalized = false;
  async function* gen() {
    try {
      for (let i = 0; i < 50; i++) {
        produced++;
        yield new Uint8Array(64 * 1024);
      }
    } finally {
      finalized = true;
    }
  }
  let n = 0;
  for await (const chunk of new Response(gen()).body!) {
    expect(chunk.byteLength).toBe(64 * 1024);
    if (++n === 3) break;
  }
  await macrotask();
  await macrotask();
  expect({ n, finalized }).toEqual({ n: 3, finalized: true });
  expect(produced).toBeLessThanOrEqual(5);
});

// A reason does not change how the body is closed: return(), like `for await`. The reason is
// never thrown into the generator, which could catch it and go on.
test("cancel(reason) on an async generator body returns the generator: finally runs, catch does not", async () => {
  const reason = new Error("consumer gave up");
  const ran: string[] = [];
  async function* gen() {
    try {
      for (let i = 0; i < 50; i++) yield new Uint8Array(64 * 1024);
    } catch (e) {
      ran.push("catch");
      throw e;
    } finally {
      ran.push("finally");
    }
  }
  {
    const reader = new Response(gen()).body!.getReader();
    await reader.read();
    expect(await reader.cancel(reason)).toBeUndefined();
    expect(ran).toEqual(["finally"]);
  }

  async function* cleanupFails() {
    try {
      for (let i = 0; i < 50; i++) yield new Uint8Array(64 * 1024);
    } finally {
      throw new Error("cleanup failed");
    }
  }
  {
    const reader = new Response(cleanupFails()).body!.getReader();
    await reader.read();
    await expect(reader.cancel(reason)).rejects.toThrow("cleanup failed");
  }

  // Before the first read there is no pump yet; the iterator is still returned.
  const events: string[] = [];
  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          events.push("next");
          return { done: false, value: new Uint8Array(1) };
        },
        return: async () => {
          events.push("return");
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  const body = new Response(iterable).body!;
  expect(await body.cancel()).toBeUndefined();
  expect(events).toEqual(["return"]);

  // throw() is not a cleanup hook. An iterator that has only that one hears nothing.
  let thrown = 0;
  const reader = new Response({
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: false as const, value: new Uint8Array(64 * 1024) }),
      throw: async () => {
        thrown++;
        return { done: true as const, value: undefined };
      },
    }),
  }).body!.getReader();
  await reader.read();
  expect(await reader.cancel(reason)).toBeUndefined();
  expect(thrown).toBe(0);
});

const someReason = () => new Error("the consumer gave up");

// Each way reads at least one chunk first, so a generator body is inside its `try`.
const waysToLeave: [name: string, leave: (body: ReadableStream<Uint8Array>) => Promise<unknown>][] = [
  [
    // The control: a cancel with no reason closed the iterator before as well.
    "reader.cancel() (control)",
    async body => {
      const reader = body.getReader();
      await reader.read();
      expect(await reader.cancel()).toBeUndefined();
    },
  ],
  [
    "reader.cancel(reason)",
    async body => {
      const reader = body.getReader();
      await reader.read();
      expect(await reader.cancel(someReason())).toBeUndefined();
    },
  ],
  [
    "pipeTo() a sink whose write() throws",
    body =>
      body
        .pipeTo(
          new WritableStream({
            write() {
              throw someReason();
            },
          }),
        )
        .catch(() => {}),
  ],
  [
    "pipeTo() aborted by its signal",
    body => {
      const controller = new AbortController();
      return body
        .pipeTo(
          new WritableStream({
            write() {
              controller.abort();
            },
          }),
          { signal: controller.signal },
        )
        .catch(() => {});
    },
  ],
  [
    "pipeThrough(), then reader.cancel(reason)",
    async body => {
      const reader = body.pipeThrough(new TransformStream()).getReader();
      await reader.read();
      await reader.cancel(someReason());
    },
  ],
  [
    // The reason the source gets is an array of the two branch reasons.
    "tee(), both branches cancelled",
    async body => {
      const [a, b] = body.tee();
      const reader = a.getReader();
      await reader.read();
      await Promise.all([reader.cancel(), b.cancel()]);
    },
  ],
  [
    "Readable.fromWeb(body).destroy(error)",
    async body => {
      const readable = Readable.fromWeb(body as any);
      readable.on("error", () => {});
      await once(readable, "data");
      readable.destroy(someReason());
    },
  ],
];

describe.each(asyncIterableBodyShapes)("%s is closed with return() when the consumer leaves by", (_, make) => {
  test.concurrent.each(waysToLeave)("%s", async (_, leave) => {
    const shape = make();
    await leave(new Response(shape.body).body!);
    expect(await settled(shape)).toEqual(shape.expected);
  });

  test.concurrent("reader.cancel(reason) on a Request body", async () => {
    const shape = make();
    const request = new Request("http://localhost/", { method: "POST", body: shape.body, duplex: "half" } as any);
    const reader = request.body!.getReader();
    await reader.read();
    await reader.cancel(someReason());
    expect(await settled(shape)).toEqual(shape.expected);
  });
});

describe.each(handWrittenBodyShapes)("%s is closed with return() before its first next() by", (_, make) => {
  test.concurrent("body.cancel(reason)", async () => {
    const shape = make();
    expect(await new Response(shape.body).body!.cancel(someReason())).toBeUndefined();
    expect(await settled(shape)).toEqual(shape.expected);
  });

  test.concurrent("a fetch() that is aborted before it sends the body", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const shape = make();
    const controller = new AbortController();
    const response = fetch(server.url, { method: "POST", body: shape.body, signal: controller.signal } as any);
    controller.abort();
    await expect(response).rejects.toThrow("aborted");
    expect(await settled(shape)).toEqual(shape.expected);
  });
});

// next() may hand back a promise whose then() is not the built-in one, for example one that only
// starts its work there (Bun.$, a Bun.sql query). A body follows such a promise through then().
describe("next() returns a promise with its own then()", () => {
  const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));
  const decoder = new TextDecoder();
  const consumers: [string, (body: AsyncIterable<string>) => Promise<string>][] = [
    ["new Response(body).text()", body => new Response(body).text()],
    [
      "new Request(url, { body }).text()",
      body => new Request("http://localhost/", { method: "POST", body, duplex: "half" } as any).text(),
    ],
    [
      "a reader of new Response(body).body",
      async body => {
        let out = "";
        for await (const chunk of new Response(body).body!) out += decoder.decode(chunk);
        return out;
      },
    ],
  ];
  type Step = () => Promise<IteratorResult<string>>;
  // A body of "hello " and "world". `wrap` makes what next() returns from the work that gives a result.
  function iterable<P>(wrap: (step: Step) => P) {
    const returned: P[] = [];
    const chunks = ["hello ", "world"];
    const body = {
      [Symbol.asyncIterator]: () => ({
        next() {
          const n = returned.length;
          // A next() that is called without end is a failure, not a hang.
          if (n > 8) throw new Error("next() was called " + n + " times");
          returned.push(
            wrap(async () => {
              await macrotask();
              return n < chunks.length ? { done: false, value: chunks[n] } : { done: true, value: undefined };
            }),
          );
          return returned[n];
        },
      }),
    };
    return { body: body as unknown as AsyncIterable<string>, returned };
  }

  describe.each<[string, (step: Step) => Promise<IteratorResult<string>> & { thenCalls: number }]>([
    ["a pending promise that starts in then(), like Bun.$ or a Bun.sql query", step => lazy(step)],
    ["a pending promise whose own state never carries the result", step => delegating(step, { settled: false })],
    [
      "a promise that is fulfilled when it is made and works in then(), like p-lazy",
      step => delegating(step, { settled: true }),
    ],
  ])("%s", (_, wrap) => {
    test.each(consumers)("%s calls then() once for each result", async (_, consume) => {
      const { body, returned } = iterable(wrap);
      expect({ text: await consume(body), thenCalls: returned.map(promise => promise.thenCalls) }).toEqual({
        text: "hello world",
        thenCalls: [1, 1, 1],
      });
    });
  });

  // There is nothing to call, so the state of the promise is what there is to wait on.
  test.each(consumers)("%s waits on the state of a promise whose then is not callable", async (_, consume) => {
    const { body, returned } = iterable(step => Object.assign(step(), { then: undefined }));
    expect({ text: await consume(body), results: returned.length }).toEqual({ text: "hello world", results: 3 });
  });

  test("a then getter that cancels the body ends the iteration", async () => {
    const calls: string[] = [];
    const body = {
      [Symbol.asyncIterator]: () => ({
        next() {
          calls.push("next");
          const promise = macrotask().then(() => ({ done: false, value: "never read" }));
          Object.defineProperty(promise, "then", {
            get() {
              calls.push("then getter");
              void reader.cancel();
              return Promise.prototype.then;
            },
          });
          return promise;
        },
        return() {
          calls.push("return");
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    };
    const reader = new Response(body as any).body!.getReader();
    expect({ read: await reader.read(), calls }).toEqual({
      read: { done: true, value: undefined },
      calls: ["next", "then getter", "return"],
    });
  });

  // Once Promise.prototype.then is replaced, every plain promise has an observable then().
  // Bun follows the promises that next() returned through it. The promise that Bun makes for
  // each of its own pulls never reaches the replacement.
  test("with Promise.prototype.then replaced, only the promises that next() returned reach the replacement", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const macrotask = () => new Promise(resolve => setImmediate(resolve));
        const returned = new Set();
        const body = {
          [Symbol.asyncIterator]: () => ({
            given: 0,
            next() {
              const n = this.given++;
              const promise = (async () => {
                await macrotask();
                return n < 2 ? { done: false, value: "chunk" + n } : { done: true, value: undefined };
              })();
              returned.add(promise);
              return promise;
            },
          }),
        };
        const receivers = [];
        const then = Promise.prototype.then;
        Promise.prototype.then = function (onFulfilled, onRejected) {
          receivers.push(this);
          return then.call(this, onFulfilled, onRejected);
        };
        let text = "";
        for await (const chunk of new Response(body).body) text += new TextDecoder().decode(chunk);
        Promise.prototype.then = then;
        console.log(JSON.stringify({
          text,
          returned: returned.size,
          callsOnReturned: receivers.filter(promise => returned.has(promise)).length,
          callsOnOthers: receivers.filter(promise => !returned.has(promise)).length,
        }));
        `,
      ],
      env: bunEnv,
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ text: "chunk0chunk1", returned: 3, callsOnReturned: 3, callsOnOthers: 0 });
    expect(exitCode).toBe(0);
  });
});
