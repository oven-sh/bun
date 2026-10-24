// JSON read from UTF-8 bytes must give what JSON.parse gives for the text TextDecoder makes of the same bytes: the same value
// or the same error. Every case is drawn from a seed. JSON_FROM_BYTES_SEED and JSON_FROM_BYTES_CASES choose other cases.
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

const firstSeed = Number(process.env.JSON_FROM_BYTES_SEED ?? 1);
const cases = Number(process.env.JSON_FROM_BYTES_CASES ?? (isDebug || isASAN ? 1500 : 6000));

function generator(seed: number) {
  let state = (seed * 0x9e3779b9) >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  const below = (limit: number) => next() % limit;
  const pick = <T>(list: readonly T[]) => list[below(list.length)];
  return { below, pick, chance: (oneIn: number) => below(oneIn) === 0 };
}
type Random = ReturnType<typeof generator>;

const encoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const lengths = [0, 1, 2, 3, 7, 8, 14, 15, 16, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 63, 64, 65, 85, 86, 127, 128];
const longLengths = [129, 254, 255, 256, 257, 258, 300, 511, 513, 1000, 4097];
const alphabets = [
  "abcdefghijklmnopqrstuvwxyz0123456789 _-./:",
  "abc \u00e9\u00fc\u00ff\u00a0\u0080",
  "ab\u0100\u07ff\u0800\u2014\u4e2d\u6587\ufffd\uffff\ufeff\u200c\u200d",
  "a\u{10000}\u{1f600}\u{10ffff}",
  "\u4e2d\u6587\u5b57\u7b26\u3042\u3044\uac00",
  "a\u00e9\u4e2d\u{1f600}",
];
const escapes = [
  '\\"',
  "\\\\",
  "\\/",
  "\\b",
  "\\f",
  "\\n",
  "\\r",
  "\\t",
  "\\u0041",
  "\\u00e9",
  "\\u4e2d",
  "\\ud83d\\ude00",
  "\\ud800",
  "\\udc00",
  "\\u0000",
  "\\uFFFF",
];
const names = [
  "a",
  "id",
  "type",
  "name",
  "text",
  "content",
  "a-name-of-twenty-eight-letter",
  "a name that is a good deal longer than thirty-two characters",
  "\u00e9",
  "caf\u00e9",
  "\u4e2d\u6587",
  "\u{1f600}",
  "k\u2014",
  "",
  "0",
  "1",
  "__proto__",
  "x".repeat(300),
  "\u4e2d".repeat(90),
  "\u00e9".repeat(130),
];
const numbers = [
  "0",
  "-0",
  "1",
  "-1",
  "12",
  "999999999",
  "1000000000",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967296",
  "9007199254740993",
  "123456789012345678901234567890",
  "0.1",
  "-0.0",
  "1.5e3",
  "1E-7",
  "1e400",
  "-1e400",
  "1e-400",
  "2.2250738585072014e-308",
  "0.30000000000000004",
  "1".repeat(400),
  "0." + "3".repeat(400),
];
const spaces = ["", "", "", "", " ", "\t", "\r", "  ", " \t "];

function stringLiteral(random: Random): string {
  const alphabet = Array.from(random.pick(alphabets));
  const length = random.chance(8) ? random.pick(longLengths) : random.pick(lengths);
  const escapesOneIn = random.pick([0, 0, 3, 20, 100]);
  let text = '"';
  for (let i = 0; i < length; i++)
    text += escapesOneIn && random.chance(escapesOneIn) ? random.pick(escapes) : random.pick(alphabet);
  return text + '"';
}

