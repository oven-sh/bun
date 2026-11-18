// imageData() converts from the ICC profile of the file, and pixels that are not sRGB get a profile when they are
// encoded. test/js/web/html/wpt has files with the profiles of sRGB, Display P3 and Adobe RGB.
import { describe, expect, test } from "bun:test";
import { isMacOS } from "harness";
import * as icc from "./icc";
import { decoded } from "./png-golden/check";
import { chunk, randomBytes } from "./png-golden/write";

const { curv, encodedLab, encodedXyz, mAB, matrixOf, mft, mix, P3, para, profile, rgbProfile, SRGB, three } = icc;
const { pngWithProfile, sampledCurve, srgbCurve, srgbToLight } = icc;
type ColorSpace = Bun.Image.ColorSpace;

const rgbaOf = (hex: string) => hex.split(" ").flatMap((it, i) => [...Buffer.from(it, "hex"), (i * 37) & 255]);
const convert = async (rgba: number[], icc: Uint8Array, colorSpace?: ColorSpace) => [
  ...(await new Bun.Image(pngWithProfile(rgba, icc)).imageData({ colorSpace })).data,
];
/** The channels that are further than `tolerance` from what is expected. Alpha has to be the same. */
const far = (actual: number[], expected: number[], tolerance = 1) =>
  expected.flatMap((it, i) =>
    Math.abs(actual[i] - it) <= (i % 4 === 3 ? 0 : tolerance) ? [] : [`${i >> 2}.${i & 3}: ${actual[i]}, not ${it}`],
  );

const linear = curv();
const p3ToXyz = (rgb: number[]) => mix(P3, rgb.map(srgbToLight));
const p3ToLab = (rgb: number[]) => encodedLab(p3ToXyz(rgb));
const lab = { connection: "Lab " };
// As jpegli's: the table takes the channels apart, and they are cubed and mixed. These numbers are made up.
const likeXyb = mAB({
  a: three(linear),
  clut: [[2, 2, 2], 2, ([x, y, b]) => [0.8 * y + 0.2 * x, 0.2 + 0.8 * y - 0.2 * x, 0.5 * (y + b)]],
  m: [para(3, 3, 1.1, -0.1, 0, 0.0909), para(3, 3, 1.05, -0.05, 0, 0.0477), para(3, 3, 1, 0, 0, 0)],
  matrix: matrixOf([
    [1.5, 0.6, -0.1],
    [-0.7, 0.4, 0.05],
    [0.1642, 0, 0.8749],
  ]),
  b: three(linear),
});

const colors = "000000 010101 020408 101010 808080 fefefe ffffff ff0000 00ff00 0000ff bb3311 33bb99 4d20cc e6cc10";
const grays = "000000 010101 020202 040404 080808 101010 404040 808080 bbbbbb fefefe ffffff";

