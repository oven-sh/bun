// The rules of the formats one at a time, in streams made by hand.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import zlib from "node:zlib";
import { Engine, inflate, nothing, piecesOf, Z_BLOCK, Z_FINISH, Z_SYNC_FLUSH, type Mode } from "./engine";
import { input } from "./inputs";
import {
  adler32,
  be,
  Bits,
  codesOf,
  crc32,
  DYNAMIC,
  dynamic,
  dynamicCounts,
  dynamicHeader,
  END,
  FIXED,
  fixed,
  fixedDistanceCodes,
  fixedLiteralCodes,
  gzipHeader,
  header,
  inGzip,
  inZlib,
  le,
  lengths,
  putTokens,
  STORED,
  stored,
  zlibHeader,
  type Token,
} from "./write";

const text = (s: string) => [...Buffer.from(s, "latin1")];
const concat = (...parts: (Uint8Array | number[])[]) => Buffer.concat(parts.map(part => Buffer.from(part)));
const times = (count: number, s: string) => Buffer.alloc(count * s.length, s, "latin1").toString("latin1");
const [A, B] = text("AB");
/** There is another loop for when much input is left, so what is tried at the end of a block is tried before these, too. */
const tails = [[], Array(40).fill(200)];

/** The output or the error, which have to be the same for input in one piece and byte by byte. */
function read(mode: Mode, data: Uint8Array, options?: zlib.ZlibOptions) {
  const results = [[data], [data, nothing], piecesOf(data, 1)].map(pieces => {
    const { output, error } = inflate(mode, pieces, options);
    return error ?? output.toString("latin1");
  });
  expect(results).toEqual(Array(results.length).fill(results[0]));
  return results[0];
}
/** With bytes behind it, too, as there is another loop for when much input is left. */
function raw(bits: Bits | Buffer) {
  const data = bits instanceof Bits ? bits.end() : bits;
  const result = read("InflateRaw", data);
  if (result !== truncated) expect(read("InflateRaw", concat(data, Buffer.alloc(64, 0xff)))).toBe(result);
  return result;
}
const damaged = (message: string) => `Z_DATA_ERROR ${message}`;
const truncated = "Z_BUF_ERROR unexpected end of file";
const tooFar = damaged("invalid distance too far back");

describe("blocks", () => {
  test("of type 3 do not exist", () => {
    expect(raw(header(new Bits(), 3, true))).toBe(damaged("invalid block type"));
    expect(raw(header(fixed(new Bits(), [A], false), 3, false))).toBe(damaged("invalid block type"));
  });

  test("may be empty", () => {
    const bits = new Bits();
    for (let i = 0; i < 9; i++) {
      stored(bits, nothing, false);
      fixed(bits, [], false);
      dynamic(bits, lengths(257, { [END]: 1 }), [0], [], false);
    }
    expect(raw(fixed(bits, [A], true))).toBe("A");
  });

  test("end with the last one, whichever type it has", () => {
    expect(raw(stored(new Bits(), nothing, true))).toBe("");
    expect(raw(fixed(new Bits(), [], true))).toBe("");
    expect(raw(dynamic(new Bits(), lengths(257, { [END]: 1 }), [0], [], true))).toBe("");
    expect(raw(fixed(new Bits(), [A], false))).toBe(truncated);
  });

  test("are not complete without their last byte", () => {
    const bits = fixed(stored(new Bits(), Buffer.from("abc"), false), [A, { length: 20, distance: 4 }], false);
    const literals = lengths(260, { [A]: 2, [B]: 2, [END]: 2, 259: 2 });
    const data = dynamic(bits, literals, [1, 1], [B, { length: 5, distance: 2 }], true).end();
    expect(raw(data)).toBe("abcA" + times(5, "abcA") + "BABABA");
    for (let length = 0; length < data.length; length++) expect(raw(data.subarray(0, length))).toBe(truncated);
  });

  test("copy from the blocks in front of them", () => {
    const bits = stored(stored(new Bits(), Buffer.from("ab"), false), Buffer.from("cd"), false);
    stored(fixed(bits, [{ length: 3, distance: 4 }], false), Buffer.from("e"), false);
    expect(raw(fixed(bits, [{ length: 9, distance: 8 }], true))).toBe("abcdabce" + "abcdabcea");
  });
});

describe("a stored block", () => {
  test.each([0, 1, 2, 3, 4, 5, 6, 7])("starts at a byte boundary, whatever the bits in front of it: %d", literals => {
    const bits = header(fixed(new Bits(), Array(literals).fill(200), false), STORED, true);
    const padding = -bits.length & 7;
    bits
      .put((1 << padding) - 1, padding)
      .put(1, 16)
      .put(0xfffe, 16)
      .bytes(Buffer.from("z"));
    expect(raw(bits)).toBe(times(literals, "\xc8") + "z");
  });

  test.each([
    [0, 0],
    [1, 0xffff],
    [1, 0x7ffe],
    [0x100, 0xfffe],
    [0xffff, 0xffff],
  ])("has its length twice: %d %d", (length, complement) => {
    const bits = header(new Bits(), STORED, true).align().put(length, 16).put(complement, 16);
    expect(raw(bits)).toBe(damaged("invalid stored block lengths"));
  });

  test.each([64, 32768, 65535, 65536, 100000])("has up to 65535 bytes, with chunkSize %d", chunkSize => {
    const data = input("noise", 65535);
    const matches = [32768, 1, 32767, 300].map(distance => ({ length: 258, distance }));
    const bits = fixed(stored(new Bits(), data, false), matches, true);
    const expected = Buffer.concat([data], 65535 + 4 * 258);
    matches.forEach(({ distance }, i) => {
      for (let at = 65535 + 258 * i, end = at + 258; at < end; at++) expected[at] = expected[at - distance];
    });
    const { output, error } = inflate("InflateRaw", piecesOf(bits.end(), 20000), { chunkSize });
    expect(error).toBeUndefined();
    expect(output.equals(expected)).toBe(true);
  });
});

