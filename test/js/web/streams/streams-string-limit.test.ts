import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

// Consuming a stream as text must reject with a catchable error when the accumulated
// chunks exceed the maximum string length (2^31-1 bytes), instead of aborting the
// process in WTF::Vector's capacity check. Each child commits ~2.2GB.
const enoughMemory = totalmem() >= 8 * 1024 * 1024 * 1024;

// 3 chunks of n bytes sum to 2^31+1: each chunk fits comfortably, the total does not.
function consumeToText(streamSource: string): string {
  return `
    const n = 715827883;
    const rs = ${streamSource};
    try {
      const text = await Bun.readableStreamToText(rs);
      console.log("resolved", text.length);
    } catch (e) {
      console.log("threw", e.name, e.message);
    }
  `;
}

async function run(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const threw = { stdout: "threw RangeError Out of memory\n", stderr: "", exitCode: 0 };

describe.skipIf(!enoughMemory)("text consumers reject binary chunks summing past 2^31-1", () => {
  test("queue-backed ReadableStream", async () => {
    const result = await run(
      consumeToText(`new ReadableStream({
        start(c) {
          for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(n));
          c.close();
        },
      })`),
    );
    expect(result).toEqual(threw);
  });

  test("direct ReadableStream", async () => {
    const result = await run(
      consumeToText(`new ReadableStream({
        type: "direct",
        pull(c) {
          for (let i = 0; i < 3; i++) c.write(new Uint8Array(n));
          c.end();
        },
      })`),
    );
    expect(result).toEqual(threw);
  });

  test("Response(stream).text()", async () => {
    const result = await run(`
      const n = 715827883;
      const rs = new ReadableStream({
        start(c) {
          for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(n));
          c.close();
        },
      });
      try {
        const text = await new Response(rs).text();
        console.log("resolved", text.length);
      } catch (e) {
        console.log("threw", e.name, e.message);
      }
    `);
    expect(result).toEqual(threw);
  });

  // WTF::String::utf8() aborts once its conversion needs more than INT32_MAX bytes of
  // scratch (2x the length for 8-bit strings), so a mixed stream with a near-limit string
  // chunk crashed in the encode even when the real UTF-8 total fit. The consumers now size
  // and write through simdutf instead.
  test("mixed chunks with a big ASCII string chunk resolve when the UTF-8 total fits", async () => {
    const result = await run(`
        const big = Buffer.alloc(1200000000, "a").toString();
        const rs = new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([65]));
            c.enqueue(big);
            c.close();
          },
        });
        try {
          const text = await Bun.readableStreamToText(rs);
          console.log("resolved", text.length);
        } catch (e) {
          console.log("threw", e.name, e.message);
        }
      `);
    expect(result).toEqual({ stdout: "resolved 1200000001\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test("mixed chunks whose UTF-8 expansion passes the limit reject", async () => {
    const result = await run(`
        // 1.2e9 U+00E9 chars: a Latin1 string whose UTF-8 form is 2.4e9 bytes.
        const big = Buffer.alloc(1200000000, 233).toString("latin1");
        const rs = new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([65]));
            c.enqueue(big);
            c.close();
          },
        });
        try {
          const text = await Bun.readableStreamToText(rs);
          console.log("resolved", text.length);
        } catch (e) {
          console.log("threw", e.name, e.message);
        }
      `);
    expect(result).toEqual(threw);
  }, 60_000);

  // The direct sink records sizes at write() time and reads the spans at end(), so a
  // resizable ArrayBuffer grown in between bypasses the up-front estimate check; the
  // append itself must reject the oversized span.
  test("direct stream with a buffer grown past the limit after write() rejects", async () => {
    const result = await run(`
      const ab = new ArrayBuffer(8, { maxByteLength: 2400000000 });
      const rs = new ReadableStream({
        type: "direct",
        pull(c) {
          c.write(new Uint8Array(ab));
          ab.resize(2400000000);
          console.log("resized", ab.byteLength);
          c.end();
        },
      });
      try {
        const text = await Bun.readableStreamToText(rs);
        console.log("resolved", text.length);
      } catch (e) {
        console.log("threw", e.name, e.message);
      }
    `);
    expect(result).toEqual({
      stdout: "resized 2400000000\nthrew RangeError Out of memory\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// arrayBuffer() and bytes() assemble a chunk array that holds a string in a WTF::Vector, which
// aborts past 2^31-1 bytes. The child reserves the two big chunks and never touches them, so
// it stays small.
test.skipIf(!enoughMemory)("arrayBuffer() and bytes() reject mixed chunks summing past 2^31-1", async () => {
  const result = await run(`
    const big = new Uint8Array(1100000000);
    for (const consume of [Bun.readableStreamToArrayBuffer, Bun.readableStreamToBytes]) {
      const rs = new ReadableStream({
        start(c) {
          c.enqueue("a");
          c.enqueue(big);
          c.enqueue(big);
          c.close();
        },
      });
      try {
        const bytes = await consume(rs);
        console.log("resolved", bytes.byteLength);
      } catch (e) {
        console.log("threw", e.name, e.message);
      }
    }
  `);
  expect(result).toEqual({
    stdout: "threw RangeError Out of memory\nthrew RangeError Out of memory\n",
    stderr: "",
    exitCode: 0,
  });
});

// TextDecoderStream joins a chunk with the bytes it carried over from an incomplete UTF-8
// sequence. The join sized a WTF::Vector that aborts past 2^31-1 bytes, so a 2^31-byte chunk
// after a carried byte killed the process before it read a byte. The child reserves the
// chunk and never touches it, so it stays small.
test.skipIf(!enoughMemory)("TextDecoderStream rejects a chunk too long to join with the carried bytes", async () => {
  const result = await run(`
    const writer = new TextDecoderStream().writable.getWriter();
    await writer.write(new Uint8Array([0xe2]));
    try {
      await writer.write(new Uint8Array(2 ** 31));
      console.log("resolved");
    } catch (e) {
      console.log("threw", e.name, e.message);
    }
  `);
  expect(result).toEqual(threw);
});

// Body.textStream() over a ReadableStream body decodes a chunk inside the call that delivers
// it: enqueue(), a TransformStream write, a tee. A chunk that it cannot decode is the text
// stream's failure. Its reads reject, and it cancels the body and releases it after that call
// returns, as a pipe through a TextDecoderStream does. The call itself returns normally. The
// child lowers the string limit to 1 MiB, the smallest value the hook takes, so a chunk of
// 1 MiB + 1 bytes is too long to become a string.
describe("Body.textStream() fails its own stream when it cannot decode a chunk", () => {
  const LIMIT = 1024 * 1024;
  const outOfMemory = "RangeError: Out of memory";
  const notBytes = "TypeError: Body.textStream() received a chunk that is not a BufferSource";
  const prelude = `
    import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
    setSyntheticAllocationLimitForTesting(${LIMIT});
    const describeError = e => (e instanceof Error ? e.name + ": " + e.message : "not an error: " + e);
    const tooLong = () => new Uint8Array(${LIMIT} + 1);
    // "pending" until the promise settles. Then the length of the chunk that was read, or the error.
    const follow = promise => {
      const followed = { outcome: "pending" };
      promise.then(
        result => {
          followed.outcome = result === undefined ? "fulfilled" : result.done ? "done" : result.value.length;
        },
        error => {
          followed.outcome = describeError(error);
        },
      );
      return followed;
    };
    // A stream settles its promises in microtasks. One turn of the event loop runs them all, so
    // a promise that is still pending after it stays pending.
    const turn = () => new Promise(resolve => setImmediate(resolve));
    const attempt = fn => {
      try {
        fn();
        return "returned";
      } catch (e) {
        return "threw " + describeError(e);
      }
    };
    // A body that its producer feeds from outside pull().
    const pushBody = type => {
      const source = { cancelled: null };
      source.body = new ReadableStream({
        type,
        start(controller) {
          source.controller = controller;
        },
        cancel(reason) {
          source.cancelled = describeError(reason);
        },
      });
      return source;
    };
  `;
  const runInSubprocess = async (source: string) => {
    const { stdout, stderr, exitCode } = await run(`${prelude}\n${source}`);
    return { stdout: JSON.parse(stdout || "null"), stderr, exitCode };
  };

  test.concurrent.each([
    ["a Response", "new Response(source.body)", "undefined"],
    ["a Response with a byte stream", "new Response(source.body)", `"bytes"`],
    ["a Request", `new Request("http://example.com/", { method: "POST", body: source.body })`, "undefined"],
  ])("the chunk arrives while a read waits: %s", async (_name, body, type) => {
    const result = await runInSubprocess(`
      const source = pushBody(${type});
      const reader = ${body}.textStream().getReader();
      const read = follow(reader.read());
      const closed = follow(reader.closed);
      await turn();
      const enqueue = attempt(() => source.controller.enqueue(tooLong()));
      await turn();
      console.log(JSON.stringify({
        enqueue,
        read: read.outcome,
        closed: closed.outcome,
        locked: source.body.locked,
        cancelled: source.cancelled,
      }));
    `);
    expect(result).toEqual({
      stdout: { enqueue: "returned", read: outOfMemory, closed: outOfMemory, locked: false, cancelled: outOfMemory },
      stderr: "",
      exitCode: 0,
    });
  });

  // The producer enqueues twice in one tick. The body is not cancelled under the first call,
  // so the second call does not find a closed controller.
  test.concurrent.each([
    ["too long for a string", "tooLong()", outOfMemory],
    ["not bytes", `"not bytes"`, notBytes],
  ])("the body is cancelled after the producer's tick: a chunk that is %s", async (_name, chunk, error) => {
    const result = await runInSubprocess(`
      const source = pushBody();
      const read = follow(new Response(source.body).textStream().getReader().read());
      await turn();
      const first = attempt(() => source.controller.enqueue(${chunk}));
      const cancelledUnderFirst = source.cancelled;
      const second = attempt(() => source.controller.enqueue(new Uint8Array(1)));
      await turn();
      console.log(JSON.stringify({
        first,
        cancelledUnderFirst,
        second,
        read: read.outcome,
        locked: source.body.locked,
        cancelled: source.cancelled,
      }));
    `);
    expect(result).toEqual({
      stdout: {
        first: "returned",
        cancelledUnderFirst: null,
        second: "returned",
        read: error,
        locked: false,
        cancelled: error,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("for await over the text stream rejects", async () => {
    const result = await runInSubprocess(`
      const source = pushBody();
      const text = new Response(source.body).textStream();
      const loop = follow((async () => {
        for await (const chunk of text) console.log("unexpected chunk", chunk.length);
      })());
      await turn();
      const enqueue = attempt(() => source.controller.enqueue(tooLong()));
      await turn();
      console.log(JSON.stringify({
        enqueue,
        loop: loop.outcome,
        locked: source.body.locked,
        cancelled: source.cancelled,
      }));
    `);
    expect(result).toEqual({
      stdout: { enqueue: "returned", loop: outOfMemory, locked: false, cancelled: outOfMemory },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("the chunk is in the body's queue before the text stream reads", async () => {
    const result = await runInSubprocess(`
      const source = pushBody();
      source.controller.enqueue(tooLong());
      const read = follow(new Response(source.body).textStream().getReader().read());
      await turn();
      console.log(JSON.stringify({ read: read.outcome, locked: source.body.locked, cancelled: source.cancelled }));
    `);
    expect(result).toEqual({
      stdout: { read: outOfMemory, locked: false, cancelled: outOfMemory },
      stderr: "",
      exitCode: 0,
    });
  });

  // clone() tees the body. The clone is another reader of the same chunk.
  test.concurrent("a clone of the Response still reads the chunk", async () => {
    const result = await runInSubprocess(`
      const source = pushBody();
      const response = new Response(source.body);
      const clone = response.clone();
      const read = follow(response.textStream().getReader().read());
      const cloneRead = follow(clone.body.getReader().read());
      await turn();
      const enqueue = attempt(() => source.controller.enqueue(tooLong()));
      await turn();
      console.log(JSON.stringify({
        enqueue,
        read: read.outcome,
        cloneRead: cloneRead.outcome,
        cancelled: source.cancelled,
      }));
    `);
    expect(result).toEqual({
      stdout: { enqueue: "returned", read: outOfMemory, cloneRead: LIMIT + 1, cancelled: null },
      stderr: "",
      exitCode: 0,
    });
  });

  // The body is the readable side of a TransformStream. The writer delivers the chunk.
  test.concurrent("a TransformStream writer that delivers the chunk sees a cancel, not a failed write", async () => {
    const result = await runInSubprocess(`
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const read = follow(new Response(readable).textStream().getReader().read());
      const write = follow(writer.write(tooLong()));
      const writerClosed = follow(writer.closed);
      await turn();
      console.log(JSON.stringify({
        write: write.outcome,
        read: read.outcome,
        writerClosed: writerClosed.outcome,
        locked: readable.locked,
      }));
    `);
    expect(result).toEqual({
      stdout: { write: "fulfilled", read: outOfMemory, writerClosed: outOfMemory, locked: false },
      stderr: "",
      exitCode: 0,
    });
  });
});