// From Little CMS 2.14, rounded: transicc -n -c0 -t1 -i <the profile> -o <*sRGB, or the Display P3 that Bun writes>
const known: [name: string, icc: Buffer, from: string, srgb: string, displayP3: string][] = [
  [
    "a gamma",
    rgbProfile(P3, three(curv(0x1cd))),
    colors,
    "000000 000000 000207 141414 929292 fefefe ffffff ff0000 00ff00 0000ff d83300 00caa8 6727de efd500",
    "000000 000000 010206 141414 929292 fefefe ffffff ff0000 00ff00 0000ff c74215 42c7a9 602bd6 ebd614",
  ],
  [
    "a table",
    rgbProfile(P3, three(sampledCurve(33, x => x ** 2))),
    colors,
    "000000 000000 010203 0d0d0d 898989 fefefe ffffff ff0000 00ff00 0000ff d32600 00c5a0 5d1dda eed000",
    "000000 000000 010203 0d0d0d 898989 fefefe ffffff ff0000 00ff00 0000ff c2390e 39c2a2 5522d1 e9d10d",
  ],
  [
    "a curve for each channel",
    rgbProfile(P3, [curv(0x233), linear, srgbCurve]),
    colors,
    "000000 000d00 002205 004802 6ebe7a fefffe ffffff ff0000 00ff00 0000ff c77800 00e293 4564d3 e7e700",
    "000000 000d01 002208 074710 81bc80 fefffe ffffff ff0000 00ff00 0000ff bc7c11 30de99 4c63cc e7e710",
  ],
  [
    "the colorants of sRGB with other curves",
    rgbProfile(SRGB, [curv(0x233), linear, srgbCurve]),
    colors,
    "000000 000d01 002208 084710 81bc80 fefffe ffffff ff0000 01ff00 0000ff bc7c11 30de99 4c63cc e7e710",
    "000000 020c02 09210b 1e4618 8eba86 fefffe ffffff ea3323 75fb4c 0000f5 b37e2f 6ddb9e 5163c5 e7e74e",
  ],
  [
    "function type 0",
    rgbProfile(P3, three(para(0, 2.6))),
    colors,
    "000000 000000 000000 020202 717171 fefefe ffffff ff0000 00ff00 0000ff c30000 00b58a 4109cd e8c400",
    "000000 000000 000000 020202 717171 fefefe ffffff ff0000 00ff00 0000ff b22103 21b28d 3b0ec5 e3c502",
  ],
  [
    "function type 1",
    rgbProfile(P3, three(para(1, 2.2, 1.1, -0.1))),
    colors,
    "000000 000000 000000 000000 747474 fefefe ffffff ff0000 00ff00 0000ff c70000 00b98e 3f00d1 eac700",
    "000000 000000 000000 000000 747474 fefefe ffffff ff0000 00ff00 0000ff b61800 18b690 3903c8 e4c800",
  ],
  [
    "function type 2",
    rgbProfile(P3, three(para(2, 2.2, 1, -0.05, 0.02))),
    colors,
    "272727 272727 272727 272727 7a7a7a f4f4f4 f5f5f5 ff0008 00f900 2727ff c3241a 00b690 4f28cc e2c300",
    "272727 272727 272727 272727 7a7a7a f4f4f4 f5f5f5 f52727 27f527 2727f5 b33527 35b392 4a2ac4 ddc427",
  ],
  [
    "function type 3",
    rgbProfile(P3, three(para(3, 2.222, 0.91, 0.09, 0.222, 0.081))),
    colors,
    "000000 030303 040c15 1f1f1f 8c8c8c fefefe ffffff ff0000 00ff00 0000ff d33504 00c5a1 632dda eed000",
    "000000 030303 060b14 1f1f1f 8c8c8c fefefe ffffff ff0000 00ff00 0000ff c24320 43c2a3 5c30d1 e9d11f",
  ],
  [
    "function type 4",
    rgbProfile(P3, three(para(4, 2.4, 0.94, 0.05, 0.08, 0.04, 0.01, 0.005))),
    colors,
    "101010 101010 111315 212121 818181 fcfcfc fdfdfd ff0000 00ff00 1010ff cb2a0c 00be98 5728d3 eaca00",
    "101010 101010 111215 212121 818181 fcfcfc fdfdfd fd1010 10fd10 1010fd bb3a21 3abb99 512bcb e5cb21",
  ],
  [
    "red and green swapped",
    rgbProfile([SRGB[1], SRGB[0], SRGB[2]], three(srgbCurve)),
    colors,
    "000000 010101 040208 101010 808080 fefefe ffffff 01ff00 ff0000 0000ff 33bb11 bb3399 204dcc cce610",
    "000000 010101 040207 101010 808080 fefefe ffffff 75fb4c ea3323 0000f5 5fb83a ac3e95 2c4cc5 d1e54c",
  ],
  [
    "gray",
    profile({ kTRC: curv(0x1cd) }, { space: "GRAY" }),
    grays,
    "000000 000000 010101 020202 060606 141414 515151 929292 c7c7c7 fefefe ffffff",
    "000000 000000 010101 020202 060606 141414 515151 929292 c7c7c7 fefefe ffffff",
  ],
  [
    "gray as lightness",
    profile({ kTRC: linear }, { space: "GRAY", ...lab }),
    grays,
    "000000 010101 030303 060606 0b0b0b 141414 3c3c3c 777777 b4b4b4 fefefe ffffff",
    "000000 010101 030303 060606 0b0b0b 141414 3c3c3c 777777 b4b4b4 fefefe ffffff",
  ],
  [
    "mft1 to Lab",
    profile({ A2B0: mft(1, 9, p3ToLab) }, { version: 2, ...lab }),
    colors,
    "000000 010101 02060c 141414 808080 fefefe ffffff ff0000 00ff00 0003ff cc2200 00be97 541cd3 ebcb00",
    "000000 010101 03060b 141414 808080 fefefe ffffff fe0300 00ff00 0002ff bb3514 35bb99 4e20cb e6cc12",
  ],
  [
    "mft2 to Lab",
    profile({ A2B0: mft(2, 9, it => p3ToLab(it).map(x => (x * 0xff00) / 0xffff)) }, { version: 2, ...lab }),
    colors,
    "000000 010101 02060c 141414 808080 fefefe ffffff ff0000 00ff00 0000ff cc2200 00be97 541dd4 ebcb00",
    "000000 010101 03060b 141414 808080 fefefe ffffff ff0000 00ff00 0000ff bb3514 35bb99 4d20cc e6cc12",
  ],
  [
    "mft2 to XYZ",
    profile({ A2B0: mft(2, 2, it => encodedXyz(mix(P3, it)), srgbToLight, 1024) }, { version: 2 }),
    colors,
    "000000 010101 020408 101010 808080 fefefe ffffff ff0000 00ff00 0000ff cc1f00 00be97 541cd4 ebcb00",
    "000000 010101 020408 101010 808080 fefefe ffffff ff0004 00ff00 0000ff bb3312 33bb99 4d20cc e6cc11",
  ],
  [
    "A2B1 if there is no A2B0",
    profile({ A2B1: mft(2, 2, it => encodedXyz(mix(P3, it.toReversed())), srgbToLight) }, { version: 2 }),
    colors,
    "000000 010101 090402 101010 808080 fefefe ffffff 0000ff 00ff00 ff0000 0034c3 90bc00 df004a 00d0ea",
    "000000 010101 080402 101010 808080 fefefe ffffff 0000ff 00ff00 ff0004 1133bb 99bb33 cc204d 10cce6",
  ],
  [
    "mAB with a table of 8 bits",
    profile({ A2B0: mAB({ a: three(linear), clut: [[9, 9, 9], 1, p3ToLab], b: three(linear) }) }, lab),
    colors,
    "000000 010101 02060c 141414 808080 fefefe ffffff ff0000 00ff00 0003ff cc2200 00be97 541cd3 ebcb00",
    "000000 010101 03060b 141414 808080 fefefe ffffff fe0300 00ff00 0002ff bb3514 35bb99 4e20cb e6cc12",
  ],
  [
    "mAB with axes of different lengths",
    profile({ A2B0: mAB({ a: three(linear), clut: [[5, 9, 7], 2, p3ToLab], b: three(linear) }) }, lab),
    colors,
    "000000 020101 04060c 161514 808080 fefefe ffffff ff0000 00ff00 0000ff cc2200 00be97 571dd4 ebcb00",
    "000000 020201 04060c 161514 808080 fefefe ffffff ff0000 00ff00 0000ff bb3515 38bb99 5020cc e6cc14",
  ],
  [
    "mAB without a table",
    profile({ A2B0: mAB({ m: three(srgbCurve), matrix: matrixOf(P3), b: three(linear) }) }),
    colors,
    "000000 010101 020408 101010 808080 fefefe ffffff ff0000 00ff00 0000ff cc1f00 00be97 541dd4 ebcb00",
    "000000 010101 020408 101010 808080 fefefe ffffff ff0000 00ff00 0000ff bb3311 33bb99 4d20cc e6cc10",
  ],
  [
    "mAB with every stage",
    profile({
      A2B0: mAB({
        a: [para(0, 1.2), curv(0x100), curv(0, 20000, 65535)],
        clut: [[2, 3, 2], 2, ([r, g, b]) => [0.9 * r + 0.1 * g, g * g, 0.8 * b + 0.2 * g]],
        m: [para(0, 1.8), curv(0x200), srgbCurve],
        matrix: matrixOf(P3, [0.004, 0.002, 0.001]),
        b: [para(0, 1.05), linear, curv(0, 30000, 65535)],
      }),
    }),
    colors,
    "1c0607 1c0608 1c060c 1f0a10 844e55 f8fff2 f9fff4 f70000 00ff00 001dcd ba2100 00a878 4b1f9a e3bd00",
    "190707 190708 19070c 1c0b10 7c5055 f9fff4 fafff5 e32e03 00ff2e 001cc4 aa3114 30a57b 452194 ddbf2d",
  ],
  [
    "mAB like that of XYB",
    profile({ A2B0: likeXyb }),
    colors,
    "001200 001200 001500 001c00 405d66 ff8cff ff8cff 130000 00ff09 00006e 350a01 00b696 000062 ff7e00",
    "001000 001100 001300 001a01 465d65 ff9cfe ff9dff 100000 00ff4f 000069 300d04 00b296 00005e ff8730",
  ],
];

