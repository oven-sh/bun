// What holds for the streams that are written, and for the checksums.
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows } from "harness";
import { once } from "node:events";
import zlib from "node:zlib";
import {
  Engine,
  inflate,
  nothing,
  streamOf,
  Z_BLOCK,
  Z_FINISH,
  Z_FULL_FLUSH,
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
} from "./engine";
import { input, kinds } from "./inputs";
import { fewerIfSlow } from "./observe";
import { adler32, Bits, crc32, fixed, inGzip, inZlib, stored, type Token } from "./write";

const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const [DEFAULT, FILTERED, HUFFMAN_ONLY, RLE, FIXED] = [0, 1, 2, 3, 4];
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("headers", () => {
  test("zlib tells the window and how hard it has tried", () => {
    const start = (options: zlib.ZlibOptions) => hex(zlib.deflateSync("", options).subarray(0, 2));
    expect([-1, ...levels].map(level => start({ level })).join(" ")).toBe(
      "789c 7801 7801 785e 785e 785e 785e 789c 78da 78da 78da",
    );
    expect([DEFAULT, FILTERED, HUFFMAN_ONLY, RLE, FIXED].map(strategy => start({ strategy })).join(" ")).toBe(
      "789c 789c 7801 7801 7801",
    );
    expect([8, 9, 10, 11, 12, 13, 14, 15].map(windowBits => start({ windowBits })).join(" ")).toBe(
      "1895 1895 2891 388d 4889 5885 6881 789c",
    );
    expect([9, 10, 11, 12, 13, 14].map(windowBits => start({ windowBits, level: 1 })).join(" ")).toBe(
      "1819 2815 3811 480d 5809 6805",
    );
  });

  test("and the Adler-32 of the whole dictionary", () => {
    for (const length of [1, 2, 3, 600, 40000]) {
      const dictionary = input("noise", length);
      const output = zlib.deflateSync("", { dictionary, windowBits: 9 });
      expect([hex(output.subarray(0, 2)), output.readUInt32BE(2)]).toEqual(["18b4", adler32(dictionary)]);
    }
    expect(hex(zlib.deflateSync("", { dictionary: nothing }))).toBe("789c030000000001");
  });

  test("gzip tells how hard it has tried and the system, and has no dictionary", () => {
    const system = isWindows ? "0a" : isMacOS ? "13" : "03";
    const start = (options: zlib.ZlibOptions) => hex(zlib.gzipSync("", options).subarray(0, 10));
    expect(start({})).toBe(`1f8b08000000000000${system}`);
    expect(levels.map(level => start({ level }).slice(16, 18)).join(" ")).toBe("04 04 00 00 00 00 00 00 00 02");
    expect([FILTERED, HUFFMAN_ONLY, RLE, FIXED].map(strategy => start({ strategy }).slice(16, 18))).toEqual([
      "00",
      "04",
      "04",
      "04",
    ]);
    expect(start({ level: 9, strategy: RLE }).slice(16, 18)).toBe("02");
    expect(zlib.gzipSync("abcabc", { dictionary: Buffer.from("abc") })).toEqual(zlib.gzipSync("abcabc"));
    expect(hex(Bun.gzipSync("", { level: 9 }))).toBe(`1f8b08000000000002${system}03000000000000000000`);
  });

  test("are written with the level that there is at the first write", () => {
    const stream: any = zlib.createDeflate({ level: 1 });
    stream._handle.params(9, DEFAULT);
    expect(hex(stream._processChunk(nothing, Z_FINISH))).toBe("78da030000000001");
  });
});

