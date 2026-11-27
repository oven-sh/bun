// Streams that make use of all that the format allows.
import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import { inflate, piecesOf, streamOf, type Mode } from "./engine";
import { input, random } from "./inputs";
import { fewerIfSlow } from "./observe";
import { inGzip, inZlib, randomStream } from "./write";

const seeds = (count: number) =>
  fewerIfSlow(
    Array.from({ length: count }, (_, i) => 1000 + i),
    11,
  );

describe("a valid stream is read whatever the sizes of input and output", () => {
  test.each([
    [5, 15, 160],
    [300, 15, 160],
    [3000, 8, 80],
    [3000, 10, 80],
    [9000, 15, 80],
    [140000, 15, 32],
    [140000, 12, 16],
  ])("of %d bytes, with windowBits %d", (size, windowBits, count) => {
    const wrong: string[] = [];
    for (const seed of seeds(count)) {
      const next = random(~seed);
      const dictionary = seed % 3 ? undefined : input("prose", [1, 100, 1 << windowBits, 40000][next(4)]);
      const { raw, plain } = randomStream(seed, size, 1 << windowBits, dictionary);
      const wrapped: [Mode, Buffer][] = [
        ["InflateRaw", raw],
        ["Inflate", inZlib(raw, plain, windowBits, dictionary)],
        ["Unzip", inZlib(raw, plain, windowBits, dictionary)],
      ];
      if (!dictionary) wrapped.push(["Gunzip", inGzip(raw, plain)], ["Unzip", inGzip(raw, plain)]);
      for (const [mode, data] of wrapped) {
        const chunkSize = [64, 67, 258, 261, 700, 16384, 33000, 200000][size > 9000 ? 2 + next(6) : next(8)];
        const largest = data.length < 600 ? [1, 3, 9, 17, 600][next(5)] : [40, 1000, 1 << 20][next(3)];
        const pieces = piecesOf(data, () => 1 + next(largest));
        const { output, read, error } = inflate(mode, pieces, { windowBits, chunkSize, dictionary });
        if (error || read !== data.length || !output.equals(plain)) {
          wrong.push(`seed ${seed} ${mode} chunkSize ${chunkSize} pieces of up to ${largest}: ${error}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("by the other functions that inflate", async () => {
    for (const seed of seeds(40)) {
      const { raw, plain } = randomStream(seed, seed % 4 ? 2000 : 100000);
      const formats = { "deflate-raw": raw, "deflate": inZlib(raw, plain), "gzip": inGzip(raw, plain) };
      expect(plain.equals(Bun.inflateSync(raw))).toBe(true);
      expect(plain.equals(Bun.inflateSync(formats.deflate, { windowBits: 15 }))).toBe(true);
      expect(plain.equals(Bun.gunzipSync(formats.gzip))).toBe(true);
      expect(plain.equals(zlib.inflateSync(formats.deflate, {}))).toBe(true);
      for (const [format, data] of Object.entries(formats)) {
        const pieces = streamOf(piecesOf(data, 1 + (data.length >> 2)));
        const inflated = pieces.pipeThrough(new DecompressionStream(format as "gzip"));
        expect(plain.equals(await new Response(inflated).bytes())).toBe(true);
      }
    }
  });
});
