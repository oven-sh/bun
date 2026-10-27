// For these files and images, `Bun.Image` reads and writes WebP exactly as it did with libwebp 1.6.0: the same pixels,
// the same errors, the same bytes. The exceptions are what libwebp has fixed since, and say so. record.ts says where the
// expected results come from.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  hash,
  isLarge,
  load,
  observeDecode,
  observeEncode,
  observeMetadata,
  type DecodeCase,
  type EncodeCase,
} from "./observe";

const decodeCases = await load<DecodeCase>(join(import.meta.dir, "decode.json.gz"));
const encodeCases = await load<EncodeCase>(join(import.meta.dir, "encode.json.gz"));

function batches<T>(cases: T[], size: number): [string, T[], number][] {
  const out: [string, T[], number][] = [];
  for (let start = 0; start < cases.length; start += size) {
    out.push([`${start}-${Math.min(start + size, cases.length) - 1}`, cases.slice(start, start + size), start]);
  }
  return out;
}

describe("decode", () => {
  test.each(batches(decodeCases, 100))("cases %s", async (_, cases, start) => {
    const actual = await Promise.all(
      cases.map(async ({ data, decoded }, index) => {
        const file = Buffer.from(data, "base64");
        return {
          index: start + index,
          metadata: await observeMetadata(file),
          decoded: decoded && (await observeDecode(file)),
        };
      }),
    );
    expect(actual).toEqual(cases.map(({ metadata, decoded }, index) => ({ index: start + index, metadata, decoded })));
  });

  // `farCopies` in record.ts
  test.each([
    ["window.webp", "a6bbac0514052fcd"],
    ["window-alpha.webp", "b8e2fd7d068c2477"],
    ["window-alpha-palette.webp", "672701d36786cb15"],
  ])("backward references to the first row that the decoder still has, in %s", async (name, rgba) => {
    const file = await Bun.file(join(import.meta.dir, name)).bytes();
    expect(await observeDecode(file)).toEqual({ width: 16383, height: 170, rgba, icc: undefined });
  });

  // No encoder writes these coefficients. They overflow the 16-bit arithmetic of libwebp's SSE2 code but not its C code.
  test("coefficients that overflow 16 bits decode as in libwebp's C code", async () => {
    const cases = [
      {
        data: "UklGRkYAAABXRUJQVlA4IDkAAAC2AwCdASogAA8Az4BqhEgAC6D8uzfxihQIGdILRCzLeiAfSca+OAD183X3zflN//r1u///zfr2jX8A",
        decoded: { width: 32, height: 15, rgba: "ea6839333e4e3c49" },
      },
      {
        data: "UklGRnAAAABXRUJQVlA4IGMAAACSBACdASovwByAD9IUCAAcby/Yz2lm0eUo8eq51tFU780F4Be3dlEutruJ7cagDgAAGwAAAwAAJ53SUqnfXa6vkrMM55Em////////////////////7//////////////1/ncA",
        decoded: { width: 47, height: 28, rgba: "0af0ea6c72c50e79" },
      },
      {
        data: "UklGRoYAAABXRUJQVlA4IHoAAAByAwCdASoxQA9AQASsBAALxuief+JlpCePqrdA3dHg6jD3pkVgUQAAUv+S/////////////////0Gb////+v////9h/////+D//////////////9n/////N/////////8a////////////////////////Tv//////7w==",
        decoded: { width: 49, height: 15, rgba: "a935dbefef375a5c" },
      },
      {
        data: "UklGRo4AAABXRUJQVlA4IIIAAADwBgCdASo9QBGAEAAj95Y9K8wABngD+b7Utn212ydw8w2U6zn3tjPWHh2ZEvPfX+BXBoEaYMl+DKmOBT976tRwAOb//////////////////////////////////5T////E/////////////////////////x3///9h///////s//9K",
        decoded: { width: 61, height: 17, rgba: "4c397305791f56c1" },
      },
      {
        data: "UklGRpgAAABXRUJQVlA4IIwAAAAQBgCdASoPgDNAHoAaCAAfM8zysLrwJANObdKSp8dQx0qBsb+tIE5rmyXnXW14EdMW+YCvYUnyF2AAKL//yf//8///////////+v///////////////////////////xX/////////////////////////7f//////////////////////////////OQ==",
        decoded: { width: 15, height: 51, rgba: "a5bd7904915f508b" },
      },
    ];
    const actual = await Promise.all(cases.map(({ data }) => observeDecode(Buffer.from(data, "base64"))));
    expect(actual).toEqual(cases.map(({ decoded }) => decoded));
  });

  // libwebp refuses these since 1844042d, after 1.6.0: the first byte is the boolean decoder's value, which stays below 255.
  test("a partition that starts with 0xff is refused", async () => {
    const file = Buffer.from(
      "UklGRlIAAABXRUJQVlA4IEYAAACQAgCdASoBwAFAADj2CBM3IJKlKUi2VpmXqCcPX4D///85/////////////2//////////////////////////////////",
      "base64",
    );
    expect(await observeMetadata(file)).toEqual({ width: 1, height: 1, format: "webp" });
    expect(await observeDecode(file)).toEqual({ error: "ERR_IMAGE_DECODE_FAILED" });
  });
});