describe("imageData() converts from the profile", () => {
  test.each(known)("%s", async (_, icc, from, srgb, displayP3) => {
    expect(far(await convert(rgbaOf(from), icc), rgbaOf(srgb))).toEqual([]);
    expect(far(await convert(rgbaOf(from), icc, "display-p3"), rgbaOf(displayP3))).toEqual([]);
  });

  test("A2B0 comes before A2B1 and before the matrix", async () => {
    const swapped = (order: number[]) =>
      mAB({ m: three(srgbCurve), matrix: matrixOf(order.map(i => SRGB[i])), b: three(linear) });
    const [rXYZ, gXYZ, bXYZ] = SRGB.map(icc.xyz);
    const matrix = { rXYZ, gXYZ, bXYZ, rTRC: srgbCurve, gTRC: srgbCurve, bTRC: srgbCurve };
    const all = profile({ ...matrix, A2B1: swapped([2, 1, 0]), A2B0: swapped([1, 0, 2]) });
    expect(far(await convert([200, 100, 50, 255], all), [100, 200, 50, 255])).toEqual([]);
  });

  test.each(["jpeg", "png", "webp"] as const)("of a %s, after the other operations", async format => {
    const swapped = rgbProfile([SRGB[1], SRGB[0], SRGB[2]], three(srgbCurve));
    const source = pngWithProfile(Array(16).fill([200, 100, 50, 255]).flat(), swapped);
    const file = await new Bun.Image(source)[format]({ quality: 100 }).bytes();
    const { data } = await new Bun.Image(file).rotate(90).resize(1, 4).imageData();
    expect(far([...data], Array(4).fill([100, 200, 50, 255]).flat(), 3)).toEqual([]);
  });
});