describe("a fixed block", () => {
  test("has a code for each byte", () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(raw(fixed(new Bits(), all, true))).toBe(Buffer.from(all).toString("latin1"));
  });

  test.each([286, 287])("has no use for the literal/length symbol %d", symbol => {
    const bits = header(new Bits(), FIXED, true).code(fixedLiteralCodes[A]).code(fixedLiteralCodes[symbol]);
    expect(raw(bits)).toBe(damaged("invalid literal/length code"));
  });

  test.each([30, 31])("has no use for the distance symbol %d", symbol => {
    const bits = header(new Bits(), FIXED, true).code(fixedLiteralCodes[A]).code(fixedLiteralCodes[257]);
    expect(raw(bits.code(fixedDistanceCodes[symbol]))).toBe(damaged("invalid distance code"));
  });

  test("is not affected by a dynamic block in front of it", () => {
    const bits = dynamic(new Bits(), lengths(257, { [A]: 1, [END]: 1 }), [0], [A], false);
    expect(raw(fixed(bits, [B, { length: 3, distance: 2 }], true))).toBe("ABABA");
  });
});

describe("a match", () => {
  test("of each length at each short distance", () => {
    const start = input("noise", 70);
    const tokens: Token[] = [...start];
    const expected = [...start];
    for (let distance = 1; distance <= 70; distance++) {
      const near = [-2, -1, 0, 1, 2].map(more => distance + more).filter(length => length >= 3);
      for (const length of [...near, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 48, 63, 64, 65, 100, 200, 257, 258]) {
        // Else it would soon all be the same byte.
        for (const byte of start.subarray(0, distance)) (tokens.push(byte), expected.push(byte));
        tokens.push({ length, distance });
        for (let i = 0; i < length; i++) expected.push(expected[expected.length - distance]);
      }
    }
    const data = fixed(new Bits(), tokens, true).end();
    for (const chunkSize of [97, 1000, 1 << 18]) {
      expect(zlib.inflateRawSync(data, { chunkSize }).equals(Buffer.from(expected))).toBe(true);
    }
  });

  test("of 258 bytes can be written in two ways", () => {
    const match = { length: 258, distance: 1 };
    expect(raw(fixed(new Bits(), [A, match, { ...match, long258: true }], true))).toBe(times(517, "A"));
  });

  test("starts no earlier than the output", () => {
    expect(raw(fixed(new Bits(), [{ length: 3, distance: 1 }], true))).toBe(tooFar);
    expect(raw(fixed(new Bits(), [A, B, { length: 3, distance: 2 }], true))).toBe("ABABA");
    expect(raw(fixed(new Bits(), [A, B, { length: 3, distance: 3 }], true))).toBe(tooFar);
    expect(raw(fixed(new Bits(), [A, B, { length: 258, distance: 32768 }], true))).toBe(tooFar);
  });

  test.each([62, 63, 64, 65])("is checked when there is little or no room, behind %d of 64 bytes", count => {
    const stream = (distance: number) => fixed(new Bits(), [...Array(count).fill(A), { length: 9, distance }], true);
    expect(read("InflateRaw", stream(count).end(), { chunkSize: 64 })).toBe(times(count + 9, "A"));
    expect(read("InflateRaw", stream(count + 1).end(), { chunkSize: 64 })).toBe(tooFar);
    expect(inflate("InflateRaw", [stream(count + 1).end()], { chunkSize: 64 }).output.length).toBe(count & 64);
  });

  test.each([8, 9, 12, 15])("reaches back as far as windowBits %d says", windowBits => {
    const window = 1 << windowBits;
    for (const length of [window - 1, window, window + 1, 40000]) {
      const [data, reach] = [input("noise", length), Math.min(length, window)];
      const start = stored(new Bits(), data, false).end();
      for (const tail of tails) {
        for (const literals of [[], [A], [A, B, A]]) {
          const rest = (distance: number) => fixed(new Bits(), [...literals, { length: 3, distance }, ...tail], true);
          const furthest = Math.min(reach + literals.length, 32768);
          const { output, error } = inflate("InflateRaw", [start, rest(furthest).end()], { windowBits });
          const at = length + literals.length;
          expect(error).toBeUndefined();
          expect(output.subarray(at, at + 3)).toEqual(data.subarray(at - furthest, at - furthest + 3));
          if (furthest === 32768) continue;
          expect(inflate("InflateRaw", [start, rest(furthest + 1).end()], { windowBits }).error).toBe(tooFar);
          // What is written in one go is all within reach.
          const inOne = concat(start, rest(furthest + 1).end());
          const expected = length > window ? undefined : tooFar;
          expect(inflate("InflateRaw", [inOne], { windowBits, chunkSize: 65536 }).error).toBe(expected);
        }
      }
    }
  });

  test("beyond the window is all right if it ends before the room does", () => {
    // With codes so short, several literals are read at a time.
    const literals = lengths(258, { ...[2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10], [END]: 10, 257: 3 });
    const some = (count: number) => Array.from({ length: count }, (_, i) => (i * 7 + (i >> 3)) & 1);
    const tokens = [...some(300), { length: 3, distance: 290 }, ...some(200)];
    const data = dynamic(new Bits(), literals, lengths(17, { 0: 1, 16: 1 }), tokens, true).end();
    const sizes = Array.from({ length: 60 }, (_, i) => 260 + i);
    const errors = sizes.map(chunkSize => inflate("InflateRaw", [data], { windowBits: 8, chunkSize }).error);
    expect(errors).toEqual(sizes.map(size => (size > 266 && size < 303 ? tooFar : undefined)));
  });

  test("does not reach into the stream in front of it", () => {
    const first = fixed(new Bits(), text("first"), true).end();
    const second = fixed(new Bits(), [A, { length: 3, distance: 2 }], true).end();
    using engine = new Engine("InflateRaw");
    engine.write(first);
    engine.reset();
    engine.write(second);
    expect(engine.error).toBe(tooFar);
    const members = concat(inGzip(first, Buffer.from("first")), inGzip(second, Buffer.from("AtAt")));
    expect(read("Gunzip", members)).toBe(tooFar);
  });
});

