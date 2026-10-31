import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { Readable } from "node:stream";
import { asyncIterableBodyShapes, handWrittenBodyShapes, settled } from "../streams/async-iterable-body-shapes";

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

// The body is complete when the iterator is done, so a return() that throws afterwards does not fail the
// consumer (Node never calls return() after a done result). bytes()/arrayBuffer() used to stay pending forever:
// the source's close() hook calls iterator.return(), its throw left their result unsettled, and pull() still resolved.
function iterableWithThrowingReturn(log: string[], endsLater: boolean) {
  return {
    [Symbol.asyncIterator]() {
      let n = 0;
      return {
        async next() {
          // Without the wait the iterator finishes inside the consumer's pull() call; with it, from a promise reaction after that call returned.
          if (endsLater) await new Promise<void>(resolve => setImmediate(resolve));
          log.push(`next${n}`);
          return n++ < 2 ? { value: new Uint8Array(3).fill(n), done: false } : { done: true, value: undefined };
        },
        return() {
          log.push("return");
          throw new RangeError("ret");
        },
      };
    },
  };
}

async function toByteArray(result: unknown): Promise<number[]> {
  if (result instanceof Blob) return Array.from(new Uint8Array(await result.arrayBuffer()));
  if (typeof result === "string") return Array.from(new TextEncoder().encode(result));
  return Array.from(new Uint8Array(result as ArrayBuffer));
}

describe.each([
  ["Response.bytes()", (body: any) => new Response(body).bytes()],
  ["Response.arrayBuffer()", (body: any) => new Response(body).arrayBuffer()],
  ["Response.text()", (body: any) => new Response(body).text()],
  ["Response.blob()", (body: any) => new Response(body).blob()],
  [
    "Request.bytes()",
    (body: any) => new Request("http://localhost/", { method: "POST", body, duplex: "half" } as any).bytes(),
  ],
  ["Bun.readableStreamToBytes(body)", (body: any) => Bun.readableStreamToBytes(new Response(body).body!)],
  ["Bun.readableStreamToArrayBuffer(body)", (body: any) => Bun.readableStreamToArrayBuffer(new Response(body).body!)],
] as const)("%s", (_label, consume) => {
  test("resolves with the body when the async iterator's return() throws", async () => {
    for (const endsLater of [false, true]) {
      const log: string[] = [];
      const result = await consume(iterableWithThrowingReturn(log, endsLater));
      expect({ endsLater, bytes: await toByteArray(result), log }).toEqual({
        endsLater,
        bytes: [1, 1, 1, 2, 2, 2],
        log: ["next0", "next1", "next2", "return"],
      });
    }
  });
});
