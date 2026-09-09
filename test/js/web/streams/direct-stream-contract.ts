// The `type: "direct"` lifecycle contract: every consumer sees pull() once, the bytes written before the end signal, the same error, and cancel() only on abort.

export type Tally = { pulls: number; cancels: unknown[] };

export type Shape = {
  /** What the consumer receives, or the error it rejects with. */
  expect: { body: string } | { error: string };
  make(t: Tally): ReadableStream;
};

const later = () => new Promise<void>(r => setImmediate(r));

function direct(t: Tally, pull: (c: ReadableStreamDirectController) => void | Promise<void>): ReadableStream {
  return new ReadableStream({
    type: "direct",
    pull(c) {
      t.pulls++;
      return pull(c);
    },
    cancel(reason: unknown) {
      t.cancels.push(reason);
    },
  } as any);
}

export const shapes: Record<string, Shape> = {
  "sync pull: write, write, close()": {
    expect: { body: "hello world" },
    make: t => direct(t, c => (c.write("hello "), c.write("world"), c.close())),
  },
  "sync pull: write, write, end()": {
    expect: { body: "hello world" },
    make: t => direct(t, c => (c.write("hello "), c.write("world"), void c.end())),
  },
  "async pull: write, await, write, close()": {
    expect: { body: "hello world" },
    make: t =>
      direct(t, async c => {
        c.write("hello ");
        await later();
        c.write("world");
        c.close();
      }),
  },
  "async pull: write, await, write, resolve without close()": {
    expect: { body: "hello world" },
    make: t =>
      direct(t, async c => {
        c.write("hello ");
        await later();
        c.write("world");
      }),
  },
  "async pull: await write() under backpressure, then close()": {
    expect: { body: Buffer.alloc(256 * 1024, "abcdefgh").toString() },
    make: t =>
      direct(t, async c => {
        for (let i = 0; i < 4; i++) await c.write(Buffer.alloc(64 * 1024, "abcdefgh"));
        c.close();
      }),
  },
  "sync pull keeps the controller; writes arrive later, then close()": {
    expect: { body: "hello world" },
    make: t =>
      direct(t, c => {
        c.write("hello ");
        setImmediate(() => {
          c.write("world");
          c.close();
        });
      }),
  },
  "async pull: write, await, reject": {
    expect: { error: "source failed" },
    make: t =>
      direct(t, async c => {
        c.write("hello ");
        await later();
        throw new Error("source failed");
      }),
  },
  "sync pull throws": {
    expect: { error: "source failed" },
    make: t =>
      direct(t, () => {
        throw new Error("source failed");
      }),
  },
  "close(error) after a write": {
    expect: { error: "source failed" },
    make: t =>
      direct(t, async c => {
        c.write("hello ");
        await later();
        c.close(new Error("source failed"));
      }),
  },
};

const decoder = new TextDecoder();
const text = (v: unknown) => (typeof v === "string" ? v : decoder.decode(v as ArrayBufferView));

/** In-process consumers: each takes a stream and resolves to its full text (or rejects). */
export const consumers: Record<string, (s: ReadableStream) => Promise<string>> = {
  "new Response(s).text()": s => new Response(s).text(),
  "new Response(s).bytes()": async s => decoder.decode(await new Response(s).bytes()),
  "new Response(s).blob()": async s => (await new Response(s).blob()).text(),
  "Bun.readableStreamToText": s => Bun.readableStreamToText(s),
  "Bun.readableStreamToBytes": async s => decoder.decode(await Bun.readableStreamToBytes(s)),
  "Bun.readableStreamToArrayBuffer": async s => decoder.decode(await Bun.readableStreamToArrayBuffer(s)),
  "Bun.readableStreamToArray": async s => (await Bun.readableStreamToArray(s)).map(text).join(""),
  "getReader() loop": async s => {
    const reader = s.getReader();
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return out;
      out += text(value);
    }
  },
  "for await": async s => {
    let out = "";
    for await (const v of s) out += text(v);
    return out;
  },
  "pipeTo(WritableStream)": async s => {
    let out = "";
    await s.pipeTo(new WritableStream({ write: v => void (out += text(v)) }));
    return out;
  },
  "pipeThrough(identity TransformStream)": async s => {
    let out = "";
    for await (const v of s.pipeThrough(new TransformStream())) out += text(v);
    return out;
  },
  "tee(): both branches": async s => {
    const [a, b] = s.tee();
    const [ta, tb] = await Promise.all([Bun.readableStreamToText(a), Bun.readableStreamToText(b)]);
    if (ta !== tb) throw new Error(`tee branches differ: ${JSON.stringify(ta)} vs ${JSON.stringify(tb)}`);
    return ta;
  },
};

/** Runs one cell of the matrix and returns what a test should compare against `expected(shape)`. */
export async function observe(shape: Shape, consume: (s: ReadableStream) => Promise<string>) {
  const t: Tally = { pulls: 0, cancels: [] };
  let result: { body: string } | { error: string };
  try {
    result = { body: await consume(shape.make(t)) };
  } catch (e: any) {
    result = { error: e?.message ?? String(e) };
  }
  // cancel() runs from the sink's close reaction; give it a turn to (not) fire.
  await later();
  return { pulls: t.pulls, cancels: t.cancels.length, ...result };
}

export const expected = (shape: Shape) => ({ pulls: 1, cancels: 0, ...shape.expect });