function nameLiteral(random: Random): string {
  if (random.chance(12)) return stringLiteral(random);
  const name = random.pick(names);
  if (random.chance(15))
    return '"' + Array.from(name, unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0")).join("") + '"';
  return JSON.stringify(name);
}

function valueText(random: Random, depth: number): string {
  const kind = random.below(depth > 4 ? 6 : 10);
  const space = () => random.pick(spaces);
  if (kind < 3) return stringLiteral(random);
  if (kind < 5) return random.pick(numbers);
  if (kind < 6) return random.pick(["true", "false", "null"]);
  const count = random.pick([0, 1, 2, 3, 5, 9]);
  const parts: string[] = [];
  if (kind < 8) {
    for (let i = 0; i < count; i++)
      parts.push(space() + nameLiteral(random) + space() + ":" + space() + valueText(random, depth + 1) + space());
    return "{" + (count ? parts.join(",") : space()) + "}";
  }
  for (let i = 0; i < count; i++) parts.push(space() + valueText(random, depth + 1) + space());
  return "[" + (count ? parts.join(",") : space()) + "]";
}

const brokenPieces: number[][] = [
  [0x80],
  [0xbf],
  [0xc0],
  [0xc1, 0xbf],
  [0xc0, 0x80],
  [0xc2],
  [0xc3],
  [0xdf],
  [0xe0, 0x80, 0x80],
  [0xe0, 0x9f, 0xbf],
  [0xe0, 0xa0],
  [0xe2, 0x80],
  [0xe2],
  [0xed, 0xa0, 0x80],
  [0xed, 0xbf, 0xbf],
  [0xed, 0x9f],
  [0xef, 0xbb],
  [0xef, 0xbb, 0xbf],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf0, 0x8f, 0xbf, 0xbf],
  [0xf0, 0x9f, 0x98],
  [0xf0, 0x9f],
  [0xf0],
  [0xf4, 0x8f, 0xbf],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5, 0x80, 0x80, 0x80],
  [0xf8],
  [0xfe],
  [0xff],
  [0xff, 0xfe],
  [0xe2, 0x80, 0x8c],
  [0xe2, 0x80, 0x8d],
  [0xc2, 0xa0],
  [0xe2, 0x80, 0xa8],
  [0x00],
  [0x1f],
  [0x7f],
  [0x22],
  [0x5c],
  [0x5c, 0x75],
  [0x5c, 0x75, 0x31, 0x32],
  [0x5c, 0x78],
  [0x0a],
  [0x2c],
  [0x3a],
  [0x7b],
  [0x7d],
  [0x5b],
  [0x5d],
  [0x27],
  [0x74, 0x72, 0x75],
  [0x6e, 0x75, 0x6c],
];

function damage(random: Random, bytes: Uint8Array): Uint8Array {
  let list = Array.from(bytes);
  for (let times = random.pick([1, 1, 1, 2, 4]); times > 0; times--) {
    const at = random.below(list.length + 1);
    switch (random.below(5)) {
      case 0:
        list = list.slice(0, at);
        break;
      case 1:
        list.splice(at, 0, ...random.pick(brokenPieces));
        break;
      case 2:
        list.splice(at, random.pick([1, 1, 2, 3]));
        break;
      case 3:
        if (at < list.length) list[at] = random.below(256);
        break;
      default:
        list.splice(at, random.pick([1, 2, 3]), ...random.pick(brokenPieces));
    }
  }
  return new Uint8Array(list);
}

type Outcome = { value: unknown } | { error: string };
function outcomeOf(run: () => unknown): Outcome {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).name + ": " + (error as Error).message };
  }
}
async function outcomeOfPromise(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: (error as Error).name + ": " + (error as Error).message };
  }
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
function expectSame(actual: Outcome, expected: Outcome, what: string, seed: number, bytes: Uint8Array) {
  if (Bun.deepEquals(actual, expected, true) && JSON.stringify(actual) === JSON.stringify(expected)) return;
  const shown = bytes.length > 600 ? hex(bytes.subarray(0, 600)) + ".." : hex(bytes);
  throw new Error(
    `${what} differs from JSON.parse of the decoded text. seed ${seed}, bytes ${shown}\nactual   ${JSON.stringify(actual)?.slice(0, 400)}\nexpected ${JSON.stringify(expected)?.slice(0, 400)}`,
  );
}

function bytesOfCase(random: Random): Uint8Array {
  const bytes = encoder.encode(random.pick(spaces) + valueText(random, 0) + random.pick(spaces));
  return random.chance(2) ? damage(random, bytes) : bytes;
}

