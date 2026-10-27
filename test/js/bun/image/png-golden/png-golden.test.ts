// PNG files of every kind the format has, well formed and damaged, with what Bun.Image made of each
// one when it was recorded. See record.ts. The well-formed ones are PngSuite, by Willem van Schaik.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import zlib from "node:zlib";
import { differences, loadCases, observeDecode, observeEncode } from "./observe";

const cases = await loadCases(join(import.meta.dir, "cases.json.gz"));
const files = new Map(cases.decode.map(c => [c.name, Buffer.from(c.data, "base64")]));

describe("Bun.Image reads and writes PNG the way it was recorded to", () => {
  test("decode", async () => {
    expect(cases.decode.length).toBeGreaterThan(700);
    const results = await Promise.all(
      cases.decode.map(async c => ({
        name: c.name,
        expected: c.result,
        actual: await observeDecode(files.get(c.name)!, c.maxPixels),
      })),
    );
    expect(differences(results)).toBe("");
  });

  test("encode", async () => {
    expect(cases.encode.length).toBeGreaterThan(190);
    const results = await Promise.all(
      cases.encode.map(async c => ({
        name: `${c.source} ${JSON.stringify(c.options)}`,
        expected: c.result,
        actual: await observeEncode(files.get(c.source)!, c.options),
      })),
    );
    expect(differences(results)).toBe("");
  });
});

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array | number[] | string = []) {
  const body = Buffer.from(data as Uint8Array);
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const GRAY = 0;
const RGB = 2;
const INDEXED = 3;
const RGBA = 6;

function ihdr(width: number, height: number, depth: number, colorType: number, interlace = 0) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([depth, colorType, 0, 0, interlace], 8);
  return chunk("IHDR", data);
}

/** `rows` are unfiltered. */
const idat = (...rows: number[][]) => chunk("IDAT", zlib.deflateSync(Buffer.from(rows.flatMap(row => [0, ...row]))));
const iend = chunk("IEND");
const png = (...chunks: Buffer[]) => Buffer.concat([signature, ...chunks]);

function* chunksOf(file: Uint8Array) {
  const bytes = Buffer.from(file);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    yield { type: bytes.toString("latin1", at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) };
    at += 12 + length;
  }
}

/** The pixels as `rrggbbaa`, and the color profile. */
async function decode(file: Uint8Array, options: { maxPixels?: number } = {}) {
  const out = [...chunksOf(await new Bun.Image(file, options).png({ compressionLevel: 0 }).bytes())];
  const width = out[0].data.readUInt32BE(0);
  const lines = zlib.inflateSync(Buffer.concat(out.filter(c => c.type === "IDAT").map(c => c.data)));
  const pixels: string[] = [];
  for (let at = 0; at < lines.length; at += 1 + width * 4) {
    expect(lines[at]).toBe(0);
    for (let x = 0; x < width; x++) pixels.push(lines.toString("hex", at + 1 + x * 4, at + 5 + x * 4));
  }
  const iccp = out.find(c => c.type === "iCCP")?.data;
  return { pixels, profile: iccp ? zlib.inflateSync(iccp.subarray(iccp.indexOf(0) + 2)).toString("latin1") : null };
}
const pixels = async (...chunks: Buffer[]) => (await decode(png(...chunks))).pixels;
const profile = async (...chunks: Buffer[]) => (await decode(png(...chunks))).profile;
const rejects = (...chunks: Buffer[]) =>
  expect(decode(png(...chunks))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });

const iccp = (text: string, name = "name") =>
  chunk("iCCP", Buffer.concat([Buffer.from(`${name}\0\0`, "latin1"), zlib.deflateSync(Buffer.from(text))]));