const everyLevel = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) & 255, i]).flat();
const everyGray = Array.from({ length: 256 }, (_, i) => [i, i, i, 255]).flat();

describe("the pixels are left alone", () => {
  test.each<[string, Buffer, ColorSpace]>([
    ["sRGB with a function", rgbProfile(SRGB, three(srgbCurve)), "srgb"],
    ["sRGB with 1024 points", rgbProfile(SRGB, three(sampledCurve(1024, srgbToLight))), "srgb"],
    [
      // Of the profile that Facebook puts in its JPEG files.
      "sRGB with 26 points",
      rgbProfile(
        SRGB,
        three(
          // prettier-ignore
          curv(0, 203, 457, 867, 1426, 2155, 3062, 4159, 5457, 6964, 8689, 10640, 12824, 15250, 17925, 20855, 24045, 27504, 31237, 35249, 39548, 44137, 49021, 54211, 59696, 65535),
        ),
      ),
      "srgb",
    ],
    ["linear sRGB", rgbProfile(SRGB, three(linear)), "srgb-linear"],
    ["Display P3", rgbProfile(P3, three(srgbCurve)), "display-p3"],
    ["linear Display P3", rgbProfile(P3, three(para(0, 1))), "display-p3-linear"],
  ])("if they are %s already", async (_, icc, colorSpace) => {
    expect(await convert(everyLevel, icc, colorSpace)).toEqual(everyLevel);
  });

  const p3 = rgbProfile(P3, three(srgbCurve));
  const changed = (icc: Buffer, at: number, ...bytes: number[]) =>
    Buffer.from(icc).fill(Buffer.of(...bytes), at, at + bytes.length);
  const [rXYZ, gXYZ, bXYZ] = P3.map(icc.xyz);
  const table = (stages: Partial<Parameters<typeof mAB>[0]>) => profile({ A2B0: mAB({ b: three(linear), ...stages }) });
  /** The tag comes last. */
  const inTag = (tag: Buffer, at: number, ...bytes: number[]) => profile({ A2B0: changed(tag, at, ...bytes) });
  test.each<[string, Buffer]>([
    ["is something else", Buffer.from("not a profile")],
    ["lacks the signature", changed(p3, 36, 0)],
    ["is of version 5", changed(p3, 8, 5)],
    ["is for CMYK", changed(p3, 16, ...Buffer.from("CMYK"))],
    ["is for gray, and they are not", profile({ kTRC: linear }, { space: "GRAY" })],
    ["leads to neither XYZ nor Lab", changed(p3, 20, ...Buffer.from("RGB "))],
    ["has more tags than room for them", changed(p3, 128, 255, 255, 255, 255)],
    ["lacks a curve", profile({ rXYZ, gXYZ, bXYZ, rTRC: linear, gTRC: linear })],
    ["lacks a colorant", profile({ rXYZ, gXYZ, rTRC: linear, gTRC: linear, bTRC: linear })],
    ["has a curve for a colorant", profile({ rXYZ, gXYZ, bXYZ: srgbCurve, rTRC: linear, gTRC: linear, bTRC: linear })],
    ["has a colorant for a curve", rgbProfile(P3, [linear, linear, rXYZ])],
    ["has an unknown function", rgbProfile(P3, three(para(5, 1, 1, 1, 1, 1, 1, 1)))],
    ["has too few parameters", rgbProfile(P3, three(para(3, 2.4, 1, 0, 1)))],
    ["divides by zero in type 1", rgbProfile(P3, three(para(1, 2, 0, 1)))],
    ["divides by zero in type 2", rgbProfile(P3, three(para(2, 2, 0, 0, 0)))],
    ["has a curve that is longer than its tag", rgbProfile(P3, three(changed(curv(0, 65535), 8, 255, 255, 255, 255)))],
    ["has an unknown kind of table", inTag(likeXyb, 0, ...Buffer.from("mBA "))],
    ["has a table with 4 inputs", inTag(likeXyb, 8, 4)],
    ["has a table with 4 outputs", inTag(likeXyb, 9, 4)],
    ...[12, 16, 20, 24, 28].map((at): [string, Buffer] => [
      `has an offset at ${at} that leaves the tag`,
      inTag(likeXyb, at, 255, 255, 255, 255),
    ]),
    ["has two curves for three channels", table({ b: [linear, linear] })],
    ["has an axis of one point", table({ clut: [[2, 1, 2], 1, () => [0, 0, 0]] })],
    ["has an axis of no points", table({ clut: [[2, 2, 0], 1, () => [0, 0, 0]] })],
    ["has samples of 3 bytes", table({ clut: [[2, 2, 2], 3, () => [0, 0, 0, 0, 0, 0]] })],
    ["has a mft1 of one point", inTag(mft(1, 2, p3ToLab), 10, 1)],
    ["has a mft1 of 255 points without room", inTag(mft(1, 2, p3ToLab), 10, 255)],
    ["has a mft2 with input curves of one point", inTag(mft(2, 2, p3ToLab), 48, 0, 1)],
    ["has a mft2 with output curves of one point", inTag(mft(2, 2, p3ToLab), 50, 0, 1)],
  ])("if the profile %s", async (_, icc) => {
    expect(await convert(everyLevel, icc)).toEqual(everyLevel);
    // They count as sRGB.
    expect(await convert([255, 0, 0, 9], icc, "display-p3")).toEqual([234, 51, 35, 9]);
  });

  const below = (end: number) => Array.from({ length: end }, (_, i) => i);

  test("if the profile is cut short", async () => {
    const rgba = rgbaOf(colors);
    const results = await Promise.all(below(p3.length).map(length => convert(rgba, p3.subarray(0, length || 1))));
    expect(results).toEqual(Array(p3.length).fill(rgba));
  });

  test.each(known.filter(([, icc]) => icc.length < 1000))(
    "if the last tag of %s is cut short",
    async (_, icc, from) => {
      const rgba = rgbaOf(from);
      const entry = 120 + 12 * icc.readUInt32BE(128);
      const [start, size] = [icc.readUInt32BE(entry + 4), icc.readUInt32BE(entry + 8)];
      const cut = (length: number) => changed(icc.subarray(0, start + length), entry + 10, length >> 8, length);
      // The last two bytes can be padding.
      const results = await Promise.all(below(size - 2).map(length => convert(rgba, cut(length))));
      expect(results).toEqual(Array(size - 2).fill(rgba));
    },
  );
});

