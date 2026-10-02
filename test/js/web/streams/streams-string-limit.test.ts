import { describe, expect, test } from "bun:test";
import { allocationCapEnv, bunEnv, bunExe, emptyProcessMaxRSS, isASAN, isDebug, runFixtureMaxRSS } from "harness";
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

// The text of a stream whose chunks are all strings is one string of the sum of their lengths.
// The consumer joined them in a WTF::StringBuilder that aborts the process when it cannot grow:
// when the allocator refuses its buffer, and when it doubles the buffer for the first 16-bit
// chunk and the double is longer than a 16-bit string can be.
describe("the text of string chunks is one allocation of its length", () => {
  const MIB = 1024 * 1024;
  const outOfMemory = "RangeError: Out of memory";
  // "aaabbc" is "a3 b2 c1".
  const runs = `text => text.replace(/(.)\\1*/gs, (run, character) => character + run.length + " ").trim()`;
  const consume = (chunks: string, text: string, describeText = runs) => `
    const megabyte = letter => Buffer.alloc(1024 * 1024, letter).toString("latin1");
    const chunks = ${chunks};
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const describeText = ${describeText};
    const settled = await ${text}.then(text => ({ text: describeText(text) }), e => ({ rejected: e.name + ": " + e.message }));
    console.log(JSON.stringify(settled));
  `;

  describe.skipIf(!isASAN)("under a cap of 4 MiB for one allocation", () => {
    const env = allocationCapEnv(4);
    const megabytes = (letters: string) => `[...${JSON.stringify(letters)}].map(megabyte)`;

    test.concurrent.each([
      ["three megabytes", megabytes("abc"), { text: `a${MIB} b${MIB} c${MIB}` }],
      ["four megabytes", megabytes("abcd"), { rejected: outOfMemory }],
      // A megabyte of 16-bit characters is 2 MiB.
      ["one megabyte, then a 16-bit character", `[megabyte("a"), "\\u20AC"]`, { text: `a${MIB} \u20AC1` }],
      ["three megabytes, then a 16-bit character", `[...${megabytes("abc")}, "\\u20AC"]`, { rejected: outOfMemory }],
      ["a 16-bit character, then three megabytes", `["\\u20AC", ...${megabytes("abc")}]`, { rejected: outOfMemory }],
    ])("%s", async (_name, chunks, expected) => {
      const { stdout, exitCode } = await run(consume(chunks, "Bun.readableStreamToText(stream)"), env);
      expect({ stdout: JSON.parse(stdout || "null"), exitCode }).toEqual({ stdout: expected, exitCode: 0 });
    });

    test.concurrent.each([
      "stream.text()",
      "new Response(stream).text()",
      "stream.json()",
      "new Response(stream).json()",
    ])("%s of four megabytes", async text => {
      const { stdout, exitCode } = await run(consume(megabytes("abcd"), text), env);
      expect({ stdout: JSON.parse(stdout || "null"), exitCode }).toEqual({
        stdout: { rejected: outOfMemory },
        exitCode: 0,
      });
    });
  });

  // A 16-bit string holds at most 2,147,483,635 characters. The consumer refuses a longer text
  // before it allocates, so the child stays small.
  test("a 16-bit text of 2,147,483,636 characters", async () => {
    const chunks = `["\\u20AC", ...Array(2047).fill(megabyte("x")), megabyte("x").slice(0, 2 ** 20 - 13)]`;
    const { stdout, stderr, exitCode } = await run(consume(chunks, "Bun.readableStreamToText(stream)"));
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: { rejected: outOfMemory },
      stderr: "",
      exitCode: 0,
    });
  });

  // This text fits in a string: it is 2 GiB in 16 bits. A debug build takes 6 s to copy it.
  test.skipIf(!enoughMemory || isDebug)("a 16-bit character after a gigabyte of Latin-1", async () => {
    const chunks = `[...Array(16).fill(Buffer.alloc(2 ** 26, "x").toString("latin1")), "\\u20AC"]`;
    const ends = `text => ({ length: text.length, start: text.slice(0, 3), end: text.slice(-3) })`;
    const { stdout, stderr, exitCode } = await run(consume(chunks, "Bun.readableStreamToText(stream)", ends));
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: { text: { length: 2 ** 30 + 1, start: "xxx", end: "xx\u20AC" } },
      stderr: "",
      exitCode: 0,
    });
  });

  // The peak RSS of a child that reads a stream of string chunks as text, above the peak of an
  // empty child, in MiB.
  const peakOfText = async (chunks: string, report: string, expected: unknown) => {
    const fixture = `
      const latin1 = (length, letter) => Buffer.alloc(length, letter).toString("latin1");
      ${chunks}
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });
      const text = await stream.text();
      console.log(JSON.stringify(${report}));
    `;
    const [peak, emptyPeak] = await Promise.all([runFixtureMaxRSS(fixture, expected), emptyProcessMaxRSS()]);
    return (peak - emptyPeak) / MIB;
  };

  // The join leaves the BOM out. No copy removes it, and the text is not a part of another
  // string, so structuredClone() shares it. The text is 256 MiB in 16 bits. A copy makes 512 MiB.
  test("a BOM before 128 MiB of Latin-1", async () => {
    const peak = await peakOfText(
      `const chunks = ["\\uFEFF", ...Array(128).fill(latin1(${MIB}, "x"))];`,
      `{ length: text.length, start: text.slice(0, 3), clone: structuredClone(text).length }`,
      { length: 128 * MIB, start: "xxx", clone: 128 * MIB },
    );
    console.log("CALIBRATE bom", Math.round(peak));
    expect(peak).toBeLessThan(384);
  });

  // The join copies a chunk that is a rope from the two strings of the rope. It does not make
  // the string of each rope first, which is 128 MiB more.
  test("128 MiB of chunks that are ropes", async () => {
    const peak = await peakOfText(
      `const a = latin1(${MIB / 2}, "a"), b = latin1(${MIB / 2}, "b");
       const chunks = Array.from({ length: 128 }, () => a + b);`,
      `{ length: text.length, start: text.slice(0, 3), end: text.slice(-3) }`,
      { length: 128 * MIB, start: "aaa", end: "bbb" },
    );
    console.log("CALIBRATE ropes", Math.round(peak));
    expect(peak).toBeLessThan(192);
  });

  // The first chunk can start with a BOM. The consumer does not make the string of a rope to
  // look for it: the string of this rope is 128 MiB more. The rope itself is 8 MiB.
  test("a 16-bit rope of 128 MiB, then a string", async () => {
    const peak = await peakOfText(
      `let rope = Buffer.alloc(${8 * MIB}, "\\u4F60", "utf16le").toString("utf16le");
       for (let i = 0; i < 4; i++) rope = rope + rope;
       const chunks = [rope, "tail"];`,
      `{ length: text.length, start: text.slice(0, 2), end: text.slice(-5) }`,
      { length: 64 * MIB + 4, start: "\u4F60\u4F60", end: "\u4F60tail" },
    );
    console.log("CALIBRATE rope16", Math.round(peak));
    expect(peak).toBeLessThan(200);
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
