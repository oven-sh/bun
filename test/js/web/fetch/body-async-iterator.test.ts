import { expect, test } from "bun:test";
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
});