describe("flushes", () => {
  const after = (level: number, data: string, ...flushes: number[]) => {
    using engine = new Engine("DeflateRaw", { level });
    engine.write(Buffer.from(data), flushes[0]);
    for (const flush of flushes.slice(1)) engine.write(nothing, flush);
    return engine.error ?? hex(engine.output);
  };

  test.each(levels)("of nothing, at level %d", level => {
    const all = [Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH];
    expect(all.map(flush => after(level, "", flush))).toEqual([
      "",
      "",
      "02",
      "000000ffff",
      "000000ffff",
      level === 0 ? "010000ffff" : "0300",
    ]);
  });

  test.each(levels)("of a byte, at level %d", level => {
    const all = [Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH];
    expect(all.map(flush => after(level, "a", flush))).toEqual(
      level === 0
        ? ["", "000100feff61", "000100feff6102", "000100feff61000000ffff", "000100feff61000000ffff", "010100feff61"]
        : ["", "4a04", "4a0408", "4a04000000ffff", "4a04000000ffff", "4b0400"],
    );
  });

  test.each([1, 6])("do nothing behind one that is as strong, at level %d", level => {
    const weakToStrong = [Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH];
    const adds = weakToStrong.map(first =>
      weakToStrong.map(second => after(level, "a", first, second) !== after(level, "a", first)),
    );
    expect(adds).toEqual(weakToStrong.map((_, first) => weakToStrong.map((_, second) => second > first)));
  });

  test.each(levels)("make all of the input available, at level %d", level => {
    const data = input("mixed", 9000);
    for (const flush of [Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH]) {
      using engine = new Engine("DeflateRaw", { level, chunkSize: 64, memLevel: 2 });
      for (const end of [1, 3, 300, 4000, 9000]) {
        engine.write(data.subarray(engine.read, end), flush);
        const inflated = zlib.inflateRawSync(engine.output, { finishFlush: Z_SYNC_FLUSH });
        expect(inflated.equals(data.subarray(0, end))).toBe(true);
      }
    }
  });

  test.each(levels)("Z_FULL_FLUSH makes a new start, at level %d", level => {
    const run = Buffer.alloc(20, "a");
    const data = Buffer.concat([run, input("markup", 3000), run]);
    for (const strategy of [DEFAULT, RLE]) {
      using engine = new Engine("DeflateRaw", { level, strategy });
      engine.write(data, Z_FULL_FLUSH);
      const start = engine.written;
      engine.write(data, Z_FINISH);
      expect(zlib.inflateRawSync(engine.output.subarray(start)).equals(data)).toBe(true);
    }
  });

  test.each(levels)("Z_FINISH is final, at level %d", level => {
    const once = after(level, "a", Z_FINISH);
    expect(after(level, "a", Z_FINISH, Z_FINISH, Z_FINISH)).toBe(once);
    for (const flush of [Z_NO_FLUSH, Z_BLOCK, Z_SYNC_FLUSH]) {
      expect(after(level, "a", Z_FINISH, flush)).toBe("Z_STREAM_ERROR stream error");
    }
  });

  test("a stream says so", async () => {
    const errorOf = async (stream: zlib.Deflate) => {
      const [{ code, errno, message }] = await once(stream.resume(), "error");
      return { code, errno, message };
    };
    const always = zlib.createDeflate({ flush: Z_FINISH });
    always.write("a");
    always.write("b");
    expect(await errorOf(always)).toEqual({ code: "Z_BUF_ERROR", errno: -5, message: "buffer error" });

    const flushed = zlib.createDeflate();
    flushed.flush(Z_FINISH);
    flushed.write("b");
    flushed.write("c");
    expect(await errorOf(flushed)).toEqual({ code: "Z_STREAM_ERROR", errno: -2, message: "stream error" });
  });
});

describe("params()", () => {
  const written = (from: number[], to: number[], flush: number) => {
    const stream: any = zlib.createDeflateRaw({ level: from[0], strategy: from[1] });
    const [data, out] = [input("markup", 2000), Buffer.alloc(4000)];
    let error: string | undefined;
    stream._handle.onerror = (message: string) => (error = message);
    stream._handle.writeSync(flush, data, 0, 1000, out, 0, out.length);
    const used = out.length - stream._writeState[0];
    stream._handle.params(...to);
    if (!error) stream._handle.writeSync(Z_FINISH, data, 1000, 1000, out, used, out.length - used);
    stream.close();
    return error ?? hex(out.subarray(0, out.length - stream._writeState[0]));
  };
  const otherWays = [
    [1, DEFAULT],
    [0, DEFAULT],
    [9, DEFAULT],
    [6, RLE],
  ];

  test.each(otherWays)("do not change to level %d and strategy %d in the middle of a block", (...to) => {
    const unchanged = (flush: number) => written([6, DEFAULT], [6, DEFAULT], flush);
    expect(written([6, DEFAULT], to, Z_NO_FLUSH)).toBe(unchanged(Z_NO_FLUSH));
    expect(written([6, DEFAULT], to, Z_BLOCK)).not.toBe(unchanged(Z_BLOCK));
    expect(written([6, DEFAULT], to, Z_FINISH)).toBe("stream error");
  });

  test("but do to a level that works the same way", () => {
    expect(written([6, DEFAULT], [3, DEFAULT], Z_NO_FLUSH)).not.toBe(written([6, DEFAULT], [6, DEFAULT], Z_NO_FLUSH));
    expect(written([6, DEFAULT], [3, DEFAULT], Z_FINISH)).toBe("buffer error");
  });
});

