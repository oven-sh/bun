import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// Canceling the body in-process reaches the generator: it is returned (or the reason thrown
// into it), not drained in the background.
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

test("cancel(reason) on an async generator body throws the reason into the generator", async () => {
  const reason = new Error("consumer gave up");
  let seen: unknown;
  async function* rethrows() {
    try {
      for (let i = 0; i < 50; i++) yield new Uint8Array(64 * 1024);
    } catch (e) {
      seen = e;
      throw e;
    }
  }
  {
    const reader = new Response(rethrows()).body!.getReader();
    await reader.read();
    // The generator letting the reason propagate is a normal cancel: it resolves.
    expect(await reader.cancel(reason)).toBeUndefined();
    expect(seen).toBe(reason);
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
          return { done: true, value: undefined };
        },
      };
    },
  };
  const body = new Response(iterable).body!;
  expect(await body.cancel()).toBeUndefined();
  expect(events).toEqual(["return"]);

  // Hand-written iterators whose throw() lets the reason out in other shapes than a
  // rejected native promise: a synchronous rethrow and a rejecting thenable.
  const handWritten = (throwImpl: (e: unknown) => unknown) => ({
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: false, value: new Uint8Array(64 * 1024) }),
        throw: throwImpl,
      };
    },
  });
  for (const throwImpl of [
    (e: unknown) => {
      throw e;
    },
    (e: unknown) => ({ then: (_: unknown, reject: (e: unknown) => void) => reject(e) }),
  ]) {
    const reader = new Response(handWritten(throwImpl)).body!.getReader();
    await reader.read();
    expect(await reader.cancel(reason)).toBeUndefined();
  }
  // A different error from throw() is still a failed cancel.
  const reader = new Response(
    handWritten(() => {
      throw new Error("cleanup failed");
    }),
  ).body!.getReader();
  await reader.read();
  await expect(reader.cancel(reason)).rejects.toThrow("cleanup failed");
});

// The one-shot ArrayBufferSink behind bytes()/arrayBuffer() must settle its result before it
// runs the source's close() hook. For an async iterable body that hook calls iterator.return(),
// and a synchronous throw from it used to leave the promise pending forever.
function iterableWithThrowingReturn(log: string[]) {
  return {
    [Symbol.asyncIterator]() {
      let n = 0;
      return {
        async next() {
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
  test("settles when the async iterator's return() throws", async () => {
    const log: string[] = [];
    const result = await consume(iterableWithThrowingReturn(log));
    expect(await toByteArray(result)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(log).toEqual(["next0", "next1", "next2", "return"]);
  });
});
