/**
 * StringDecoder#write() and #end() with a view whose ArrayBuffer was transferred.
 *
 * Node reads the bytes of `buf` in C++, where such a view has length 0:
 * https://github.com/nodejs/node/blob/v26.12.1/src/string_decoder.cc#L263
 * https://github.com/nodejs/node/blob/v26.12.1/src/util-inl.h#L600-L611
 * So write() returns "" and keeps a partial character, and end() only flushes it.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from (Node.js v26.3.0
 * and v26.12.1). It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { createInterface, emitKeypressEvents } from "node:readline";
import { PassThrough, Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { describe, test } from "node:test";
import { inherits } from "node:util";

type Decoder = StringDecoder & {
  lastNeed: number;
  lastTotal: number;
  lastChar: Buffer;
  text(buf: unknown, offset: number): string;
};
type DecoderClass = new (encoding?: string) => Decoder;

// The three kinds of receiver that reach the native decoder: the class, a subclass, and a function that calls it.
function CalledStringDecoder(this: unknown, ...args: unknown[]) {
  (StringDecoder as unknown as Function).apply(this, args);
}
inherits(CalledStringDecoder, StringDecoder);
class SubStringDecoder extends StringDecoder {}
const decoders = [StringDecoder, SubStringDecoder, CalledStringDecoder] as unknown as DecoderClass[];

// [name, a function that returns a new view of that kind whose ArrayBuffer was transferred]
const detachedViews: [string, () => NodeJS.ArrayBufferView][] = (
  [
    ["Uint8Array", () => new Uint8Array(8)],
    ["Buffer", () => Buffer.from(new ArrayBuffer(8))],
    ["DataView", () => new DataView(new ArrayBuffer(16), 4, 8)],
    ["Float64Array", () => new Float64Array(4)],
  ] as [string, () => NodeJS.ArrayBufferView][]
).map(([name, create]) => [
  name,
  () => {
    const view = create();
    (view.buffer as ArrayBuffer).transfer();
    return view;
  },
]);
const detachedBuffer = detachedViews[1][1];

const encodings = ["utf8", "utf16le", "ucs2", "base64", "base64url", "hex", "latin1", "ascii"];

// [encoding, bytes that stay buffered, what end() flushes for them, the rest of the character, the character]
const partialCharacters: [string, number[], string, number[], string][] = [
  ["utf8", [0xe2, 0x82], "\ufffd", [0xac], "€"],
  ["utf16le", [0x3d, 0xd8], "\ud83d", [0x4d, 0xdc], "\ud83d\udc4d"],
  ["utf16le", [0x61], "", [0x00], "a"],
  ["base64", [0x61], "YQ==", [0x62, 0x63], "YWJj"],
  ["base64url", [0x61, 0x62], "YWI", [0x63], "YWJj"],
];

for (const Decoder of decoders) {
  describe(`${Decoder.name}: a detached view is an empty chunk`, () => {
    for (const [name, view] of detachedViews) {
      test(`write() and end() of a detached ${name} return an empty string`, () => {
        const results = encodings.map(encoding => [
          encoding,
          new Decoder(encoding).write(view()),
          new Decoder(encoding).end(view()),
        ]);
        assert.deepStrictEqual(
          results,
          encodings.map(encoding => [encoding, "", ""]),
        );
      });
    }

    for (const [encoding, bytes, flushed, rest, character] of partialCharacters) {
      test(`${encoding}: write() keeps the partial character ${JSON.stringify(bytes)}`, () => {
        for (const [, view] of detachedViews) {
          const decoder = new Decoder(encoding);
          assert.strictEqual(decoder.write(Buffer.from(bytes)), "");
          assert.deepStrictEqual([decoder.write(view()), decoder.write(view())], ["", ""]);
          assert.strictEqual(decoder.write(Buffer.from(rest)), character);
        }
      });

      test(`${encoding}: end() flushes the partial character ${JSON.stringify(bytes)}`, () => {
        for (const [, view] of detachedViews) {
          const decoder = new Decoder(encoding);
          assert.strictEqual(decoder.write(Buffer.from(bytes)), "");
          assert.strictEqual(decoder.end(view()), flushed);
          assert.deepStrictEqual([decoder.end(view()), decoder.end()], ["", ""]);
        }
      });
    }

    test("end() leaves no partial character for the next write()", () => {
      const decoder = new Decoder("utf8");
      assert.strictEqual(decoder.write(Buffer.from([0xe2, 0x82])), "");
      assert.strictEqual(decoder.end(detachedBuffer()), "\ufffd");
      // The flushed bytes are gone, so the last byte of "€" stands alone.
      assert.strictEqual(decoder.write(Buffer.from([0xac])), "\ufffd");
    });

    test("write() of null and text() of a detached view still throw", () => {
      assert.throws(() => new Decoder("utf8").write(null as never), {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
      });
      // text() is write(buf.slice(offset)), and slice() of a detached view throws.
      for (const [, view] of detachedViews) assert.throws(() => new Decoder("utf8").text(view(), 0), TypeError);
    });
  });
}

describe("lastNeed, lastTotal and lastChar", () => {
  const state = (decoder: Decoder) => ({
    lastNeed: decoder.lastNeed,
    lastTotal: decoder.lastTotal,
    lastChar: Array.from(decoder.lastChar),
  });

  for (const [encoding, bytes] of partialCharacters) {
    test(`${encoding} ${JSON.stringify(bytes)}: write() of a detached view changes nothing, end() resets them`, () => {
      for (const [, view] of detachedViews) {
        const decoder = new (StringDecoder as unknown as DecoderClass)(encoding);
        decoder.write(Buffer.from(bytes));
        const partial = state(decoder);
        assert.ok(partial.lastNeed > 0);
        decoder.write(view());
        assert.deepStrictEqual(state(decoder), partial);
        decoder.end(view());
        assert.deepStrictEqual(state(decoder), { lastNeed: 0, lastTotal: 0, lastChar: partial.lastChar });
      }
    });
  }
});

// A Readable decodes its chunks with a StringDecoder, and readline does the same with each "data" chunk of its input.
describe("a stream that decodes a detached chunk", () => {
  test("Readable#setEncoding() decodes the buffered chunks around it", () => {
    const chunk = Buffer.from(new ArrayBuffer(4));
    const readable = new Readable({ read() {} });
    readable.push(Buffer.from("a"));
    readable.push(chunk);
    readable.push(Buffer.from("z"));
    chunk.buffer.transfer();
    readable.setEncoding("utf8");
    assert.strictEqual(readable.read(), "az");
  });

  test("an objectMode Readable with an encoding reads it as an empty string", () => {
    const readable = new Readable({ objectMode: true, encoding: "utf8", read() {} });
    assert.deepStrictEqual([readable.push(detachedBuffer()), readable.read()], [true, ""]);
  });

  test("readline reads the line around it", () => {
    const input = new PassThrough();
    const lines: string[] = [];
    const rl = createInterface({ input, terminal: false });
    rl.on("line", line => lines.push(line));
    input.emit("data", Buffer.from("a\nb"));
    input.emit("data", detachedBuffer());
    input.emit("data", Buffer.from("c\n"));
    rl.close();
    assert.deepStrictEqual(lines, ["a", "bc"]);
  });

  test("emitKeypressEvents() reads the keys after it", () => {
    const input = new PassThrough();
    const keys: string[] = [];
    emitKeypressEvents(input);
    input.on("keypress", (sequence: string) => keys.push(sequence));
    input.emit("data", detachedBuffer());
    input.emit("data", Buffer.from("a"));
    assert.deepStrictEqual(keys, ["a"]);
  });
});