test("gAMA, cHRM and cICP of a PNG do not count", async () => {
  const plain = pngWithProfile(everyLevel, Buffer.from("not a profile"));
  const file = Buffer.concat([
    plain.subarray(0, 33),
    chunk("gAMA", Buffer.from("000186a0", "hex")),
    chunk("cHRM", Buffer.from("00007a2600008084000109a000007d000000678400010d8800003a9800001770", "hex")),
    chunk("cICP", [12, 13, 0, 1]),
    plain.subarray(33),
  ]);
  expect([...(await new Bun.Image(file).imageData()).data]).toEqual(everyLevel);
});

test("a profile with any numbers in it gives pixels, with their alpha", async () => {
  const random = randomBytes(7);
  const extremes = [0x00, 0x01, 0x7f, 0x80, 0xff];
  const profiles = known.flatMap(([, icc]) =>
    Array.from({ length: 16 }, () => {
      const damaged = Buffer.from(icc);
      for (let i = 0; i < 3; i++) {
        // In the tags, most often where they start.
        const at = 128 + ((random() * 256 + random()) % Math.min(icc.length - 132, i ? 400 : Infinity));
        damaged.fill(extremes[random() % extremes.length], at, at + 1 + (random() % 4));
      }
      return damaged;
    }),
  );
  const rgba = rgbaOf(colors);
  const alphas = (pixels: number[]) => pixels.filter((_, i) => i % 4 === 3);
  const results = await Promise.all(profiles.map(icc => convert(rgba, icc, "display-p3-linear")));
  expect(new Set(results.map(it => alphas(it).join()))).toEqual(new Set([alphas(rgba).join()]));
});