describe("a dynamic block", () => {
  const start = () => header(new Bits(), DYNAMIC, true);
  const onlyEnd = lengths(257, { [END]: 1 });

  test.each([
    [287, 1],
    [288, 1],
    [257, 31],
    [257, 32],
  ])("does not have %d and %d symbols", (literals, distances) => {
    const bits = start()
      .put(literals - 257, 5)
      .put(distances - 1, 5)
      .put(0, 4);
    expect(raw(bits)).toBe(damaged("too many length or distance symbols"));
  });

  test("has up to 286 and 30 symbols", () => {
    const literals = lengths(286, { [A]: 2, [END]: 2, 285: 1 });
    const bits = stored(new Bits(), Buffer.alloc(24577, "B"), false);
    dynamic(bits, literals, lengths(30, { 0: 1, 29: 1 }), [A, { length: 258, distance: 24577 }], true);
    expect(zlib.inflateRawSync(bits.end()).subarray(24576).toString()).toBe("BA" + times(258, "B"));
  });

  test.each([
    ["too many", { 0: 1, 1: 1, 18: 1 }],
    ["too few", { 0: 1, 1: 2 }],
    ["a single one", { 18: 1 }],
  ])("needs a complete code for its code lengths, not %s", (_, some) => {
    expect(raw(dynamicCounts(start(), 257, 1, lengths(19, some)))).toBe(damaged("invalid code lengths set"));
  });

  test("with no code for its code lengths takes a bit for each", () => {
    const bits = dynamicCounts(start(), 257, 1, [], 4);
    for (let i = 0; i < 257; i++) bits.put(i & 1, 1);
    // The header and 257 bits end 2 bits before a byte boundary.
    expect(raw(bits.end().subarray(0, -1))).toBe(truncated);
    expect(raw(bits)).toBe(damaged("invalid code -- missing end-of-block"));
  });

  describe("repeats code lengths", () => {
    const codeLengths = lengths(19, { 0: 3, 1: 3, 2: 2, 16: 2, 17: 3, 18: 3 });
    const codes = codesOf(codeLengths);
    const extraBits = { 16: 2, 17: 3, 18: 7 } as Record<number, number>;
    function withRuns(literals: number, distances: number, ...runs: (number | [number, number])[]) {
      const bits = dynamicCounts(start(), literals, distances, codeLengths);
      for (const run of runs) {
        if (typeof run === "number") bits.code(codes[run]);
        else bits.code(codes[run[0]]).put(run[1], extraBits[run[0]]);
      }
      return bits;
    }
    const badRepeat = damaged("invalid bit length repeat");

    test("but not in front of the first", () => {
      expect(raw(withRuns(257, 1, [16, 0]))).toBe(badRepeat);
    });

    test.each([
      [16, 0],
      [17, 0],
      [18, 0],
    ])("nor behind the last: symbol %d", (symbol, extra) => {
      expect(raw(withRuns(257, 2, [18, 127], [18, 107], 1, [symbol, extra]))).toBe(badRepeat);
    });

    test("from one code into the other", () => {
      // 255, 256, 257 and 258 have 2 bits, and so have four distances.
      const bits = withRuns(259, 4, [18, 127], [18, 106], 2, [16, 1], [16, 0]);
      const literalCodes = codesOf(lengths(259, { 255: 2, 256: 2, 257: 2, 258: 2 }));
      putTokens(bits, [255, { length: 4, distance: 1 }], literalCodes, codesOf([2, 2, 2, 2])).code(literalCodes[END]);
      expect(raw(bits)).toBe(times(5, "\xff"));
    });

    test("of zero with symbol 16, too", () => {
      const bits = withRuns(257, 3, 1, [18, 127], [18, 100], [16, 3], 1, 0, 0, 0);
      expect(raw(bits.put(0b100, 3))).toBe("\0\0");
    });
  });

  test("needs a code for its end", () => {
    const bits = dynamicHeader(new Bits(), lengths(257, { [A]: 1, [B]: 1 }), [1], true);
    expect(raw(bits)).toBe(damaged("invalid code -- missing end-of-block"));
  });

  test.each([
    ["too many", { [A]: 1, [B]: 1, [END]: 1 }],
    ["too many of 15 bits", { ...Array.from({ length: 15 }, (_, i) => i + 1), [A]: 15, [END]: 15 }],
    ["too few", { [A]: 1, [END]: 2 }],
    ["one too few of 15 bits", { ...Array.from({ length: 14 }, (_, i) => i + 1), [END]: 15 }],
    ["a single one of 2 bits", { [END]: 2 }],
  ])("needs complete codes, not %s", (_, some: Record<number, number>) => {
    const literals = lengths(257, some);
    expect(raw(dynamicHeader(new Bits(), literals, [1], true))).toBe(damaged("invalid literal/lengths set"));
    const distances = literals.filter(Boolean);
    expect(raw(dynamicHeader(new Bits(), onlyEnd, distances, true))).toBe(damaged("invalid distances set"));
  });

  test("may have a code of one bit for one symbol, which leaves the other bit without a meaning", () => {
    expect(raw(dynamicHeader(new Bits(), onlyEnd, [0], true).put(1, 1))).toBe(damaged("invalid literal/length code"));
    const literals = lengths(258, { [A]: 1, [END]: 2, 257: 2 });
    const codes = codesOf(literals);
    const upToDistance = (distances: number[]) =>
      dynamicHeader(new Bits(), literals, distances, true).code(codes[A]).code(codes[A]).code(codes[257]);
    expect(raw(upToDistance([0, 1]).put(0, 1).code(codes[END]))).toBe("AAAAA");
    expect(raw(upToDistance([0, 1]).put(1, 1))).toBe(damaged("invalid distance code"));
    expect(raw(upToDistance([0]).put(0, 1))).toBe(damaged("invalid distance code"));
    expect(raw(upToDistance([0, 0, 0]).put(1, 1))).toBe(damaged("invalid distance code"));
  });

  test("needs no more than that bit to tell", () => {
    const literals = lengths(258, { [A]: 1, [END]: 2, 257: 2 });
    const codes = codesOf(literals);
    const bits = dynamicHeader(new Bits(), literals, [1], true).code(codes[A]);
    while (bits.length % 8 !== 5) bits.code(codes[A]);
    expect(raw(bits.code(codes[257]).put(1, 1))).toBe(damaged("invalid distance code"));
  });

  test("forgets the codes of the one in front of it", () => {
    const literals = lengths(258, { [A]: 1, [END]: 2, 257: 2 });
    const bits = dynamic(new Bits(), literals, [1, 1], [A, { length: 3, distance: 1 }], false);
    const codes = codesOf(literals);
    dynamicHeader(bits, literals, [0], true).code(codes[257]).put(0, 1);
    expect(raw(bits)).toBe(damaged("invalid distance code"));
  });

  // A match can take 48 bits, and literals may be read along with it.
  test.each([8, 9, 10, 11, 12, 15])("with the longest codes, and literals of %d bits in between", bits => {
    const ladder = (symbols: number[]) => Object.fromEntries(symbols.map((s, i) => [s, Math.min(i + 1, 15)]));
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, END, 14, 284];
    order[bits - 1] = A;
    if (!order.includes(END)) order[0] = END;
    const distances = lengths(30, ladder([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 28, 29]));
    const history = input("noise", 32768);
    const [tokens, expected] = [[] as Token[], [...history]];
    for (let i = 0; i < 48; i++) {
      for (let literals = i % 5; literals--;) (tokens.push(A), expected.push(A));
      const match = { length: 227 + ((i * 7) % 31), distance: 32768 - ((i * 977) % 16384) };
      tokens.push(match);
      for (let j = 0; j < match.length; j++) expected.push(expected[expected.length - match.distance]);
    }
    const data = dynamic(stored(new Bits(), history, false), lengths(285, ladder(order)), distances, tokens, true);
    expect(zlib.inflateRawSync(data.end()).equals(Buffer.from(expected))).toBe(true);
  });

  // How many codes there are of each length from 1 on, for the largest tables with so many index bits at the first
  // level: https://github.com/madler/zlib/blob/v1.3.1/examples/enough.c
  test.each([
    [9, [1, 1, 1, 0, 0, 0, 0, 0, 0, 117, 1, 17, 17, 1, 130], 6, [1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 1, 1, 1, 2]],
    [10, [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 117, 1, 1, 1, 162], 7, [1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 1, 1, 2]],
    [11, [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 101, 9, 9, 162], 8, [1, 1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 1, 2]],
    [12, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 77, 1, 202], 9, [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 9, 9, 1, 1, 2]],
  ])("with the codes that take the most room in a table of %d bits", (_, literalCounts, __, distanceCounts) => {
    const spread = (counts: number[]) => counts.flatMap((count, i) => Array(count).fill(i + 1));
    const history = input("noise", 32768);
    const [tokens, expected] = [Array.from({ length: 256 }, (_, i): Token => i), [...history]];
    expected.push(...(tokens as number[]));
    // Each length symbol and each distance symbol.
    const distances = [1, 2, ...Array.from({ length: 28 }, (_, i) => 1 + ((2 + (i & 1)) << (i >> 1)))];
    const matchLengths = [3, 4, 5, 6, ...Array.from({ length: 24 }, (_, i) => 3 + ((4 + (i & 3)) << (i >> 2))), 258];
    distances.forEach((distance, i) => {
      const length = matchLengths[i % matchLengths.length];
      tokens.push({ length, distance });
      for (let j = 0; j < length; j++) expected.push(expected[expected.length - distance]);
    });
    for (const order of [(it: number[]) => it, (it: number[]) => it.reverse()]) {
      const bits = stored(new Bits(), history, false);
      dynamic(bits, order(spread(literalCounts)), order(spread(distanceCounts)), tokens, true);
      expect(zlib.inflateRawSync(bits.end()).equals(Buffer.from(expected))).toBe(true);
    }
  });
});

