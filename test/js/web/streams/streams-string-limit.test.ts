import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isASAN } from "harness";
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

async function run(
  script: string,
  env: Record<string, string | undefined> = bunEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env,
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

// The text sink of a direct stream joins its string chunks in a WTF::StringBuilder. A chunk
// that the builder cannot take has to be an error that script can catch. write() threw that
// error, and the process then aborted when the stream ended: a builder that has overflowed
// has lost its text, and asserts when it is read.
const describeError = `const describeError = e => e.name + ": " + e.message;`;
const outOfMemory = "RangeError: Out of memory";

// An allocation fails. With Malloc=1 WebKit allocates through the system allocator, so
// ASAN's cap of 4 MiB for one allocation covers the buffer of the text. ASAN logs every
// allocation that it refuses to stderr.
describe.skipIf(!isASAN)("a direct stream's text sink throws when its text cannot be allocated", () => {
  const MIB = 1024 * 1024;
  const env = {
    ...bunEnv,
    Malloc: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=4", "detect_leaks=0"]
      .filter(Boolean)
      .join(":"),
  };
  const prelude = `
    ${describeError}
    const settle = promise => promise.then(text => ({ length: text.length }), e => ({ rejected: describeError(e) }));
    // One megabyte: of Latin-1 characters, or of 16-bit characters.
    const latin1 = () => Buffer.alloc(${MIB}, "x").toString("latin1");
    const utf16 = () => Buffer.alloc(${MIB}, "\\u4F60", "utf16le").toString("utf16le");
    const tryWrite = (controller, chunk) => {
      try {
        controller.write(chunk);
        return null;
      } catch (e) {
        return describeError(e);
      }
    };
    // The sink doubles its buffer. The third megabyte needs a buffer of 4 MiB and a header, which is over the cap.
    const writeUntilRefused = (controller, megabyte) => {
      for (let written = 0; written < 8; written++) {
        const refused = tryWrite(controller, megabyte());
        if (refused) return { written, refused };
      }
      return { written: 8, refused: null };
    };
  `;
  const runWithCap = async (source: string) => {
    const { stdout, exitCode } = await run(`${prelude}\n${source}`, env);
    return { stdout: JSON.parse(stdout || "null"), exitCode };
  };
  const refusedAtTheThird = { rejected: outOfMemory, written: 2, refused: outOfMemory };

  test.concurrent.each([
    ["Latin-1", "latin1"],
    ["16-bit", "utf16"],
  ])("the caller catches the error and ends the stream: %s text", async (_name, megabyte) => {
    const result = await runWithCap(`
      let writes;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          writes = writeUntilRefused(controller, ${megabyte});
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), ...writes }));
    `);
    expect(result).toEqual({ stdout: refusedAtTheThird, exitCode: 0 });
  });

  test.concurrent("the caller catches the error and writes bytes", async () => {
    const result = await runWithCap(`
      let writes, bytesRefused;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          writes = writeUntilRefused(controller, latin1);
          bytesRefused = tryWrite(controller, new TextEncoder().encode("z"));
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), ...writes, bytesRefused }));
    `);
    expect(result).toEqual({ stdout: { ...refusedAtTheThird, bytesRefused: outOfMemory }, exitCode: 0 });
  });

  // The two megabytes of Latin-1 are 4 MiB in a 16-bit buffer.
  test.concurrent("the caller catches the error of a 16-bit character after Latin-1 text", async () => {
    const result = await runWithCap(`
      let refused;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write(latin1());
          controller.write(latin1());
          refused = tryWrite(controller, "\\u20AC");
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), refused }));
    `);
    expect(result).toEqual({ stdout: { rejected: outOfMemory, refused: outOfMemory }, exitCode: 0 });
  });

  test.concurrent("nothing catches the error", async () => {
    const result = await runWithCap(`
      let written = 0;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          for (; written < 8; written++) controller.write(latin1());
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), written }));
    `);
    expect(result).toEqual({ stdout: { rejected: outOfMemory, written: 2 }, exitCode: 0 });
  });
});

// The text would be longer than a string can be, or its buffer cannot grow to hold it.
describe.skipIf(!enoughMemory)("a direct stream's text sink throws when its text does not fit in a string", () => {
  const prelude = `
    ${describeError}
    const gigabyte = Buffer.alloc(2 ** 30, "x").toString("latin1");
    const settle = promise =>
      promise.then(
        text => ({ length: text.length, isTheFirstChunk: text === gigabyte }),
        e => ({ rejected: describeError(e) }),
      );
    const tryWrite = (controller, chunk) => {
      try {
        controller.write(chunk);
        return null;
      } catch (e) {
        return describeError(e);
      }
    };
  `;
  const runParsed = async (source: string) => {
    const { stdout, stderr, exitCode } = await run(`${prelude}\n${source}`);
    return { stdout: JSON.parse(stdout || "null"), stderr, exitCode };
  };

  // The sink checks the length before it takes the chunk, so it keeps the text that it has.
  test("the caller catches the error and ends the stream", async () => {
    const result = await runParsed(`
      let refused;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write(gigabyte);
          refused = tryWrite(controller, gigabyte);
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), refused }));
    `);
    expect(result).toEqual({
      stdout: { length: 2 ** 30, isTheFirstChunk: true, refused: outOfMemory },
      stderr: "",
      exitCode: 0,
    });
  }, 60_000);

  test("nothing catches the error", async () => {
    const result = await runParsed(`
      let wroteTwice = false;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write(gigabyte);
          controller.write(gigabyte);
          wroteTwice = true;
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(new Response(stream).text())), wroteTwice }));
    `);
    expect(result).toEqual({ stdout: { rejected: outOfMemory, wroteTwice: false }, stderr: "", exitCode: 0 });
  }, 60_000);

  // This text fits in a string. WTF::StringBuilder asks for twice its size to hold a 16-bit
  // character, which is longer than a 16-bit string can be, and loses the text
  // (https://github.com/oven-sh/WebKit/pull/631). The sink has no text to resolve with.
  test("the caller catches the error of a 16-bit character after a gigabyte of Latin-1", async () => {
    const result = await runParsed(`
      let refused;
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write(gigabyte);
          refused = tryWrite(controller, "\\u20AC");
          controller.end();
        },
      });
      console.log(JSON.stringify({ ...(await settle(Bun.readableStreamToText(stream))), refused }));
    `);
    expect(result).toEqual({ stdout: { rejected: outOfMemory, refused: outOfMemory }, stderr: "", exitCode: 0 });
  }, 60_000);
});

// A text consumer of a stream that has bytes and strings rejects when a string chunk makes
// the text longer than the limit. Nothing reads its text after that, and the collector
// does not know the size of the text, so the consumer gives it back at once.
test("a rejected text() of bytes and strings does not keep its text", async () => {
  const MIB = 1024 * 1024;
  const rejectedCalls = 16;
  await expectRssDeltaBelow(
    [
      "-e",
      `
      import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
      setSyntheticAllocationLimitForTesting(${32 * MIB});
      const part = Buffer.alloc(${8 * MIB}, "x").toString("latin1");
      // The text is 32 MiB after four parts, and the fifth part passes the limit.
      const rejectedText = async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([97]));
            for (let i = 0; i < 5; i++) controller.enqueue(part);
            controller.close();
          },
        });
        const error = await stream.text().then(() => "resolved", e => e.name + ": " + e.message);
        if (error !== "${outOfMemory}") throw new Error(error);
      };
      await rejectedText();
      const before = process.memoryUsage.rss();
      for (let i = 0; i < ${rejectedCalls}; i++) await rejectedText();
      console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / ${MIB} }));
      `,
    ],
    // A consumer that keeps its text holds 32 MiB for each call: 512 MiB.
    { release: 128, debug: 192 },
  );
});