describe("matches", () => {
  test.each([9, 10, 12, 15])("start at most 262 bytes short of the window of windowBits %d", windowBits => {
    const reach = (1 << windowBits) - 262;
    const repeated = input("noise", 100, 2);
    const withDistance = (distance: number) =>
      Buffer.concat([Buffer.from("x"), repeated, Buffer.alloc(distance - repeated.length), repeated]);
    for (const level of levels.slice(1)) {
      const size = (distance: number) => zlib.deflateRawSync(withDistance(distance), { level, windowBits }).length;
      expect(size(reach + 1) - size(reach)).toBeGreaterThan(80);
    }
  });

  test("have a distance of 1 with Z_RLE, and there are none with Z_HUFFMAN_ONLY", () => {
    const written = (data: string, strategy: number) =>
      zlib.deflateRawSync(data, { strategy, dictionary: Buffer.from("-abcdefgh") });
    const block = (...tokens: Token[]) => fixed(new Bits(), tokens, true).end();
    expect(written("abcdefgh", DEFAULT)).toEqual(block({ length: 8, distance: 8 }));
    expect(written("abcdefgh", RLE)).toEqual(block(...Buffer.from("abcdefgh")));
    expect(written("hhh", RLE)).toEqual(block({ length: 3, distance: 1 }));
    expect(written("hh", RLE)).toEqual(block(...Buffer.from("hh")));
    expect(written("hhhh", HUFFMAN_ONLY)).toEqual(block(...Buffer.from("hhhh")));
  });

  test("of 3 bytes are for level 9, and of less than 6 not for Z_FILTERED", () => {
    const size = (length: number, level: number, strategy = DEFAULT) => {
      const word = "abcdefgh".slice(0, length);
      return zlib.deflateRawSync(`-${word}1${word}2345`, { level, strategy }).length - length;
    };
    expect(levels.slice(1).map(level => size(3, level))).toEqual([11, 11, 11, 11, 11, 11, 11, 11, 9]);
    expect(levels.slice(1).map(level => size(5, level, FILTERED))).toEqual([9, 9, 9, 9, 9, 9, 13, 13, 13]);
    expect(levels.slice(1).map(level => size(6, level, FILTERED))).toEqual(Array(9).fill(9));
  });
});

test.each([
  ...levels.map(level => [level, DEFAULT]),
  ...[1, 6, 9].flatMap(level => [FILTERED, HUFFMAN_ONLY, RLE, FIXED].map(strategy => [level, strategy])),
])("another inflater reads what level %d writes with strategy %d", (level, strategy) => {
  kinds.forEach((kind, i) => {
    const [data, library] = [input(kind, i % 4 === level % 4 ? 70000 : 9000), "libdeflate" as const];
    const options = { level, strategy, memLevel: 1 + ((level + i) % 9) };
    expect(data.equals(Bun.inflateSync(zlib.deflateRawSync(data, options), { library }))).toBe(true);
    expect(data.equals(Bun.gunzipSync(zlib.gzipSync(data, options), { library }))).toBe(true);
  });
});

test("there is no flush value above Z_BLOCK", () => {
  for (const mode of ["Deflate", "Inflate"] as const) {
    using engine = new Engine(mode);
    for (const flush of [6, 7]) expect(() => engine.write(nothing, flush)).toThrow("Invalid flush value");
  }
});

test.each(["deflate", "deflate-raw", "gzip"] as const)("CompressionStream(%p) writes the same bytes", async format => {
  const data = input("prose", 9000);
  using engine = new Engine(({ "deflate": "Deflate", "deflate-raw": "DeflateRaw", "gzip": "Gzip" } as const)[format]);
  const pieces = [data.subarray(0, 1), data.subarray(1, 300), nothing, data.subarray(300)];
  for (const piece of pieces) engine.write(piece);
  engine.write(nothing, Z_FINISH);
  const compressed = streamOf(pieces).pipeThrough(new CompressionStream(format));
  expect(engine.output.equals(await new Response(compressed).bytes())).toBe(true);
});