const spaces = ["srgb", "srgb-linear", "display-p3", "display-p3-linear"] as const;

describe.each(spaces)("pixels in %s", from => {
  const source = (rgba: number[]) =>
    new ImageData(new Uint8ClampedArray(rgba), rgba.length / 4, 1, { colorSpace: from });

  // https://drafts.csswg.org/css-color-4/#color-conversion-code
  test.each(spaces)("to %s", async to => {
    const srgbToP3 = [
      [0.822461969, 0.177538031, 0],
      [0.033194199, 0.966805801, 0],
      [0.017082631, 0.072397441, 0.910519929],
    ];
    const p3ToSrgb = [
      [1.224940176, -0.224940176, 0],
      [-0.042056955, 1.042056955, 0],
      [-0.019637555, -0.078636046, 1.0982736],
    ];
    const fromLight = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
    const expected = Array.from({ length: 256 }, (_, i) => {
      const [r, g, b, alpha] = everyLevel.slice(4 * i, 4 * i + 4);
      let light = [r, g, b].map(it => (from.endsWith("linear") ? it / 255 : srgbToLight(it / 255)));
      if (from[0] !== to[0]) {
        light = (to[0] === "d" ? srgbToP3 : p3ToSrgb).map(row => row.reduce((sum, it, k) => sum + it * light[k], 0));
      }
      light = light.map(it => Math.min(1, Math.max(0, it)));
      return [...light.map(it => Math.round(255 * (to.endsWith("linear") ? it : fromLight(it)))), alpha];
    }).flat();

    const result = await new Bun.Image(source(everyLevel)).imageData({ colorSpace: to });
    expect(result.colorSpace).toBe(to);
    expect(far([...result.data], expected, from === to ? 0 : 1)).toEqual([]);
    expect(await new Bun.Image(source(everyLevel)).imageData(new ImageData(256, 1, { colorSpace: to }))).toEqual(
      result,
    );

    const { data } = await new Bun.Image(source(everyGray)).imageData({ colorSpace: to });
    expect(everyGray.filter((_, i) => i % 4 === 0 && (data[i] !== data[i + 1] || data[i] !== data[i + 2]))).toEqual([]);
  });

  test("are encoded as they are, with a profile that brings them back", async () => {
    const opaque = everyLevel.map((it, i) => (i % 4 === 3 ? 255 : it));
    for (const file of [
      await new Bun.Image(source(opaque)).png().bytes(),
      await new Bun.Image(source(opaque)).png({ palette: true }).bytes(),
      await new Bun.Image(source(opaque)).webp({ lossless: true }).bytes(),
    ]) {
      const { lines, profile } = await decoded(file);
      expect([...lines.subarray(1)]).toEqual(opaque);
      expect(profile && Bun.SHA256.hash(profile, "hex").slice(0, 16)).toBe(
        {
          "srgb": undefined,
          "srgb-linear": "11d410328b0b687b",
          "display-p3": "caa8e8ca1072ace9",
          "display-p3-linear": "41bda5ec43992d90",
        }[from],
      );
      expect(await new Bun.Image(file).imageData({ colorSpace: from })).toEqual(source(opaque));
    }
    const flat = Array(16).fill([200, 100, 50, 255]).flat();
    for (const format of ["jpeg", "webp"] as const) {
      const file = await new Bun.Image(source(flat))[format]({ quality: 100 }).bytes();
      expect(far([...(await new Bun.Image(file).imageData({ colorSpace: from })).data], flat, 2)).toEqual([]);
    }
  });

  test.skipIf(!isMacOS)("are converted for a HEIC, which Bun gives no profile", async () => {
    const flat = new ImageData(64, 64, { colorSpace: from });
    for (let i = 0; i < flat.data.length; i += 4) flat.data.set([200, 100, 50, 255], i);
    const heic = await new Bun.Image(flat).heic({ quality: 100 }).bytes();
    const [actual, expected] = await Promise.all([heic, flat].map(it => new Bun.Image(it).resize(1, 1).imageData()));
    expect(far([...actual.data], [...expected.data], 4)).toEqual([]);
  });

  test("are converted for a placeholder, which has no profile", async () => {
    const flat = source(Array(16).fill([200, 100, 50, 255]).flat());
    const inSrgb = await new Bun.Image(flat).imageData();
    expect(await new Bun.Image(flat).placeholder()).toBe(await new Bun.Image(inSrgb).placeholder());
  });
});
