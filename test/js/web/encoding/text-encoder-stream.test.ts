import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, readableStreamFromArray } from "harness";

// META: global=window,worker
// META: script=resources/readable-stream-from-array.js
// META: script=resources/readable-stream-to-array.js

const inputString = "I \u{1F499} streams";
const expectedOutputBytes = [0x49, 0x20, 0xf0, 0x9f, 0x92, 0x99, 0x20, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x73];
// This is a character that must be represented in two code units in a string,
// ie. it is not in the Basic Multilingual Plane.
const astralCharacter = "\u{1F499}"; // BLUE HEART
const astralCharacterEncoded = [0xf0, 0x9f, 0x92, 0x99];
const leading = astralCharacter[0];
const trailing = astralCharacter[1];
const replacementEncoded = [0xef, 0xbf, 0xbd];

// These tests assume that the implementation correctly classifies leading and
// trailing surrogates and treats all the code units in each set equivalently.

const testCases = [
  {
    input: [inputString],
    output: [expectedOutputBytes],
    description: "encoding one string of UTF-8 should give one complete chunk",
  },
  {
    input: [leading, trailing],
    output: [astralCharacterEncoded],
    description: "a character split between chunks should be correctly encoded",
  },
  {
    input: [leading, trailing + astralCharacter],
    output: [astralCharacterEncoded.concat(astralCharacterEncoded)],
    description: "a character following one split between chunks should be " + "correctly encoded",
  },
  {
    input: [leading, trailing + leading, trailing],
    output: [astralCharacterEncoded, astralCharacterEncoded],
    description: "two consecutive astral characters each split down the " + "middle should be correctly reassembled",
  },
  {
    input: [leading, trailing + leading + leading, trailing],
    output: [astralCharacterEncoded.concat(replacementEncoded), astralCharacterEncoded],
    description:
      "two consecutive astral characters each split down the " +
      "middle with an invalid surrogate in the middle should be correctly " +
      "encoded",
  },
  {
    input: [leading],
    output: [replacementEncoded],
    description: "a stream ending in a leading surrogate should emit a " + "replacement character as a final chunk",
  },
  {
    input: [leading, astralCharacter],
    output: [replacementEncoded.concat(astralCharacterEncoded)],
    description:
      "an unmatched surrogate at the end of a chunk followed by " +
      "an astral character in the next chunk should be replaced with " +
      "the replacement character at the start of the next output chunk",
  },
  {
    input: [leading, "A"],
    output: [replacementEncoded.concat([65])],
    description:
      "an unmatched surrogate at the end of a chunk followed by " +
      "an ascii character in the next chunk should be replaced with " +
      "the replacement character at the start of the next output chunk",
  },
  {
    input: [leading, leading, trailing],
    output: [replacementEncoded, astralCharacterEncoded],
    description:
      "an unmatched surrogate at the end of a chunk followed by " +
      "a plane 1 character split into two chunks should result in " +
      "the encoded plane 1 character appearing in the last output chunk",
  },
  {
    input: [leading, leading],
    output: [replacementEncoded, replacementEncoded],
    description: "two leading chunks should result in two replacement " + "characters",
  },
  {
    input: [leading + leading, trailing],
    output: [replacementEncoded, astralCharacterEncoded],
    description: "a non-terminal unpaired leading surrogate should " + "immediately be replaced",
  },
  {
    input: [trailing, astralCharacter],
    output: [replacementEncoded, astralCharacterEncoded],
    description: "a terminal unpaired trailing surrogate should " + "immediately be replaced",
  },
  {
    input: [leading, "", trailing],
    output: [astralCharacterEncoded],
    description: "a leading surrogate chunk should be carried past empty chunks",
  },
  {
    input: [leading, ""],
    output: [replacementEncoded],
    description: "a leading surrogate chunk should error when it is clear " + "it didn't form a pair",
  },
  {
    input: [""],
    output: [],
    description: "an empty string should result in no output chunk",
  },
  {
    input: ["", inputString],
    output: [expectedOutputBytes],
    description: "a leading empty chunk should be ignored",
  },
  {
    input: [inputString, ""],
    output: [expectedOutputBytes],
    description: "a trailing empty chunk should be ignored",
  },
  {
    input: ["A"],
    output: [[65]],
    description: "a plain ASCII chunk should be converted",
  },
  {
    input: ["\xff"],
    output: [[195, 191]],
    description: "characters in the ISO-8859-1 range should be encoded correctly",
  },
];