// Small files with what was wrong in the inputs behind libwebp's CVEs and its container fixes, and valid ones next to them.
describe("libwebp's history", () => {
  const hex = (digits: string) => Buffer.from(digits, "hex");
  const le32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  /** `size` is what the chunk's header says. */
  const chunk = (tag: string, payload: Uint8Array, size = payload.length) =>
    Buffer.concat([Buffer.from(tag), le32(size), payload, Buffer.alloc(payload.length & 1)]);
  /** `size` is what the RIFF header says. */
  const riff = (chunks: Uint8Array[], size?: number) => {
    const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
    return Buffer.concat([Buffer.from("RIFF"), le32(size ?? body.length), body]);
  };
  const [ANIMATION, ALPHA, ICCP] = [0x02, 0x10, 0x20];
  /** `canvas` is the width and the height, each minus one, in 24 bits. */
  const vp8x = (flags: number, canvas = "000000000000") => chunk("VP8X", Buffer.concat([le32(flags), hex(canvas)]));
  const lossy = chunk("VP8 ", hex("3201009d012a010001001178181180008e8000fe68000000"));
  const lossless = chunk("VP8L", hex("2f00000010071011118888fe07"));
  const iccp = chunk("ICCP", Buffer.from("prof"));
  const anim = chunk("ANIM", hex("ffffffff0000"));
  /** `size` is what the chunk's header says. The frame is 1 x 1 at the origin. */
  const anmf = (payload: Uint8Array, size = 16 + payload.length) =>
    chunk("ANMF", Buffer.concat([hex("00000000000000000000000064000000"), payload]), size);
  const alph = (payload: string) => chunk("ALPH", hex(payload));
  /** A lossless 1 x 1 image whose distance code has the lengths that `bits` spells out. */
  const withDistanceCode = (bits: string) =>
    riff([chunk("VP8L", hex("2f000000006844453ad37f0f90240992244912" + bits.padEnd(40, "0")))]);

  /**
   * A lossless 3 x 1 image. Its green, red, blue and alpha codes have the largest tables that valid codes can have; `bits`
   * is the end of its distance code and its pixels.
   */
  const withLargestTables = (bits: string) =>
    riff([
      chunk(
        "VP8L",
        hex(
          "2f02000010f02d49922549926d216566ddeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfdde" +
            "f7fbfd7ebfdf66ed737c4b92644992645b4879affbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd" +
            "7ebfdfeff79eb5cff12d49922549926d21e5bdeef7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fb" +
            "fd7ebfdf7bd63ec7b72449962449b68594f7badfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7fbfd7ebfdfeff7" +
            "fbfd7eef59fb1cdf9224599224d9" +
            bits,
        ),
      ),
    ]);

  const refused = { error: "ERR_IMAGE_DECODE_FAILED" };
  const size = { width: 1, height: 1, format: "webp" };
  const pixel = (rgba: string, icc?: string) => ({
    width: 1,
    height: 1,
    rgba: hash(hex(rgba)),
    icc: icc === undefined ? undefined : hash(Buffer.from(icc)),
  });
  const [gray, clear, color] = ["7f7f7fff", "00000000", "221133ff"];

  test.each([
    ["a lossy image", riff([lossy]), size, pixel(gray)],
    ["a lossless image", riff([lossless]), size, pixel(clear)],
    ["a profile", riff([vp8x(ICCP), iccp, lossy]), size, pixel(gray, "prof")],
    ["a profile behind the image", riff([vp8x(ICCP), lossy, iccp]), size, pixel(gray, "prof")],
    [
      "bytes behind the RIFF chunk",
      Buffer.concat([riff([vp8x(ICCP), iccp, lossy]), hex("0a")]),
      size,
      pixel(gray, "prof"),
    ],

    // CVE-2012-5127, CVE-2020-36331: the padded size of a chunk overflowed 32 bits.
    [
      "a chunk of 0xfffffff7 bytes",
      riff([vp8x(ICCP), chunk("ICCP", Buffer.from("prof"), 0xfffffff7), lossy]),
      refused,
      refused,
    ],
    [
      "a chunk of 0xffffffff bytes",
      riff([vp8x(ICCP), chunk("ICCP", Buffer.from("prof"), 0xffffffff), lossy]),
      refused,
      refused,
    ],
    ["an image chunk of 0xffffffff bytes", riff([chunk("VP8 ", lossy.subarray(8), 0xffffffff)]), refused, refused],
    ["a RIFF chunk of 0xfffffff7 bytes", riff([lossy], 0xfffffff7), refused, refused],
    [
      "a chunk that ends behind the RIFF chunk",
      riff([vp8x(ICCP), chunk("ICCP", Buffer.from("prof"), 0x40), lossy]),
      refused,
      refused,
    ],
    // d9bf5734, after 1.6.0: the largest size a chunk may have made the sum of the sizes overflow 32 bits.
    [
      "a chunk of 0xfffffff6 bytes",
      riff([vp8x(ICCP), chunk("ICCP", Buffer.from("prof"), 0xfffffff6), lossy]),
      refused,
      refused,
    ],

    // CVE-2018-25009, CVE-2018-25012: the canvas size was read from a VP8X chunk too short to have one.
    ["a file that ends inside VP8X", riff([vp8x(ICCP)], 16).subarray(0, 24), refused, refused],
    ["a VP8X chunk of 4 bytes", riff([chunk("VP8X", le32(ICCP)), lossy]), refused, refused],
    ["a VP8X chunk of 0 bytes", riff([chunk("VP8X", Buffer.alloc(0))]), refused, refused],

    // CVE-2020-36330, OSV-2024-1356: a RIFF size smaller than the header made the number of bytes left wrap around.
    ...[0, 3, 4, 8, 11, 12].map(n => [`a RIFF chunk of ${n} bytes`, riff([lossy], n), refused, refused] as const),

    // CVE-2018-25011: a second image chunk. The decoder stops at the first; the demuxer, which finds the profile, refuses the file.
    ["two lossy images", riff([vp8x(ICCP), iccp, lossy, lossy]), size, pixel(gray)],
    ["a lossy and a lossless image", riff([vp8x(ICCP), iccp, lossy, lossless]), size, pixel(gray)],
    [
      "a frame with two images",
      riff([vp8x(ICCP | ANIMATION), iccp, anim, anmf(Buffer.concat([lossy, lossy]))]),
      size,
      refused,
    ],

    // CVE-2018-25010: smoothing pre-processed alpha levels overflowed on small images. Nothing here smooths them.
    ["alpha", riff([vp8x(ALPHA), alph("0080"), lossy]), size, pixel("7f7f7f80")],
    ["alpha with pre-processed levels", riff([vp8x(ALPHA), alph("1080"), lossy]), size, pixel("7f7f7f80")],
    ["alpha with the gradient filter", riff([vp8x(ALPHA), alph("0c80"), lossy]), size, pixel("7f7f7f80")],
    ["alpha without its flag", riff([vp8x(0), alph("0080"), lossy]), size, pixel("7f7f7f80")],
    ["an empty alpha chunk", riff([vp8x(ALPHA), alph(""), lossy]), size, refused],
    ["an alpha chunk with a header only", riff([vp8x(ALPHA), alph("00"), lossy]), size, refused],
    ["an unknown alpha method", riff([vp8x(ALPHA), alph("0280"), lossy]), size, refused],
    ["an unknown alpha pre-processing", riff([vp8x(ALPHA), alph("2080"), lossy]), size, refused],
    ["a reserved bit in the alpha header", riff([vp8x(ALPHA), alph("4080"), lossy]), size, refused],
    ["lossless alpha of one byte", riff([vp8x(ALPHA), alph("0100"), lossy]), size, refused],

    // CVE-2023-4863: the tables of an incomplete code were written, past their end, before the code was found to be invalid.
    ["a complete distance code of 15 levels", withDistanceCode("128b9a4756cfde3f"), size, pixel(color)],
    [
      "the incomplete distance code of the exploit",
      withDistanceCode("128b6666666666665555f5cccccccccceeeedd3f"),
      size,
      refused,
    ],
    [
      "the exploit: 414 table entries where 410 are left",
      withLargestTables("16128be6fd56b79efb655df63e077efdffffffffff37dd72cb2d0100"),
      { ...size, width: 3 },
      refused,
    ],
    [
      "542 table entries where 410 are left",
      withLargestTables("5666ddfbde3df7fb6ded730efcfaffffffffff6fbae5965b0200"),
      { ...size, width: 3 },
      refused,
    ],
    [
      "410 table entries where 410 are left",
      withLargestTables("1611b178deeff77b66f5ac7d0efcfaffffffffff6fbae5965b02"),
      { ...size, width: 3 },
      { ...pixel("00000000ffffffff64646464"), width: 3 },
    ],
    ["an over-subscribed distance code", withDistanceCode("2202"), size, refused],
    ["a distance code without symbols", withDistanceCode(""), size, refused],

    // CVE-2020-36332: 34 bytes asked for the tables of 65536 groups of codes.
    [
      "the second of two groups of codes",
      riff([chunk("VP8L", hex("2f00000000840614a000052840232ad299fe17a01115e94cff0b00"))]),
      size,
      pixel(color),
    ],
    ["group 65535 in a file too short for it", riff([chunk("VP8L", hex("2f0000000084fef7bf00052800"))]), size, refused],
    [
      "group 65535 and a color cache in a file too short for them",
      riff([chunk("VP8L", hex("2f000000106ee87fff2302"))]),
      size,
      refused,
    ],
    [
      "group 65535 behind 65535 unused groups",
      riff([
        chunk("VP8L", Buffer.concat([hex("2f0000001084fef73f"), Buffer.alloc(163838, 0x22), hex("a2229d6944ff03")])),
      ]),
      size,
      pixel("332211ff"),
    ],

    // Frames in a file that is not an animation do not count, but the demuxer validates them before it gives out the profile.
    ["a frame", riff([vp8x(ICCP), iccp, lossy, anim, anmf(lossy)]), size, pixel(gray, "prof")],
    ["a frame without ANIM", riff([vp8x(ICCP), iccp, lossy, anmf(lossy)]), size, pixel(gray)],
    [
      "a frame chunk of 15 bytes",
      riff([vp8x(ICCP), iccp, lossy, anim, chunk("ANMF", Buffer.alloc(15))]),
      size,
      pixel(gray),
    ],
    [
      "a frame chunk with a header only",
      riff([vp8x(ICCP), iccp, lossy, anim, anmf(Buffer.alloc(0))]),
      size,
      pixel(gray),
    ],
    [
      "a frame chunk shorter than its image",
      riff([vp8x(ICCP), iccp, lossy, anim, anmf(lossy, 16 + lossy.length - 2)]),
      size,
      pixel(gray),
    ],
    // 3f9e7e03, after 1.6.0.
    [
      "a frame without an image",
      riff([vp8x(ICCP), iccp, lossy, anim, anmf(chunk("JUNK", hex("0000")))]),
      size,
      pixel(gray),
    ],

    ["an animation", riff([vp8x(ICCP | ANIMATION), iccp, anim, anmf(lossy)]), size, refused],
    ["the animation flag on a still image", riff([vp8x(ICCP | ANIMATION), iccp, lossy]), size, refused],
    ["a canvas larger than the image", riff([vp8x(0, "010000000000"), lossy]), refused, refused],
    ["a canvas of 65536 x 65536", riff([vp8x(0, "ffff00ffff00"), lossy]), refused, refused],
    ["a second VP8X chunk", riff([vp8x(ICCP), iccp, vp8x(ICCP), lossy]), size, pixel(gray)],
    ["a profile without its flag", riff([vp8x(0), iccp, lossy]), size, pixel(gray)],
    ["a reserved flag", riff([vp8x(ICCP | 1), iccp, lossy]), size, pixel(gray)],
    ["alpha behind the image", riff([vp8x(ICCP | ALPHA), iccp, lossy, alph("0080")]), size, pixel(gray)],
    ["two alpha chunks", riff([vp8x(ICCP | ALPHA), iccp, alph("0080"), alph("0040"), lossy]), size, pixel("7f7f7f40")],
    [
      "alpha in front of a lossless image",
      riff([vp8x(ICCP | ALPHA), iccp, alph("0080"), lossless]),
      size,
      pixel(clear),
    ],
  ] as const)("%s", async (_, file, metadata, decoded) => {
    expect({ metadata: await observeMetadata(file), decoded: await observeDecode(file) }).toEqual({
      metadata,
      decoded,
    });
  });
});

describe("encode", () => {
  const large = encodeCases.filter(c => isLarge(c.image));
  const small = encodeCases.filter(c => !isLarge(c.image));

  test.each(batches(small, 50))("cases %s", async (_, cases) => {
    const actual = await Promise.all(cases.map(async c => ({ ...c, ...(await observeEncode(c)) })));
    expect(actual).toEqual(cases);
  });

  test.concurrent.each(large.map(c => [JSON.stringify({ ...c.image, ...c.options }), c] as const))(
    "large image %s",
    async (_, c) => {
      expect({ ...c, ...(await observeEncode(c)) }).toEqual(c);
    },
  );

  test("an image that takes more than 500 cost intervals", async () => {
    const file = await Bun.file(join(import.meta.dir, "intervals.webp")).bytes();
    expect(hash(await new Bun.Image(file).webp({ lossless: true }).bytes())).toBe(hash(file));
  });
});