const plain = Buffer.from("hello, hello, hello");
const body = fixed(new Bits(), [...text("hello, "), { length: 12, distance: 7 }], true).end();

describe("a zlib stream", () => {
  const withHeader = (start: Uint8Array | number[]) => concat(start, body, be(adler32(plain), 4));

  test.each(["Inflate", "Unzip"] as const)("has a header with check bits, method 8 and a window: %s", mode => {
    expect(read(mode, withHeader([0x78, 0x9d]))).toBe(damaged("incorrect header check"));
    expect(read(mode, withHeader([0x79, 0x9c]))).toBe(damaged("incorrect header check"));
    expect(read(mode, withHeader(zlibHeader(0x77)))).toBe(damaged("unknown compression method"));
    expect(read(mode, withHeader(zlibHeader(0xf0)))).toBe(damaged("unknown compression method"));
    for (const options of [undefined, {}]) {
      expect(read(mode, withHeader(zlibHeader(0x88)), options)).toBe(damaged("invalid window size"));
      expect(read(mode, withHeader(zlibHeader(0xf8)), options)).toBe(damaged("invalid window size"));
      for (const level of [0, 0x40, 0x80, 0xc0]) {
        expect(read(mode, withHeader(zlibHeader(0x78, level)), options)).toBe(`${plain}`);
      }
    }
  });

  test("has a window that is no larger than windowBits says", () => {
    for (let windowBits = 8; windowBits <= 15; windowBits++) {
      const results = [8, 9, 10, 11, 12, 13, 14, 15].map(it =>
        read("Inflate", inZlib(body, plain, it), { windowBits }),
      );
      expect(results).toEqual([
        ...Array(windowBits - 7).fill(`${plain}`),
        ...Array(15 - windowBits).fill(damaged("invalid window size")),
      ]);
    }
  });

  // Node.js does not insist on it: https://github.com/oven-sh/bun/issues/44428
  test.each([undefined, 0, 15])("keeps to the window in its header, with windowBits %p", windowBits => {
    const data = input("noise", 600);
    for (const tail of tails) {
      const stream = (distance: number) => {
        const bits = fixed(stored(new Bits(), data, false), [{ length: 3, distance }, ...tail], true);
        return inZlib(bits.end(), concat(data, data.subarray(-distance).subarray(0, 3), tail), 9);
      };
      expect(inflate("Inflate", [stream(512)], { windowBits }).error).toBeUndefined();
      expect(inflate("Inflate", [stream(513)], { windowBits }).error).toBe(tooFar);
    }
  });

  test("is not a gzip stream", () => {
    expect(read("Inflate", inGzip(body, plain))).toBe(damaged("incorrect header check"));
    expect(read("Gunzip", inZlib(body, plain))).toBe(damaged("incorrect header check"));
  });

  test("ends with the Adler-32", () => {
    const whole = inZlib(body, plain);
    for (let i = 1; i <= 4; i++) {
      const changed = Buffer.from(whole);
      changed[whole.length - i] ^= 1;
      expect(read("Inflate", changed)).toBe(damaged("incorrect data check"));
      expect(read("Inflate", whole.subarray(0, -i))).toBe(truncated);
    }
  });

  describe("with a dictionary", () => {
    const dictionary = Buffer.from("hello, ");
    const match = (distance: number, tail: number[] = []) =>
      fixed(new Bits(), [{ length: 19, distance }, ...tail], true).end();
    const whole = inZlib(match(7), plain, 15, dictionary);

    test.each(["Inflate", "Unzip"] as const)("needs that one: %s", mode => {
      expect(read(mode, whole, { dictionary })).toBe(`${plain}`);
      expect(read(mode, whole)).toBe("Z_NEED_DICT Missing dictionary");
      expect(read(mode, whole, { dictionary: Buffer.from("hello. ") })).toBe("Z_NEED_DICT Bad dictionary");
      expect(read(mode, whole.subarray(0, 5), { dictionary })).toBe(truncated);
      expect(read(mode, whole.subarray(0, 5))).toBe(truncated);
    });

    test.each(tails.map(tail => [tail.length, tail]))("reaches back to its start, before %d bytes", (_, tail) => {
      const expected = concat(plain, tail);
      expect(read("Inflate", inZlib(match(8, tail), expected, 15, dictionary), { dictionary })).toBe(tooFar);
      expect(read("InflateRaw", match(7, tail), { dictionary })).toBe(expected.toString("latin1"));
      expect(read("InflateRaw", match(8, tail), { dictionary })).toBe(tooFar);
    });

    test("only if it asks for it", () => {
      expect(read("Inflate", inZlib(body, plain), { dictionary })).toBe(`${plain}`);
      expect(read("Inflate", inZlib(match(7), plain), { dictionary })).toBe(tooFar);
      expect(read("Gunzip", inGzip(match(7), plain), { dictionary })).toBe(tooFar);
    });

    test("does not get it behind a gzip member in the same write", () => {
      const data = concat(inGzip(body, plain), whole);
      expect(inflate("Unzip", [data], { dictionary }).error).toBe("Z_NEED_DICT Bad dictionary");
      expect(inflate("Unzip", [data]).error).toBe("Z_NEED_DICT Missing dictionary");
    });

    test.each([9, 15])("has the end of it if it is longer than the window of windowBits %d", windowBits => {
      const [dictionary, window] = [input("noise", 50000), 1 << windowBits];
      const expected = dictionary.subarray(-window).toString("latin1", 0, 19);
      expect(read("InflateRaw", match(window), { dictionary, windowBits })).toBe(expected);
      const wrapped = inZlib(match(window), Buffer.from(expected, "latin1"), windowBits, dictionary);
      expect(read("Inflate", wrapped, { dictionary })).toBe(expected);
      if (windowBits === 15) return;
      for (const tail of tails) {
        expect(read("InflateRaw", match(window + 1, tail), { dictionary, windowBits })).toBe(tooFar);
      }
    });

    test.each([
      ["InflateRaw", match(7)],
      ["Inflate", whole],
    ] as const)("has it again after reset(): %s", (mode, data) => {
      using engine = new Engine(mode, { dictionary });
      engine.write(data.subarray(0, -1));
      engine.reset();
      const before = engine.written;
      engine.write(data, Z_FINISH);
      expect([engine.error, `${engine.output.subarray(before)}`]).toEqual([undefined, `${plain}`]);
    });
  });
});

