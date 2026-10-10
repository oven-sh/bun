// The shapes of an async-iterable body (`new Response(body)`, a `Bun.spawn` stdin, ...) whose
// consumer can leave before the body ends, each with a record of what the body hears.
//
// When the consumer leaves, Bun closes such a body the way `for await` leaves an iterator:
// `return()` with no argument, and never `throw()`. A generator can catch what is thrown into
// it, and then it stays suspended at a later `yield` with its `finally` not run. So whoever
// the consumer is and however it leaves, every shape ends with `calls` equal to `expected`.
import { Readable } from "node:stream";

export type AsyncIterableBodyShape = {
  body: AsyncIterable<any>;
  /**
   * The calls on a hand-written iterator, the blocks of a generator that ran, or the events of a
   * stream. A body with a `count` logs "end" first when it gave its last chunk by itself.
   */
  calls: string[];
  /** Resolves when the cleanup ran. */
  closed: Promise<void>;
  /** What `calls` holds once the body is closed. */
  expected: string[];
};

type Options = {
  /** Every chunk of the body. */
  chunk?: unknown;
  /** The body gives `count` chunks and ends. The default is a body with no end. */
  count?: number;
  /** Awaited before the first chunk. */
  start?: Promise<unknown>;
};

const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));

function handWritten(
  withThrow: boolean,
  { chunk = "chunk\n", count = Infinity, start }: Options,
): AsyncIterableBodyShape {
  const calls: string[] = [];
  const closed = Promise.withResolvers<void>();
  const close = (name: string, args: unknown[]) => {
    calls.push(`${name}(${args.length})`);
    closed.resolve();
    return Promise.resolve({ done: true, value: undefined });
  };
  let given = 0;
  const iterator: Record<PropertyKey, unknown> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      // One macrotask between two chunks: the body never starves the event loop.
      await (given === 0 ? start : macrotask());
      if (given++ < count) return { done: false, value: chunk };
      calls.push("end");
      return { done: true, value: undefined };
    },
    return: (...args: unknown[]) => close("return", args),
  };
  if (withThrow) iterator.throw = (...args: unknown[]) => close("throw", args);
  return { body: iterator as unknown as AsyncIterable<any>, calls, closed: closed.promise, expected: ["return(0)"] };
}

function generator(catches: boolean, { chunk = "chunk\n", count = Infinity, start }: Options): AsyncIterableBodyShape {
  const calls: string[] = [];
  const closed = Promise.withResolvers<void>();
  async function* rethrows() {
    try {
      await start;
      for (let given = 0; given < count; given++) {
        yield chunk;
        await macrotask();
      }
      calls.push("end");
    } catch (e) {
      calls.push("catch");
      throw e;
    } finally {
      calls.push("finally");
      closed.resolve();
    }
  }
  // One bad event must not end the stream, so each turn of the loop has its own catch.
  async function* catchesAndGoesOn() {
    try {
      await start;
      for (let given = 0; given < count; given++) {
        try {
          yield chunk;
          await macrotask();
        } catch {
          calls.push("catch");
        }
      }
      calls.push("end");
    } finally {
      calls.push("finally");
      closed.resolve();
    }
  }
  return { body: (catches ? catchesAndGoesOn : rethrows)(), calls, closed: closed.promise, expected: ["finally"] };
}

// The iterator of a node Readable has return() and throw(). Only return() destroys a stream
// that does not destroy itself.
function nodeReadable({ chunk = "chunk\n", count = Infinity, start }: Options): AsyncIterableBodyShape {
  const calls: string[] = [];
  const closed = Promise.withResolvers<void>();
  let given = 0;
  const body = new Readable({
    objectMode: true,
    autoDestroy: false,
    async read() {
      await (given === 0 ? start : macrotask());
      if (given++ < count) return void this.push(chunk);
      calls.push("end");
      this.push(null);
    },
  });
  body.on("close", () => {
    calls.push("close");
    closed.resolve();
  });
  return { body, calls, closed: closed.promise, expected: ["close"] };
}

export const asyncIterableBodyShapes: [name: string, make: (options?: Options) => AsyncIterableBodyShape][] = [
  ["an iterator with next() and return()", (options = {}) => handWritten(false, options)],
  ["an iterator with next(), return() and throw()", (options = {}) => handWritten(true, options)],
  ["a generator with try/catch/finally", (options = {}) => generator(false, options)],
  ["a generator whose loop catches and goes on", (options = {}) => generator(true, options)],
  ["a node Readable with autoDestroy: false", (options = {}) => nodeReadable(options)],
];

/** The shapes that hold something before their first `next()`: a generator that never ran has no `finally` to run. */
export const handWrittenBodyShapes = asyncIterableBodyShapes.slice(0, 2);

/**
 * What the body heard. Call it once the consumer has left. It waits a bounded number of macrotasks
 * for the cleanup and two more for a call that must not follow, so a body that was never closed
 * fails on its `calls` and not on a timeout.
 */
export async function settled(shape: AsyncIterableBodyShape) {
  let closed = false;
  shape.closed.then(() => (closed = true));
  for (let turn = 0; turn < 50 && !closed; turn++) await macrotask();
  await macrotask();
  await macrotask();
  return shape.calls;
}