describe("checksums", () => {
  const data = Buffer.alloc(1100000, input("noise", 70001));
  const range = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => start + i);
  const around = (...lengths: number[]) => lengths.flatMap(length => range(length - 3, length + 4));

  test("CRC-32 of the usual string", () => {
    expect(zlib.crc32("123456789")).toBe(0xcbf43926);
    expect(Bun.hash.crc32("123456789")).toBe(0xcbf43926);
  });

  test("CRC-32 of any length, at any address, from any start", () => {
    const wrong: number[][] = [];
    for (const length of [...range(0, 600), ...around(1024, 2048, 4096, 8192)]) {
      for (const offset of [0, 1 + (length % 15), 16 + (length % 47)]) {
        const [part, start] = [
          data.subarray(offset, offset + length),
          [0, 1, 0xffffffff, 0x8badf00d, 0x80000000][(length + offset) % 5],
        ];
        if (zlib.crc32(part, start) !== crc32(part, start)) wrong.push([length, offset]);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("CRC-32 of much, and in parts", () => {
    for (const length of fewerIfSlow(around(32768, 65536, 131072, 262144, 524288, 1048576), 7)) {
      const part = data.subarray(length % 61, (length % 61) + length);
      const expected = crc32(part);
      expect(zlib.crc32(part)).toBe(expected);
      expect(zlib.crc32(part.subarray(length >> 2), zlib.crc32(part.subarray(0, length >> 2)))).toBe(expected);
    }
  });

  const storedIn = (part: Uint8Array) => stored(new Bits(), part, true).end();

  // The sums of Adler-32 fit in 32 bits for up to 5552 bytes.
  test.each([
    ["noise", data],
    ["the highest byte", Buffer.alloc(40000, 0xff)],
  ])("the trailers for %s", (_, source) => {
    const wrong: number[] = [];
    for (const length of fewerIfSlow([...range(0, 200), ...range(5530, 5600), ...around(11104, 16656, 32768)], 3)) {
      const part = source.subarray(length % 64, (length % 64) + length);
      const [wrapped, gzipped] = [inZlib(storedIn(part), part), inGzip(storedIn(part), part)];
      const options = { level: length % 2, chunkSize: 65536 };
      const isRight =
        zlib.deflateSync(part, options).subarray(-4).equals(wrapped.subarray(-4)) &&
        zlib.gzipSync(part, options).subarray(-8).equals(gzipped.subarray(-8)) &&
        zlib.inflateSync(wrapped, options).equals(part) &&
        zlib.gunzipSync(gzipped, options).equals(part);
      if (!isRight) wrong.push(length);
    }
    expect(wrong).toEqual([]);
  });

  test("Adler-32 of much", () => {
    for (const source of [data, Buffer.alloc(data.length, 0xff)]) {
      for (const length of fewerIfSlow(around(65536, 131072, 262144, 1048576), 7)) {
        const part = source.subarray(length % 61, (length % 61) + length);
        const stream = zlib.deflateSync(part, { level: 0, chunkSize: 1 << 21 });
        expect(stream.readUInt32BE(stream.length - 4)).toBe(adler32(part));
        expect(zlib.inflateSync(stream, { chunkSize: 1 << 21 }).equals(part)).toBe(true);
        expect(zlib.deflateSync("", { dictionary: part }).readUInt32BE(2)).toBe(adler32(part));
      }
    }
  });

  test("Adler-32 goes on from the highest sums", () => {
    const start = Buffer.alloc(257, 0xff).fill(0xef, 128, 129);
    expect(adler32(start)).toBe(0xfff0fff0);
    for (const length of [5551, 5552, 5553, 5600, 20000]) {
      const whole = Buffer.concat([start, Buffer.alloc(length, 0xff)]);
      using engine = new Engine("Deflate", { level: 1 });
      engine.write(start, Z_SYNC_FLUSH);
      const split = engine.written;
      engine.write(whole.subarray(start.length), Z_FINISH);
      const { output } = engine;
      expect(output.readUInt32BE(output.length - 4)).toBe(adler32(whole));
      const back = inflate("Inflate", [output.subarray(0, split), output.subarray(split)], { chunkSize: 65536 });
      expect(back).toEqual({ output: whole, read: output.length, error: undefined });
    }
  });
});