for (const { input, output, description } of testCases) {
  test(description, async () => {
    const inputStream = readableStreamFromArray(input);
    const outputStream = inputStream.pipeThrough(new TextEncoderStream());
    const chunkArray = await Bun.readableStreamToArray(outputStream);
    expect(chunkArray.length, "number of chunks should match").toBe(output.length);
    for (let i = 0; i < output.length; ++i) {
      expect(chunkArray[i].constructor).toBe(Uint8Array);
      expect(chunkArray[i].length).toBe(output[i].length);
      for (let j = 0; j < output[i].length; ++j) {
        expect(chunkArray[i][j]).toBe(output[i][j]);
      }
    }
  });
}

// https://github.com/oven-sh/bun/pull/33193 — a transform failure must reject the write
// promise, not throw synchronously or leave the in-flight write unsettled (abort() hang).
test("cancelling the readable inside the chunk's toString() rejects the write instead of throwing", async () => {
  const stream = new TextEncoderStream();
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  reader.read();
  (await null, await null, await null); // open the synchronous-transform window (backpressure cleared, write runs the transform inline)

  const writePromise = writer.write({
    toString() {
      reader.cancel();
      return "x";
    },
  }); // must NOT throw synchronously
  expect(writePromise).toBeInstanceOf(Promise);
  await expect(writePromise).rejects.toBeInstanceOf(TypeError);
  await writer.abort("bye"); // must settle
});

// Native-sink output path: when the readable is consumed by a native JSSink
// (here HTTPResponseSink via Bun.serve), the encoder writes into a reusable
// scratch buffer and straight to the sink's m_sinkPtr instead of wrapping each
// chunk in a JSUint8Array.
test("TextEncoderStream -> native HTTP response sink round-trips (incl. split surrogate)", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream({
        start(c) {
          c.enqueue("I \u{1F499} ");
          c.enqueue(leading);
          c.enqueue(trailing + " streams");
          c.close();
        },
      });
      return new Response(body.pipeThrough(new TextEncoderStream()));
    },
  });
  const text = await (await fetch(server.url)).text();
  expect(text).toBe("I \u{1F499} \u{1F499} streams");
});

test("TextEncoderStream -> native HTTP response sink: flush emits FFFD for a dangling lead surrogate", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream({
        start(c) {
          c.enqueue("a");
          c.enqueue(leading);
          c.close();
        },
      });
      return new Response(body.pipeThrough(new TextEncoderStream()));
    },
  });
  const text = await (await fetch(server.url)).text();
  expect(text).toBe("a\uFFFD");
});

// Each encoder/decoder owns its own reusable scratch buffer; a chain of them
// must not let one stage observe another's buffer before the bytes are copied.
test("TextEncoderStream -> TextDecoderStream -> TextEncoderStream round-trips many chunks without corruption", async () => {
  const chunks = [
    "ascii-only-1",
    "mañana café ", // latin-1 non-ascii
    "\u{1F499}".repeat(50), // surrogate pairs (BMP-out)
    "x".repeat(8000), // larger than one internal CHUNK span
    leading, // split surrogate across chunk boundary
    trailing + "tail",
    "\u{1F1EE}\u{1F1F3}zz", // regional indicators
    Buffer.alloc(3000, "日").toString(), // 3-byte utf8
    "",
    "end",
  ];
  const expected = new TextEncoder().encode(chunks.join(""));

  const src = new ReadableStream<string>({
    start(c) {
      for (const s of chunks) c.enqueue(s);
      c.close();
    },
  });

  const out = Buffer.from(
    await new Response(
      src
        .pipeThrough(new TextEncoderStream())
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextEncoderStream()),
    ).arrayBuffer(),
  );

  expect(out.byteLength).toBe(expected.byteLength);
  expect(Buffer.compare(out, Buffer.from(expected))).toBe(0);
});