// Each of these was so with libspng too, whatever the specification says.
describe("chunks before the image", () => {
  const rgba = [ihdr(1, 1, 8, RGBA), idat([1, 2, 3, 4]), iend] as const;
  const palette = chunk("PLTE", [10, 11, 12, 20, 21, 22]);
  const indexed = ihdr(4, 1, 2, INDEXED);
  const indices = idat([0b00_01_10_11]);

  test("an unknown ancillary chunk is passed over, an unknown critical one is not", async () => {
    expect(await pixels(rgba[0], chunk("abCd", "anything"), rgba[1], iend)).toEqual(["01020304"]);
    await rejects(rgba[0], chunk("AbCd", "anything"), rgba[1], iend);
  });

  test("a second IHDR, or IEND before IDAT, is refused", async () => {
    await rejects(rgba[0], rgba[0], rgba[1], iend);
    await rejects(rgba[0], iend, rgba[1], iend);
  });

  test("an index that PLTE has no entry for is opaque black", async () => {
    expect(await pixels(indexed, palette, indices, iend)).toEqual(["0a0b0cff", "141516ff", "000000ff", "000000ff"]);
  });

  test("an indexed image needs PLTE, with no more entries than the depth can index", async () => {
    await rejects(indexed, indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(5 * 3)), indices, iend);
    await rejects(indexed, chunk("PLTE", Buffer.alloc(4)), indices, iend);
    await rejects(indexed, chunk("PLTE"), indices, iend);
    expect(await pixels(rgba[0], chunk("PLTE", Buffer.alloc(256 * 3)), rgba[1], iend)).toEqual(["01020304"]);
    await rejects(rgba[0], chunk("PLTE", Buffer.alloc(257 * 3)), rgba[1], iend);
  });

  test("a second PLTE replaces only the entries it has", async () => {
    const first = chunk("PLTE", [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(await pixels(indexed, first, palette, indices, iend)).toEqual([
      "0a0b0cff",
      "141516ff",
      "030303ff",
      "040404ff",
    ]);
  });

  test("PLTE may not follow tRNS, bKGD or hIST, unless they were passed over", async () => {
    for (const [type, good, bad] of [
      ["tRNS", [0, 128], [0, 128, 255]],
      ["bKGD", [1], [2]],
      ["hIST", [0, 1, 0, 2], [0, 1]],
    ] as const) {
      await rejects(indexed, palette, chunk(type, [...good]), palette, indices, iend);
      expect((await pixels(indexed, palette, chunk(type, [...bad]), palette, indices, iend)).length).toBe(4);
    }
  });

  test("tRNS gives the first palette entries their alpha", async () => {
    expect(await pixels(indexed, palette, chunk("tRNS", [7]), indices, iend)).toEqual([
      "0a0b0c07",
      "141516ff",
      "000000ff",
      "000000ff",
    ]);
    // Before PLTE, or a second one: passed over.
    expect((await pixels(indexed, chunk("tRNS", [7]), palette, indices, iend))[0]).toBe("0a0b0cff");
    expect((await pixels(indexed, palette, chunk("tRNS", [7]), chunk("tRNS", [9]), indices, iend))[0]).toBe("0a0b0c07");
  });

  test("tRNS for gray counts all 16 bits of its sample, at any depth", async () => {
    const gray = (depth: number, trns: number[], row: number[]) =>
      pixels(ihdr(2, 1, depth, GRAY), chunk("tRNS", trns), idat(row), iend);
    expect(await gray(8, [0, 5], [5, 6])).toEqual(["05050500", "060606ff"]);
    expect(await gray(8, [1, 5], [5, 6])).toEqual(["050505ff", "060606ff"]);
    expect(await gray(2, [0, 2], [0b10_11_0000])).toEqual(["aaaaaa00", "ffffffff"]);
    expect(await gray(2, [0, 6], [0b10_11_0000])).toEqual(["aaaaaaff", "ffffffff"]);
    expect(await gray(16, [1, 5], [1, 5, 1, 6])).toEqual(["01010100", "010101ff"]);
  });

  test("tRNS for 8-bit RGB counts only the low byte of its samples", async () => {
    const rgb = (depth: number, trns: number[], row: number[]) =>
      pixels(ihdr(2, 1, depth, RGB), chunk("tRNS", trns), idat(row), iend);
    expect(await rgb(8, [0, 1, 0, 2, 0, 3], [1, 2, 3, 1, 2, 4])).toEqual(["01020300", "010204ff"]);
    expect(await rgb(8, [9, 1, 9, 2, 9, 3], [1, 2, 3, 1, 2, 4])).toEqual(["01020300", "010204ff"]);
    expect(await rgb(16, [9, 1, 9, 2, 9, 3], [9, 1, 9, 2, 9, 3, 9, 1, 9, 2, 9, 4])).toEqual(["09090900", "090909ff"]);
  });

  test("tRNS means nothing where there is an alpha channel", async () => {
    expect(await pixels(rgba[0], chunk("tRNS", [0, 1, 0, 2, 0, 3]), rgba[1], iend)).toEqual(["01020304"]);
  });

  test("only the first iCCP counts, and only before PLTE", async () => {
    expect(await profile(rgba[0], iccp("one"), rgba[1], iend)).toBe("one");
    expect(await profile(rgba[0], iccp("one"), iccp("two"), rgba[1], iend)).toBe("one");
    expect(await profile(rgba[0], chunk("PLTE", [1, 2, 3]), iccp("one"), rgba[1], iend)).toBe(null);
    // The first one counts as seen even when it is no good.
    expect(await profile(rgba[0], iccp("one", " name"), iccp("two"), rgba[1], iend)).toBe(null);
    // An empty one does not.
    expect(await profile(rgba[0], chunk("iCCP"), iccp("two"), rgba[1], iend)).toBe("two");
  });

  test("a damaged iCCP loses the profile, not the image", async () => {
    const good = iccp("profile").subarray(8, -4);
    for (const [why, data] of [
      ["empty name", iccp("profile", "").subarray(8, -4)],
      ["space before the name", iccp("profile", " a").subarray(8, -4)],
      ["space after the name", iccp("profile", "a ").subarray(8, -4)],
      ["two spaces", iccp("profile", "a  b").subarray(8, -4)],
      ["control character", iccp("profile", "a\x7fb").subarray(8, -4)],
      ["80 characters", iccp("profile", Buffer.alloc(80, "a").toString()).subarray(8, -4)],
      ["no terminator", Buffer.from("name")],
      ["nothing after the name", Buffer.from("name\0")],
      ["compression method 1", Buffer.concat([Buffer.from("name\0\x01"), good.subarray(6)])],
      ["no stream", Buffer.from("name\0\0")],
      ["stream cut short", good.subarray(0, -5)],
      ["stream without its checksum", good.subarray(0, -4)],
      ["stream damaged", Buffer.concat([good.subarray(0, 6), Buffer.from([0xff, 0xff]), good.subarray(8)])],
      ["stream of nothing", Buffer.concat([Buffer.from("name\0\0"), zlib.deflateSync(Buffer.alloc(0))])],
    ] as const) {
      expect([why, await decode(png(rgba[0], chunk("iCCP", data), rgba[1], iend))]).toEqual([
        why,
        { pixels: ["01020304"], profile: null },
      ]);
    }
    for (const name of ["a", "a b", "\xa1\xff", Buffer.alloc(79, "a").toString()]) {
      expect(await profile(rgba[0], iccp("profile", name), rgba[1], iend)).toBe("profile");
    }
    // The checksum has to be there, not to be right.
    const wrongChecksum = Buffer.from(good);
    wrongChecksum[wrongChecksum.length - 1] ^= 0xff;
    expect(await profile(rgba[0], chunk("iCCP", wrongChecksum), rgba[1], iend)).toBe("profile");
  });

  test("1000 chunks of text, suggested palettes and Exif, and no more", async () => {
    const many = (count: number, ...kinds: Buffer[]) =>
      png(rgba[0], ...Array.from({ length: count }, (_, i) => kinds[i % kinds.length]), rgba[1], iend);
    const text = chunk("tEXt", "key\0value");
    const mixed = [text, chunk("zTXt", "not even valid"), chunk("iTXt", "x"), chunk("sPLT", "x")];
    expect((await decode(many(1000, text))).pixels).toEqual(["01020304"]);
    await expect(decode(many(1001, text))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    expect((await decode(many(1000, ...mixed))).pixels).toEqual(["01020304"]);
    await expect(decode(many(1001, ...mixed))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    // Empty ones do not count, nor any eXIf but the first, nor chunks of other types.
    expect((await decode(many(3000, chunk("tEXt"), chunk("eXIf", "x"), chunk("teXt", "x")))).pixels).toEqual([
      "01020304",
    ]);
    expect((await decode(many(1001, ...Array(999).fill(text), chunk("eXIf", "x"), chunk("eXIf", "x")))).pixels).toEqual(
      ["01020304"],
    );
  });

  test("compressed text may inflate to as much as a profile may", async () => {
    const big = zlib.deflateSync(Buffer.alloc(9 << 20));
    const small = zlib.deflateSync(Buffer.alloc(1 << 20));
    for (const before of ["zTXt key\0\0", "iTXt key\0\x01\0en\0word\0"]) {
      const text = (stream: Buffer) =>
        png(rgba[0], chunk(before.slice(0, 4), Buffer.concat([Buffer.from(before.slice(5)), stream])), rgba[1], iend);
      expect((await decode(text(big))).pixels).toEqual(["01020304"]);
      expect((await decode(text(small), { maxPixels: 64 })).pixels).toEqual(["01020304"]);
      await expect(decode(text(big), { maxPixels: 64 })).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    }
    // Not compressed, or not well formed up to the stream: not inflated.
    for (const before of ["tEXt key\0", "iTXt key\0\0\0en\0word\0", "iTXt key\0\x01\x01en\0word\0", "zTXt key\0\x01"]) {
      const file = png(rgba[0], chunk(before.slice(0, 4), Buffer.concat([Buffer.from(before.slice(5)), big])), rgba[1]);
      expect((await decode(file, { maxPixels: 64 })).pixels).toEqual(["01020304"]);
    }
  });
});

describe("the image", () => {
  const header = ihdr(2, 2, 8, GRAY);
  const stream = zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3, 4]));
  const expected = ["010101ff", "020202ff", "030303ff", "040404ff"];

  test("the stream can be cut into IDAT chunks anywhere, empty ones too", async () => {
    for (let cut = 0; cut <= stream.length; cut++) {
      const parts = [
        chunk("IDAT"),
        chunk("IDAT", stream.subarray(0, cut)),
        chunk("IDAT"),
        chunk("IDAT", stream.subarray(cut)),
      ];
      expect(await pixels(header, ...parts, iend)).toEqual(expected);
    }
  });

  test("another chunk between two IDAT ends the stream", async () => {
    await rejects(
      header,
      chunk("IDAT", stream.subarray(0, 5)),
      chunk("tEXt", "a\0b"),
      chunk("IDAT", stream.subarray(5)),
    );
  });

  test("nothing after the last pixel is looked at", async () => {
    const whole = png(header, chunk("IDAT", stream));
    expect((await decode(whole)).pixels).toEqual(expected);
    // Not the CRC of the last IDAT,
    expect((await decode(whole.subarray(0, -4))).pixels).toEqual(expected);
    // but what an IDAT announces has to be there.
    await expect(decode(whole.subarray(0, -5))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
    expect(await pixels(header, chunk("IDAT", stream), chunk("JUNK"), header)).toEqual(expected);
    // Not the rest of the stream either: more rows, or no end.
    const longer = zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3, 4, 9, 9, 9, 9]));
    expect(await pixels(header, chunk("IDAT", longer), iend)).toEqual(expected);
    const stored = Buffer.from([0x78, 0x01, 0x00, 6, 0, ~6 & 255, 255, 0, 1, 2, 0, 3, 4]);
    expect(await pixels(header, chunk("IDAT", stored), iend)).toEqual(expected);
  });

  test("a stream that ends early, or a filter that does not exist, is refused", async () => {
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 0, 3]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 5, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateSync(Buffer.from([5, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, chunk("IDAT", zlib.deflateRawSync(Buffer.from([0, 1, 2, 0, 3, 4]))), iend);
    await rejects(header, iend);
  });

  test("every filter, for every size of pixel, in rows of several lengths", async () => {
    let seed = 1;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
    const paeth = (a: number, b: number, c: number) => {
      const [pa, pb, pc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const images: { name: string; file: Buffer; expected: string }[] = [];
    for (const [colorType, depth, channels] of [
      [GRAY, 8, 1],
      [4, 8, 2],
      [RGB, 8, 3],
      [RGBA, 8, 4],
      [RGB, 16, 3],
      [RGBA, 16, 4],
    ]) {
      const bpp = (channels * depth) / 8;
      // Some filters are undone four pixels at a time.
      for (const width of [1, 2, 3, 4, 5, 7, 8, 9, 13]) {
        // Twice each, so that each also comes after a row that is not zeros.
        const filters = [4, 3, 2, 1, 0, 1, 2, 3, 4, 0];
        const lines: number[] = [];
        let above: number[] = Array(width * bpp).fill(0);
        const rgba: number[] = [];
        for (const filter of filters) {
          const row: number[] = [];
          lines.push(filter);
          for (let i = 0; i < width * bpp; i++) {
            const x = random();
            lines.push(x);
            const [a, b, c] = [row[i - bpp] ?? 0, above[i], above[i - bpp] ?? 0];
            row.push((x + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255);
          }
          for (let x = 0; x < width; x++) {
            const [s0, s1, s2, s3] = Array.from({ length: channels }, (_, ch) => row[x * bpp + (ch * depth) / 8]);
            rgba.push(...(channels <= 2 ? [s0, s0, s0, s1 ?? 255] : [s0, s1, s2, s3 ?? 255]));
          }
          above = row;
        }
        images.push({
          name: `color type ${colorType}, depth ${depth}, width ${width}`,
          file: png(ihdr(width, filters.length, depth, colorType), chunk("IDAT", zlib.deflateSync(Buffer.from(lines)))),
          expected: Buffer.from(rgba).toString("hex") + "\n",
        });
      }
    }
    const results = await Promise.all(
      images.map(async ({ name, file, expected }) => ({
        name,
        expected,
        actual: (await decode(file)).pixels.join("") + "\n",
      })),
    );
    expect(differences(results)).toBe("");
  });
});

// libspng read the chunks after IDAT when asked for the profile, and gave none if they were bad or missing.
test("the color profile does not depend on what follows the image", async () => {
  const start = [ihdr(1, 1, 8, RGBA), iccp("profile"), idat([1, 2, 3, 4])];
  const expected = { pixels: ["01020304"], profile: "profile" };
  expect(await decode(png(...start, iend))).toEqual(expected);
  expect(await decode(png(...start))).toEqual(expected);
  expect(await decode(png(...start).subarray(0, -4))).toEqual(expected);
  expect(await decode(png(...start, chunk("JUNK"), iend))).toEqual(expected);
  expect(await decode(png(...start, chunk("tEXt", "a\0b"), idat([1, 2, 3, 4]), iend))).toEqual(expected);
  expect(await decode(png(...start, chunk("IEND", "not empty")))).toEqual(expected);
});

describe("what is written", () => {
  const source = files.get("generated/noise 120x90")!;
  const withProfile = files.get("generated/gradient with profile 90x70")!;
  const layout = async (file: Uint8Array, options: Parameters<Bun.Image["png"]>[0]) =>
    [...chunksOf(await new Bun.Image(file).png(options).bytes())].map(c => `${c.type} ${c.data.length}`);

  test("IDAT chunks of 8192 bytes", async () => {
    const written = await layout(source, { compressionLevel: 0 });
    // 90 rows of 1 + 120 * 4 bytes, the 2 + 4 bytes around a zlib stream, and 5 for each stored block.
    expect(written.slice(0, -2)).toEqual(["IHDR 13", ...Array(5).fill("IDAT 8192")]);
    expect(written.at(-1)).toBe("IEND 0");
  });

  test("iCCP, PLTE and tRNS come in this order, tRNS only if a color is not opaque", async () => {
    const types = async (file: Uint8Array, options: Parameters<Bun.Image["png"]>[0]) =>
      (await layout(file, options)).map(c => c.slice(0, 4)).join(" ");
    expect(await types(withProfile, {})).toBe("IHDR iCCP IDAT IEND");
    expect(await types(withProfile, { palette: true, colors: 4 })).toBe("IHDR iCCP PLTE IDAT IEND");
    expect(await layout(source, { palette: true, colors: 4 })).toEqual([
      "IHDR 13",
      "PLTE 12",
      "tRNS 4",
      expect.stringMatching(/^IDAT \d+$/),
      "IEND 0",
    ]);
  });

  test("the profile is named ICC Profile, whatever it was called", async () => {
    const [, written] = chunksOf(await new Bun.Image(withProfile).png().bytes());
    expect(written.data.toString("latin1", 0, 13)).toBe("ICC Profile\0\0");
  });

  test("rows are filtered, except at level 0 and with a palette", async () => {
    const filters = async (options: Parameters<Bun.Image["png"]>[0], bytesPerPixel: number) => {
      const out = [...chunksOf(await new Bun.Image(files.get("generated/gradient 200x150")!).png(options).bytes())];
      const lines = zlib.inflateSync(Buffer.concat(out.filter(c => c.type === "IDAT").map(c => c.data)));
      return new Set(Array.from({ length: 150 }, (_, y) => lines[y * (1 + 200 * bytesPerPixel)]));
    };
    expect(await filters({ compressionLevel: 0 }, 4)).toEqual(new Set([0]));
    expect(await filters({ palette: true }, 1)).toEqual(new Set([0]));
    expect(await filters({ compressionLevel: 1 }, 4)).not.toContain(0);
  });
});
