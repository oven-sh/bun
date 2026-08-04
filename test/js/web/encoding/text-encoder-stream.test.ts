import { expect, test } from "bun:test";
import { readableStreamFromArray } from "harness";

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

// Native-sink path: 8-bit (Latin-1) chunks go straight to the sink's own
// write_latin1. An all-ASCII chunk is zero-copy; a chunk with bytes 128-255
// is widened to 2-byte UTF-8 inside the sink.
test("TextEncoderStream -> native HTTP sink: 8-bit chunks (ASCII + Latin-1 non-ASCII)", async () => {
  const ascii = Buffer.alloc(300_000, "plain ascii run.").toString();
  const latin1 = "caf\xe9 \xffna\xefve \xbd"; // é ÿ ï ½
  const chunks = [ascii, latin1, "mid", latin1, ascii];
  const expected = Buffer.from(new TextEncoder().encode(chunks.join("")));
  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream<string>({
        start(c) {
          for (const s of chunks) c.enqueue(s);
          c.close();
        },
      });
      return new Response(body.pipeThrough(new TextEncoderStream()));
    },
  });
  const out = Buffer.from(await (await fetch(server.url)).arrayBuffer());
  expect(out.byteLength).toBe(expected.byteLength);
  expect(Buffer.compare(out, expected)).toBe(0);
});

// Native-sink path: 16-bit chunks go straight to the sink's own write_utf16.
// The encoder still owns cross-chunk surrogate carry (trailing lone lead), and
// mid-chunk lone surrogates become U+FFFD via the sink.
test("TextEncoderStream -> native HTTP sink: 16-bit chunks with surrogate edge cases", async () => {
  const chunks = [
    "A" + leading + leading, // 8-bit "A" roped with a 16-bit tail: mid-chunk lone lead + trailing lone lead
    trailing + "B", // completes the carried pair
    trailing, // lone trail, no carry -> FFFD
    leading + leading + trailing, // mid-chunk lone lead + valid pair
    "\u{1F499}".repeat(2000), // long 16-bit run
    leading + trailing + leading, // valid pair then trailing lone lead
    trailing, // completes
    leading, // dangling -> FFFD at flush
  ];
  // Interpret lone surrogates the spec way via a per-chunk TextEncoder (each
  // chunk's trailing lone lead carries, each chunk's leading lone trail is
  // replaced): equivalent to pushing the chunks through a second, known-good
  // TextEncoderStream.
  const ref = Buffer.from(
    await new Response(readableStreamFromArray(chunks).pipeThrough(new TextEncoderStream())).arrayBuffer(),
  );
  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream<string>({
        start(c) {
          for (const s of chunks) c.enqueue(s);
          c.close();
        },
      });
      return new Response(body.pipeThrough(new TextEncoderStream()));
    },
  });
  const out = Buffer.from(await (await fetch(server.url)).arrayBuffer());
  expect(out.toString("hex")).toBe(ref.toString("hex"));
});

// HTMLRewriter's sink runs user JS (content handlers) while the input slice is
// still being parsed; a non-string chunk exercises the ToString-created JSString
// being kept rooted across that call.
test("TextEncoderStream -> HTMLRewriter native sink: non-string chunks + handler that allocates", async () => {
  const ascii = Buffer.alloc(4096, "a").toString();
  const body = new ReadableStream({
    start(c) {
      c.enqueue("<div>");
      c.enqueue({ toString: () => "<p>" + ascii + "</p>" }); // 8-bit, ToString-coerced
      c.enqueue({ toString: () => "<p>\u{1F499}</p>" }); // 16-bit, ToString-coerced
      c.enqueue("</div>");
      c.close();
    },
  });
  let seen = 0;
  const out = await new HTMLRewriter()
    .on("p", {
      element() {
        seen++;
        Bun.gc(true);
      },
    })
    .transform(new Response(body.pipeThrough(new TextEncoderStream())))
    .text();
  expect(seen).toBe(2);
  expect(out).toBe("<div><p>" + ascii + "</p><p>\u{1F499}</p></div>");
});

// Poll `get()` once per tick until it stays unchanged for 5 consecutive
// samples (parked on backpressure) or reaches `total` (ran away).
async function waitUntilStable(get: () => number, total: number) {
  let last = get();
  let stable = 0;
  while (stable < 5 && get() < total) {
    await Bun.sleep(1);
    const now = get();
    if (now === last) stable++;
    else {
      stable = 0;
      last = now;
    }
  }
}

// Native-sink backpressure: when the HTTP response sink's socket buffer fills
// (slow client), the sink's write_latin1 returns Backpressure and the writable
// side parks on m_nativeSinkReadyPromise. Without that, a fast source with a
// stalled client fills the sink buffer unboundedly.
test("TextEncoderStream -> native HTTP sink applies backpressure to a stalled client", async () => {
  let pulls = 0;
  const chunk = Buffer.alloc(64 * 1024, "x").toString();
  const TOTAL = 200;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      const body = new ReadableStream<string>({
        pull(c) {
          pulls++;
          c.enqueue(chunk);
          if (pulls >= TOTAL) c.close();
        },
      });
      return new Response(body.pipeThrough(new TextEncoderStream()));
    },
  });
  const res = await fetch(server.url);
  const reader = res.body!.getReader();
  await reader.read();
  await waitUntilStable(() => pulls, TOTAL);
  const pullsWhileStalled = pulls;
  while (!(await reader.read()).done) {}
  expect(pullsWhileStalled).toBeLessThan(TOTAL);
  expect(pulls).toBe(TOTAL);
});

// Readable-side backpressure (no native sink): the readable queue's HWM is 1,
// so a single write completes without a reader, and a second write parks until
// the readable side is drained.
test("TextEncoderStream readable-side backpressure: second write stays pending until drained", async () => {
  const tes = new TextEncoderStream();
  const writer = tes.writable.getWriter();
  const reader = tes.readable.getReader();

  await writer.write("first");
  const second = writer.write("second");
  const raced = await Promise.race([second.then(() => "done"), Bun.sleep(0).then(() => "pending")]);
  expect(raced).toBe("pending");

  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("first");
  await second;

  void writer.close();
  const rest: Uint8Array[] = [];
  for (let r; !(r = await reader.read()).done; ) rest.push(r.value);
  expect(new TextDecoder().decode(Buffer.concat(rest))).toBe("second");
});