// What json() of a body does in front of the parser. A Response or a Request looks for an empty body before it drops the mark, a Blob behind that.
function expectedOfBody(bytes: Uint8Array, kind: "blob" | "response"): Outcome {
  const whole = bytes;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  if (!(kind === "blob" ? bytes : whole).length) return { error: "SyntaxError: Unexpected end of JSON input" };
  return outcomeOf(() => JSON.parse(decode(bytes)));
}
const beginsWithUTF16Mark = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;

describe("JSON from UTF-8 bytes against JSON.parse of the decoded text", () => {
  test("Bun.JSONL.parse and parseChunk of one value", () => {
    for (let seed = firstSeed; seed < firstSeed + cases; seed++) {
      const random = generator(seed);
      const bytes = bytesOfCase(random);
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) continue;
      const text = decode(bytes);
      const fromText = Bun.JSONL.parseChunk(text);
      const fromBytes = Bun.JSONL.parseChunk(bytes);
      expectSame(
        { value: [fromBytes.values, fromBytes.done, fromBytes.error?.message ?? null] },
        { value: [fromText.values, fromText.done, fromText.error?.message ?? null] },
        "parseChunk",
        seed,
        bytes,
      );
      if (decode(bytes.subarray(0, fromBytes.read)) !== text.slice(0, fromText.read))
        throw new Error(
          `parseChunk read ${fromBytes.read} bytes, the text road ${fromText.read} characters. seed ${seed}, bytes ${hex(bytes)}`,
        );
      expectSame(
        outcomeOf(() => Bun.JSONL.parse(bytes)),
        outcomeOf(() => Bun.JSONL.parse(text)),
        "parse",
        seed,
        bytes,
      );
    }
  }, 120_000);

  test("Bun.JSONL.parseChunk of many lines, whole and in slices", () => {
    for (let seed = firstSeed; seed < firstSeed + cases / 4; seed++) {
      const random = generator(seed ^ 0x5bd1e995);
      const parts: Uint8Array[] = [];
      for (let lines = random.pick([1, 2, 3, 8, 30]); lines > 0; lines--) {
        const line = encoder.encode(valueText(random, 1).replaceAll("\r", " "));
        parts.push(
          random.chance(10) ? damage(random, line) : line,
          encoder.encode(random.pick(["\n", "\n", "\n", "\r\n", "\n\n", " \n", ""])),
        );
      }
      const bytes = new Uint8Array(Buffer.concat(parts));
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) continue;
      const end = random.chance(2) ? bytes.length : random.below(bytes.length + 1);
      const slice = bytes.subarray(0, end);
      const text = decode(slice);
      const fromText = Bun.JSONL.parseChunk(text);
      for (const fromBytes of [Bun.JSONL.parseChunk(slice), Bun.JSONL.parseChunk(bytes, 0, end)]) {
        expectSame(
          { value: [fromBytes.values, fromBytes.done, fromBytes.error?.message ?? null] },
          { value: [fromText.values, fromText.done, fromText.error?.message ?? null] },
          "parseChunk",
          seed,
          slice,
        );
        if (decode(slice.subarray(0, fromBytes.read)) !== text.slice(0, fromText.read))
          throw new Error(
            `parseChunk read ${fromBytes.read} bytes, the text road ${fromText.read} characters. seed ${seed}, bytes ${hex(slice)}`,
          );
      }
    }
  }, 120_000);

  test("short texts of three-byte sequences, well formed and not, at every place", () => {
    const sequences = [
      [0xe0, 0x80, 0x80],
      [0xe0, 0x9f, 0xbf],
      [0xe0, 0xa0, 0x80],
      [0xe1, 0x80, 0x80],
      [0xe4, 0xb8, 0xad],
      [0xec, 0xbf, 0xbf],
      [0xed, 0x80, 0x80],
      [0xed, 0x9f, 0xbf],
      [0xed, 0xa0, 0x80],
      [0xed, 0xbf, 0xbf],
      [0xee, 0x80, 0x80],
      [0xef, 0xbb, 0xbf],
      [0xef, 0xbf, 0xbd],
      [0xef, 0xbf, 0xbf],
      [0xe2, 0x80, 0xc0],
      [0xe2, 0xc0, 0x80],
      [0xe2, 0xe2, 0x80],
      [0x80, 0x80, 0x80],
      [0xc3, 0xa9, 0x80],
      [0xc3, 0xa9, 0xc3],
      [0xf0, 0x9f, 0x98],
      [0xf4, 0x90, 0x80],
      [0xff, 0xbf, 0xbf],
    ];
    const plain = [0xe4, 0xb8, 0xad];
    for (const tail of ['"\n', '",1]          \n', '"                 \n']) {
      for (let count = 1; count <= 6; count++) {
        for (let place = 0; place < count; place++) {
          for (const sequence of sequences) {
            const inner: number[] = [];
            for (let i = 0; i < count; i++) inner.push(...(i === place ? sequence : plain));
            const open = tail.startsWith('",') ? [0x5b, 0x22] : [0x22];
            const bytes = new Uint8Array([...open, ...inner, ...encoder.encode(tail)]);
            expect(Bun.JSONL.parse(bytes)).toEqual(Bun.JSONL.parse(decode(bytes)));
          }
        }
      }
    }
  });

  test("`read` counts the bytes of invalid sequences as they are", () => {
    for (const broken of brokenPieces.filter(piece => piece[0] >= 0x80)) {
      const first = new Uint8Array([0x22, 0x61, ...broken, 0x62, 0x22]);
      const bytes = new Uint8Array([...first, 0x0a, 0x5b, 0x31, 0x2c]);
      const result = Bun.JSONL.parseChunk(bytes);
      expect(result.values).toEqual([decode(first.subarray(1, first.length - 1))]);
      expect(result.read).toBe(first.length);
      expect(result.done).toBe(false);
    }
  });

  test("json() of a Response, a Request and a Blob", async () => {
    for (let seed = firstSeed; seed < firstSeed + cases / 2; seed++) {
      const random = generator(seed ^ 0x2545f491);
      let bytes = bytesOfCase(random);
      if (random.chance(20)) bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
      if (beginsWithUTF16Mark(bytes)) continue;
      expectSame(
        await outcomeOfPromise(() => new Response(bytes).json()),
        expectedOfBody(bytes, "response"),
        "Response.json()",
        seed,
        bytes,
      );
      expectSame(
        await outcomeOfPromise(() => new Blob([bytes]).json()),
        expectedOfBody(bytes, "blob"),
        "Blob.json()",
        seed,
        bytes,
      );
      if (seed % 4 === 0)
        expectSame(
          await outcomeOfPromise(() => new Request("http://localhost/", { method: "POST", body: bytes }).json()),
          expectedOfBody(bytes, "response"),
          "Request.json()",
          seed,
          bytes,
        );
    }
  }, 120_000);

  test("json() of a file", async () => {
    using dir = tempDir("json-from-utf8-bytes", {});
    const path = join(String(dir), "value.json");
    for (let seed = firstSeed; seed < firstSeed + cases / 20; seed++) {
      const random = generator(seed ^ 0x27d4eb2f);
      const bytes = bytesOfCase(random);
      if (beginsWithUTF16Mark(bytes)) continue;
      await Bun.write(path, bytes);
      expectSame(
        await outcomeOfPromise(() => Bun.file(path).json()),
        expectedOfBody(bytes, "blob"),
        "Bun.file().json()",
        seed,
        bytes,
      );
    }
  }, 120_000);

  test("arrays and objects nested beyond the native stack", () => {
    for (const depth of [1000, 100000, 600000]) {
      for (const [open, close] of [
        ["[", "]"],
        ['{"\u00e9":', "}"],
      ]) {
        for (const leaf of ['"\u4e2d"', "1", ""]) {
          const text = open.repeat(depth) + leaf + close.repeat(leaf ? depth : 0);
          const fromText = Bun.JSONL.parseChunk(text);
          const fromBytes = Bun.JSONL.parseChunk(encoder.encode(text));
          expect([fromBytes.values.length, fromBytes.done, fromBytes.error?.message]).toEqual([
            fromText.values.length,
            fromText.done,
            fromText.error?.message,
          ]);
        }
      }
    }
  }, 120_000);

  test("a line nested beyond the native stack among other lines", () => {
    const depthOf = (value: unknown) => {
      let depth = 0;
      for (; Array.isArray(value); value = value[0]) depth++;
      return depth;
    };
    const summaryOf = (values: unknown[]) =>
      values.map(value => (Array.isArray(value) ? depthOf(value) : JSON.stringify(value)));
    const [first, second] = ['{"a":"\u00e9\u4e2d"}', '{"b":2}'];
    for (const depth of [1000, 600000]) {
      const deep = "[".repeat(depth) + "]".repeat(depth);
      for (const [lines, values] of [
        [
          [first, second, deep],
          [first, second, depth],
        ],
        [
          [first, deep, second],
          [first, depth, second],
        ],
        [
          [deep, first, second],
          [depth, first, second],
        ],
        [
          [first, deep, deep],
          [first, depth, depth],
        ],
        [
          [first, second, deep, '{"c":'],
          [first, second, depth],
        ],
        [
          [first, second, deep, "}"],
          [first, second, depth],
        ],
      ] as [string[], (string | number)[]][]) {
        const text = lines.join("\n") + "\n";
        const bytes = encoder.encode(text);
        expect(summaryOf(Bun.JSONL.parse(bytes))).toEqual(values);
        expect(summaryOf(Bun.JSONL.parse(text))).toEqual(values);
        const [fromText, fromBytes] = [Bun.JSONL.parseChunk(text), Bun.JSONL.parseChunk(bytes)];
        expect(summaryOf(fromBytes.values)).toEqual(values);
        expect([fromBytes.read, fromBytes.done, fromBytes.error?.message]).toEqual([
          encoder.encode(text.slice(0, fromText.read)).length,
          fromText.done,
          fromText.error?.message,
        ]);
      }
    }
  }, 120_000);

  test("a name or a text seen as Latin-1 is not taken for the same bytes of UTF-8, nor the other way around", () => {
    for (const name of ["\u00e9", "caf\u00e9", "\u00c3\u00a9", "\u00ff\u00fe"]) {
      const latin1 = JSON.stringify([
        { [name]: name + " value" },
        { [name]: name + " value" },
        { [name]: name + " value" },
      ]);
      const sameBytes = Uint8Array.from(latin1, character => character.charCodeAt(0));
      for (let round = 0; round < 3; round++) {
        expect(JSON.parse(latin1)[2]).toEqual({ [name]: name + " value" });
        expect(Bun.JSONL.parse(sameBytes)).toEqual([JSON.parse(decode(sameBytes))]);
        expect(Bun.JSONL.parse(encoder.encode(latin1))).toEqual([JSON.parse(latin1)]);
      }
    }
  });

  test("bytes shared with another thread are read", () => {
    const text = JSON.stringify({ text: "\u4e2d\u6587 ".repeat(200) });
    const shared = new Uint8Array(new SharedArrayBuffer(1024 * 4));
    const { written } = encoder.encodeInto(text + "\n", new Uint8Array(4096));
    shared.set(encoder.encode(text + "\n"));
    expect(Bun.JSONL.parseChunk(shared, 0, written).values).toEqual([JSON.parse(text)]);
    expect(Bun.JSONL.parse(shared.subarray(0, written))).toEqual([JSON.parse(text)]);
  });
});

describe("the width of texts read from UTF-8 bytes", () => {
  const sizeOf = (text: string) => estimateShallowMemoryUsageOf(text);
  const ascii = "the quick brown fox jumps over the lazy dog. ".repeat(40);

  test("a character beyond Latin-1 widens its own text and no other", async () => {
    for (const escape of ["", "\\n"]) {
      const line = `{"wide":"${ascii}${escape}\u4e2d","ascii":"${ascii}${escape}","latin1":"${ascii}${escape}\u00e9"}`;
      const bytes = encoder.encode(line + "\n");
      for (const value of [
        Bun.JSONL.parse(bytes)[0],
        Bun.JSONL.parseChunk(bytes).values[0],
        await new Response(bytes).json(),
        await new Blob([bytes]).json(),
      ] as Record<string, string>[]) {
        expect(value).toEqual(JSON.parse(line));
        expect(sizeOf(value.wide)).toBeGreaterThan(2 * ascii.length);
        expect(sizeOf(value.ascii)).toBeLessThan(1.5 * ascii.length);
        expect(sizeOf(value.latin1)).toBeLessThan(1.5 * ascii.length);
      }
    }
  });
});