describe("a gzip stream", () => {
  const trailer = concat(le(crc32(plain), 4), le(plain.length, 4));

  test.each(["Gunzip", "Unzip"] as const)("may have any of the optional fields: %s", mode => {
    for (let flags = 0; flags < 32; flags++) {
      const fields = {
        text: !!(flags & 1),
        headerCrc: !!(flags & 2),
        extra: flags & 4 ? Buffer.from("A\0\x1f\x8b", "latin1") : undefined,
        name: flags & 8 ? "n\xe4me" : undefined,
        comment: flags & 16 ? "comment" : undefined,
      };
      expect(read(mode, inGzip(body, plain, fields))).toBe(`${plain}`);
    }
  });

  test("whose fields are empty or long", () => {
    expect(read("Gunzip", inGzip(body, plain, { extra: nothing, name: "", comment: "", headerCrc: true }))).toBe(
      `${plain}`,
    );
    const long = Buffer.alloc(100000, "x").toString();
    const data = inGzip(body, plain, { extra: input("noise", 65535), name: long, comment: long, headerCrc: true });
    for (const size of [999, 65536, data.length]) {
      expect(`${inflate("Gunzip", piecesOf(data, size)).output}`).toBe(`${plain}`);
    }
  });

  test("has its two bytes, method 8 and no other flags", () => {
    const changed = (at: number, byte: number) => concat(gzipHeader().fill(byte, at, at + 1), body, trailer);
    expect(read("Gunzip", changed(0, 0x1e))).toBe(damaged("incorrect header check"));
    expect(read("Gunzip", changed(1, 0x8c))).toBe(damaged("incorrect header check"));
    expect(read("Gunzip", changed(2, 7))).toBe(damaged("unknown compression method"));
    expect(read("Gunzip", changed(2, 0x18))).toBe(damaged("unknown compression method"));
    for (const flag of [0x20, 0x40, 0x80]) {
      expect(read("Gunzip", changed(3, flag))).toBe(damaged("unknown header flags set"));
    }
    for (const at of [4, 5, 6, 7, 8, 9]) expect(read("Gunzip", changed(at, 0xff))).toBe(`${plain}`);
  });

  test("has a CRC of all of its header if it says so", () => {
    const start = gzipHeader({ extra: Buffer.from("ex"), name: "n", comment: "c", headerCrc: true });
    for (const at of [4, 7, 8, 9, 12, 13, 14, 16, 18, 19]) {
      const changed = Buffer.from(start);
      changed[at] ^= 0x10;
      expect(read("Gunzip", concat(changed, body, trailer))).toBe(damaged("header crc mismatch"));
    }
  });

  test("ends with the CRC-32 and the length", () => {
    const whole = inGzip(body, plain);
    for (let i = 1; i <= 8; i++) {
      const changed = Buffer.from(whole);
      changed[whole.length - i] ^= 0x80;
      expect(read("Gunzip", changed)).toBe(damaged(i <= 4 ? "incorrect length check" : "incorrect data check"));
    }
  });

  test("is not complete without its last byte", () => {
    const whole = inGzip(body, plain, { extra: Buffer.from("ex"), name: "n", comment: "c", headerCrc: true });
    for (let length = 0; length < whole.length; length++) {
      expect(read("Gunzip", whole.subarray(0, length))).toBe(truncated);
    }
  });

  test.each(["Gunzip", "Unzip"] as const)("has any number of members: %s", mode => {
    const empty = inGzip(fixed(new Bits(), [], true).end(), nothing);
    const member = inGzip(body, plain, { name: "n" });
    expect(read(mode, concat(member, empty, member, empty, empty, member))).toBe(times(3, `${plain}`));
    expect(read(mode, concat(member, member.subarray(0, -1)))).toBe(truncated);
    expect(read(mode, concat(member, [0x1f]))).toBe(truncated);
    expect(`${zlib.gunzipSync(Buffer.concat([...Array(3000).fill(empty), member]))}`).toBe(`${plain}`);
  });

  test("has the whole window behind a zlib stream that has not", () => {
    const data = input("noise", 600);
    const far = fixed(stored(new Bits(), data, false), [{ length: 3, distance: 600 }], true).end();
    const expected = concat(data, data.subarray(0, 3));
    const members = concat(inGzip(body, plain), inZlib(body, plain, 9), inGzip(far, expected));
    expect(zlib.unzipSync(members)).toEqual(concat(plain, plain, expected));
  });

  test("is followed by zeros, or by nothing but members", () => {
    const member = inGzip(body, plain);
    expect(inflate("Gunzip", [concat(member, [0, 1, 2], member)])).toEqual({
      output: plain,
      read: member.length,
      error: undefined,
    });
    expect(read("Gunzip", concat(member, text("junk")))).toBe(damaged("incorrect header check"));
    expect(read("Unzip", concat(member, inZlib(body, plain)))).toBe(times(2, `${plain}`));
  });
});