test("TextEncoderStream -> TextDecoderStream -> TextEncoderStream -> native HTTP sink round-trips", async () => {
  const chunks = ["hello ", "\u{1F499}".repeat(200), leading, trailing, " world"];
  const expected = new TextEncoder().encode(chunks.join(""));

  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream<string>({
        start(c) {
          for (const s of chunks) c.enqueue(s);
          c.close();
        },
      });
      return new Response(
        body
          .pipeThrough(new TextEncoderStream())
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new TextEncoderStream()),
      );
    },
  });
  const out = Buffer.from(await (await fetch(server.url)).arrayBuffer());
  expect(out.byteLength).toBe(expected.byteLength);
  expect(Buffer.compare(out, Buffer.from(expected))).toBe(0);
});

// The encoder sizes a chunk's output buffer from the chunk itself (up to three
// bytes per UTF-16 unit), so those reservations are where a TextEncoderStream
// runs out of memory. A failed one has to error the stream like any other
// transform failure, not abort the process (#33014 fixed the decoding direction
// the same way). ASAN's per-allocation cap makes the failure deterministic: the
// input strings are allocated by JSC and are not subject to it, while every
// encoder reservation above CAP_MB fails. Each input is shaped so that a
// different reservation in the encoder is the one that fails. (Bun's own startup
// needs allocations of up to about 1.5 MiB, so the cap cannot go much lower; the
// Latin-1 growth cases encode three quarters of it through the debug build's
// per-char loop, so it should not be much higher either.)
describe.skipIf(!isASAN)("a failed output buffer allocation errors the stream instead of aborting", () => {
  const CAP_MB = 4;
  const env = {
    ...bunEnv,
    // detect_leaks=0: natives owned only by a JSC cell are invisible to
    // LeakSanitizer's reachability scan and would be reported at exit.
    ASAN_OPTIONS: [
      bunEnv.ASAN_OPTIONS,
      "allocator_may_return_null=1",
      `max_allocation_size_mb=${CAP_MB}`,
      "detect_leaks=0",
    ]
      .filter(Boolean)
      .join(":"),
  };
  const prelude = /* js */ `
    const MiB = 1024 * 1024;
    const inputs = {
      // Latin-1: the up-front reservation (one byte per input byte) is above the cap.
      latin1: () => Buffer.alloc(${2 * CAP_MB} * MiB, "a").toString("latin1"),
      // Latin-1: the up-front reservation (3/4 of the cap) fits, but every byte
      // encodes to two, so the buffer fills up half way through and the reservation
      // growing it (to at least 1.5x the input) fails.
      latin1Grow: () => Buffer.alloc(${0.75 * CAP_MB} * MiB, 0xe9).toString("latin1"),
      // Latin-1: an ASCII byte followed by an odd number of two-byte chars leaves a
      // single spare byte, so a pass encodes nothing and the branch reserving room
      // for one more char is the one that fails.
      latin1Stuck: () => {
        const bytes = Buffer.alloc(${0.75 * CAP_MB} * MiB + 2, 0xe9);
        bytes[0] = 0x61;
        return bytes.toString("latin1");
      },
      // UTF-16 fast path: simdutf predicts three bytes per unit, 1.5x the cap.
      utf16: () => Buffer.alloc(${CAP_MB} * MiB, "\\u65e5", "utf16le").toString("utf16le"),
      // UTF-16 slow path, N ASCII units behind a lone surrogate (the surrogate
      // makes the concatenation a 16-bit string): simdutf's prediction (N + 2
      // bytes) is reserved fine, then the surrogate hands the chunk to the
      // replacement encoder, whose first reservation (1.2 bytes per remaining
      // unit, 1.2N + 3) does not fit.
      utf16Invalid: () => "\\ud800" + Buffer.alloc(${CAP_MB - 0.25} * MiB, "a").toString("latin1"),
    };
    const describeError = e => ({ name: e.name, message: e.message });
    const SMALL = "ok\\u00e9";
    const LEADING = ${JSON.stringify(leading)};
  `;
  const outOfMemory = { name: "RangeError", message: "Out of memory" };
  const smallEncoded = [0x6f, 0x6b, 0xc3, 0xa9];

  async function runChild(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + script],
      env,
      stdout: "pipe",
      // ASAN prints a "failed to allocate" warning for every refused allocation;
      // drain it, don't assert on it.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }));
    return { result, exitCode };
  }

  test.concurrent("output enqueued to JS: the write rejects and the readable errors", async () => {
    const { result, exitCode } = await runChild(/* js */ `
      const results = {};
      for (const [name, makeInput] of Object.entries(inputs)) {
        const stream = new TextEncoderStream();
        const reader = stream.readable.getReader();
        const writer = stream.writable.getWriter();
        const read = reader.read();
        results[name] = {
          write: await writer.write(makeInput()).then(() => "resolved", describeError),
          read: await read.then(chunk => "resolved with " + chunk.value?.length + " bytes", describeError),
        };
      }
      // Encoding still works in this process afterwards.
      const stream = new TextEncoderStream();
      const writer = stream.writable.getWriter();
      writer.write(SMALL);
      writer.close();
      results.afterwards = Array.from(await new Response(stream.readable).bytes());
      console.log(JSON.stringify(results));
    `);
    expect(result).toEqual({
      latin1: { write: outOfMemory, read: outOfMemory },
      latin1Grow: { write: outOfMemory, read: outOfMemory },
      latin1Stuck: { write: outOfMemory, read: outOfMemory },
      utf16: { write: outOfMemory, read: outOfMemory },
      utf16Invalid: { write: outOfMemory, read: outOfMemory },
      afterwards: smallEncoded,
    });
    expect(exitCode).toBe(0);
  });

  // With a native sink attached (Bun.serve's response sink here) the encoder
  // writes into its own buffer and hands that to the sink instead of enqueueing
  // Uint8Arrays: a separate entry point into the same encoders. Each chunk is
  // preceded by a dangling lead surrogate, so the output has to be assembled in
  // the encoder's buffer (the replacement goes in front of the chunk's bytes);
  // that is the case the sink path owns even if plain chunks are ever handed to
  // the sink directly (#36877), and it also covers the prepend variant of every
  // reservation. The errored transform cancels the stream piped into it, so the
  // source's cancel reason is where the error shows up.
  test.concurrent("output written to a native sink: the transform errors and the server keeps serving", async () => {
    const { result, exitCode } = await runChild(/* js */ `
      const cancelReasons = {};
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const name = new URL(req.url).pathname.slice(1);
          const { promise, resolve } = Promise.withResolvers();
          cancelReasons[name] = promise;
          const source = new ReadableStream({
            start(controller) {
              controller.enqueue(LEADING);
              if (name in inputs) {
                controller.enqueue(inputs[name]());
              } else {
                controller.enqueue(SMALL);
                controller.close();
              }
            },
            cancel: reason => resolve(describeError(reason)),
          });
          return new Response(source.pipeThrough(new TextEncoderStream()));
        },
      });
      const results = {};
      for (const name of Object.keys(inputs)) {
        // The failed body closes the connection without a complete response:
        // fetch() itself or the body read rejects, depending on whether the
        // headers were already flushed.
        await fetch(new URL(name, server.url)).then(response => response.arrayBuffer()).catch(() => {});
        results[name] = await cancelReasons[name];
      }
      results.afterwards = Array.from(await (await fetch(new URL("small", server.url))).bytes());
      server.stop(true);
      console.log(JSON.stringify(results));
    `);
    expect(result).toEqual({
      latin1: outOfMemory,
      latin1Grow: outOfMemory,
      latin1Stuck: outOfMemory,
      utf16: outOfMemory,
      utf16Invalid: outOfMemory,
      afterwards: replacementEncoded.concat(smallEncoded),
    });
    expect(exitCode).toBe(0);
  });
});