describe("Unzip goes by the first two bytes", () => {
  const [member, other] = [inGzip(body, plain), inZlib(body, plain)];
  const members = concat(member, member);

  test.each([[[0]], [[1]], [[0, 0, 1, 1]], [[2]]])("of a gzip stream, in writes that end at %j", ends => {
    const pieces = [...ends, members.length].map((end, i) => members.subarray(ends[i - 1] ?? 0, end));
    expect(inflate("Unzip", pieces)).toEqual({ output: concat(plain, plain), read: members.length, error: undefined });
  });

  test("and not by those of a later write", () => {
    const whole = inZlib(stored(new Bits(), member, true).end(), member);
    const start = whole.indexOf(member);
    const pieces = [whole.subarray(0, start), concat(whole.subarray(start), member)];
    expect(inflate("Unzip", pieces)).toEqual({ output: member, read: whole.length, error: undefined });
  });

  test.each([
    ["one byte of a zlib stream", other.subarray(0, 1), concat(other, member), 1],
    ["two bytes of a gzip stream", member.subarray(0, 2), members, 2],
    // As in Node.js 24.
    ["one byte of a gzip stream, which it keeps", member.subarray(0, 1), members.subarray(1), 2],
  ])("reset() behind %s", (_, before, after, count) => {
    using engine = new Engine("Unzip");
    engine.write(before);
    engine.reset();
    engine.write(after, Z_FINISH);
    expect([engine.error, `${engine.output}`]).toEqual([undefined, times(count, `${plain}`)]);
  });

  test.each([1, 2])("and it takes both for gzip, %d at a time", size => {
    using engine = new Engine("Unzip");
    for (const piece of piecesOf(Buffer.from([0x1f, 0x8c]), size)) engine.write(piece);
    expect(engine.error).toBe(damaged("incorrect header check"));
    engine.error = undefined;
    engine.reset();
    engine.write(concat(other, member), Z_FINISH);
    expect([engine.error, `${engine.output}`]).toEqual([undefined, `${plain}`]);
  });
});

describe("what follows the end of a stream is not read", () => {
  test.each([0, 1, 2, 7, 8, 9, 15, 16, 17, 100])("%d bytes", count => {
    for (let literals = 0; literals < 8; literals++) {
      const expected = Buffer.alloc(literals + 300, 200);
      const tokens = [...expected.subarray(258), { length: 258, distance: 1 }];
      const data = fixed(new Bits(), tokens, true).end();
      for (const [mode, whole] of [
        ["InflateRaw", data],
        ["Inflate", inZlib(data, expected)],
        ["Unzip", inZlib(data, expected)],
      ] as const) {
        for (const chunkSize of [64, expected.length, 16384]) {
          const result = inflate(mode, [concat(whole, Buffer.alloc(count, 0x5a))], { chunkSize });
          expect(result).toEqual({ output: expected, read: whole.length, error: undefined });
        }
      }
    }
  });

  test("in a later write either", () => {
    using engine = new Engine("Inflate");
    const whole = inZlib(body, plain);
    expect([engine.write(whole), engine.write(whole), engine.write(nothing, Z_FINISH)]).toEqual([true, false, true]);
    expect([engine.error, engine.read, `${engine.output}`]).toEqual([undefined, whole.length, `${plain}`]);
  });

  test("and bytesWritten says so", async () => {
    const whole = inZlib(body, plain);
    const stream = zlib.createInflate();
    stream.resume().end(concat(whole, text("more")));
    await once(stream, "end");
    expect(stream.bytesWritten).toBe(whole.length);
    const { engine } = zlib.inflateSync(concat(whole, text("more")), { info: true }) as any;
    expect(engine.bytesWritten).toBe(whole.length);
  });
});

describe("flush values", () => {
  test("Z_SYNC_FLUSH gives what there is of a stream that is cut short", () => {
    const whole = inGzip(body, plain);
    const lengths = Array.from(whole, (_, i) => zlib.gunzipSync(whole.subarray(0, i), { finishFlush: Z_SYNC_FLUSH }));
    expect(lengths.map(it => it.length)).toEqual([
      ...Array(12).fill(0),
      ...[1, 2, 3, 4, 5, 6, 7, 7],
      ...Array(whole.length - 20).fill(19),
    ]);
  });

  test("Z_BLOCK stops behind the header and behind each block", () => {
    const bits = stored(fixed(new Bits(), text("ab"), false), Buffer.from("cde"), false);
    const data = dynamic(bits, lengths(257, { [A]: 1, [END]: 1 }), [0], [A], true).end();
    const stops = (mode: Mode, whole: Buffer) => {
      using engine = new Engine(mode);
      const all: string[] = [];
      while (!engine.write(whole.subarray(engine.read), Z_BLOCK) && all.length < 9) {
        all.push(engine.error ?? `${engine.read} ${engine.output}`);
      }
      return [...all, `${engine.read} ${engine.output}`];
    };
    const [end, expected] = [data.length, Buffer.from("abcdeA")];
    expect(stops("InflateRaw", data)).toEqual(["4 ab", "11 abcde", `${end} abcdeA`]);
    expect(stops("Inflate", inZlib(data, expected))).toEqual([
      "2 ",
      "6 ab",
      "13 abcde",
      `${2 + end} abcdeA`,
      `${6 + end} abcdeA`,
    ]);
    expect(stops("Gunzip", inGzip(data, expected, { name: "n" }))).toEqual([
      "12 ",
      "16 ab",
      "23 abcde",
      `${12 + end} abcdeA`,
      `${20 + end} abcdeA`,
    ]);
  });

  test("Z_BLOCK goes on from the end of a block", () => {
    const [first, second] = ["ab", "cd"].map(it => stored(new Bits(), Buffer.from(it), false).end());
    using engine = new Engine("InflateRaw");
    engine.write(first);
    engine.write(concat(second, first), Z_BLOCK);
    expect([engine.read, `${engine.output}`]).toEqual([14, "abcd"]);
  });
});

test.each([
  ["InflateRaw", "raw"],
  ["Inflate", "zlib"],
  ["Gunzip", "gzip"],
  ["Unzip", "zlib"],
  ["Unzip", "gzip"],
] as const)("reset() in any place starts over: %s, %s", (mode, container) => {
  const literals = lengths(266, { [A]: 2, [B]: 2, [END]: 2, 265: 2 });
  const bits = dynamic(stored(new Bits(), plain, false), literals, [1, 1], [A, B, { length: 12, distance: 2 }], false);
  const runs = [A, ...Array(2).fill({ length: 258, distance: 1 })];
  const expected = concat(plain, text(times(7, "AB") + times(517, "A")));
  const data = fixed(bits, runs, true).end();
  const fields = { extra: Buffer.from("ex"), name: "n", comment: "c", headerCrc: true };
  const whole = { raw: data, zlib: inZlib(data, expected), gzip: inGzip(data, expected, fields) }[container];
  using engine = new Engine(mode, { chunkSize: 100 });
  for (let length = 0; length <= whole.length; length += length < 45 || length > whole.length - 30 ? 1 : 9) {
    engine.write(whole.subarray(0, length));
    engine.reset();
    const before = engine.written;
    engine.write(whole, Z_FINISH);
    expect(engine.error).toBeUndefined();
    expect(engine.output.subarray(before).equals(expected)).toBe(true);
    engine.reset();
  }
});

test.each([
  ["a literal", Array(65).fill(A)],
  ["a match", [A, { length: 258, distance: 1 }]],
  ["a match from too far back", [...Array(64).fill(A), { length: 3, distance: 65 }]],
])("reset() forgets %s that there was no room for", (_, tokens) => {
  using engine = new Engine("InflateRaw");
  engine.writeUntilFull(fixed(new Bits(), tokens, true).end());
  engine.reset();
  engine.write(body, Z_FINISH);
  expect([engine.error, `${engine.output}`]).toEqual([undefined, `${plain}`]);
});

describe("Bun.inflateSync() and Bun.gunzipSync() take the container from windowBits", () => {
  const streams = { raw: body, zlib: inZlib(body, plain, 9), gzip: inGzip(body, plain) };
  const resultsOf = (decompress: typeof Bun.inflateSync, windowBits: number) =>
    Object.values(streams).map(data => {
      try {
        return Buffer.from(decompress(data, { windowBits } as any)).toString("latin1");
      } catch (error: any) {
        return error.message;
      }
    });
  const [right, noHeader, invalid] = [`${plain}`, "incorrect header check", "Zlib error: Invalid argument"];

  test.each([
    { all: [-15, -9, -8], results: [right, "invalid stored block lengths", "invalid block type"] },
    { all: [0, 9, 15], results: [noHeader, right, noHeader] },
    { all: [8], results: [noHeader, "invalid window size", noHeader] },
    { all: [16, 24, 31], results: [noHeader, noHeader, right] },
    { all: [40], results: [noHeader, "invalid window size", right] },
    { all: [32, 41, 47], results: [noHeader, right, right] },
    {
      all: [-(2 ** 31), -17, -16, -7, -1, 1, 7, 17, 23, 33, 39, 48, 56, 63, 64, 271, 2 ** 31 - 1],
      results: [invalid, invalid, invalid],
    },
  ])("$all", ({ all, results }) => {
    for (const decompress of [Bun.inflateSync, Bun.gunzipSync]) {
      expect(all.map(windowBits => resultsOf(decompress, windowBits))).toEqual(all.map(() => [...results]));
    }
  });

  test.each([-9, -10, 25, 41])("and let a stream refer to all of its own output, with windowBits %d", windowBits => {
    const data = input("prose", 4000);
    const compressed = windowBits < 0 ? Bun.deflateSync(data) : Bun.gzipSync(data);
    expect(Buffer.from(Bun.inflateSync(compressed, { windowBits: windowBits as 25 }))).toEqual(data);
  });

  test("also if their buffer grows in the middle of a stored block", () => {
    const data = input("noise", 20000);
    const zeros = [0, ...Array(116).fill({ length: 258, distance: 1 })];
    const bits = stored(fixed(new Bits(), zeros, false), data, false);
    const output = Bun.inflateSync(fixed(bits, [{ length: 9, distance: 15000 }], true).end(), { windowBits: -9 });
    expect(Buffer.from(output.subarray(-9))).toEqual(data.subarray(5000, 5009));
  });

  test("and pass on the message", () => {
    expect(() => Bun.inflateSync(Buffer.from([7]))).toThrow("invalid block type");
    expect(() => Bun.gunzipSync(streams.zlib)).toThrow("incorrect header check");
    expect(() => Bun.gunzipSync(streams.gzip.subarray(0, -1))).toThrow("Zlib returned an error");
    expect(() => Bun.inflateSync(nothing)).toThrow("Zlib returned an error");
  });
});
