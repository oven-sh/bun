// What a valid PNG file may hold besides the picture. None of it changes a pixel, and of all of it only the color
// profile is kept. See png-valid.test.ts.
import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import { make, maker, mistakes, type Case } from "./check";
import {
  channelsOf,
  chunk,
  formats,
  GRAY,
  GRAY_ALPHA,
  INDEXED,
  noise,
  iccp as profileChunk,
  randomBytes,
  RGB,
  RGBA,
  type Layout,
} from "./write";

const u32 = (...values: number[]) =>
  Buffer.from(values.flatMap(value => [value >>> 24, value >>> 16, value >>> 8, value]));
const bytes = (...parts: (string | number[] | Uint8Array)[]) =>
  Buffer.concat(parts.map(part => (typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part))));

// One for each way the decoder reads rows, and the color types that bKGD and sBIT differ by.
const pictures = [
  ["RGBA, 8 bits", [RGBA, 8], false],
  ["RGB, 8 bits", [RGB, 8], false],
  ["indexed, 4 bits", [INDEXED, 4], false],
  ["gray, 16 bits, interlaced", [GRAY, 16], true],
  ["gray with alpha, 8 bits, interlaced", [GRAY_ALPHA, 8], true],
] as const;

const profile = Buffer.from(Array.from({ length: 700 }, randomBytes(8)));
const iccp = (name: string, data = profile, options?: zlib.ZlibOptions) =>
  profileChunk(name, data, options && (data => zlib.deflateSync(data, options)));

/** An Exif block that says which way up the picture is. That turns a JPEG. Not a PNG. */
const orientation = (way: number) => bytes("MM\0*", u32(8), [0, 1, 1, 18, 0, 3], u32(1), [0, way, 0, 0], u32(0));

/** The data of valid chunks that do not depend on the kind of image, by where they may be. */
const anyImage = {
  beforePalette: {
    cHRM: [u32(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000)],
    gAMA: [u32(45455), u32(100000), u32(1), u32(0x7fffffff)],
    sRGB: [[0], [1], [2], [3]],
    cICP: [
      [1, 13, 0, 1],
      [9, 16, 0, 1],
      [9, 18, 0, 0],
    ],
    mDCV: [Buffer.alloc(24, 1)],
    cLLI: [u32(10000000, 2500000)],
  },
  beforeData: {
    pHYs: [bytes(u32(2835, 2835), [1]), bytes(u32(1, 2), [0])],
    sPLT: [bytes("name\0", [8]), bytes("name\0", [8, 1, 2, 3, 4, 0, 5]), bytes("name\0", [16], Buffer.alloc(20, 7))],
    oFFs: [bytes(u32(1, 0xffffffff), [1])],
    pCAL: [bytes("name\0", u32(0, 255), [0, 2], "unit\0", "0\0", "1")],
    sCAL: [bytes([1], "1.5\0", "2")],
    sTER: [[0], [1]],
  },
  anywhere: {
    tIME: [[7, 208, 2, 29, 23, 59, 60]],
    eXIf: [
      bytes("MM\0*", u32(8), [0, 0]),
      bytes("II*\0", [8, 0, 0, 0, 0, 0]),
      ...[2, 3, 4, 5, 6, 7, 8].map(orientation),
      bytes("II*\0", [8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]),
    ],
    tEXt: [
      bytes("Title\0", "text"),
      bytes("k\0"),
      bytes(Buffer.alloc(79, "k"), [0], "\xe9\xff"),
      bytes("a b\0", Buffer.alloc(70000, "x")),
    ],
    zTXt: [
      bytes("Comment\0\0", zlib.deflateSync("text")),
      bytes("k\0\0", zlib.deflateSync("")),
      bytes("k\0\0", zlib.deflateSync(Buffer.alloc(300000, "x"))),
    ],
    iTXt: [
      bytes("Title\0\0\0\0\0", "text"),
      bytes("Title\0\0\0en-GB\0", Buffer.from("Títle\0téxt")),
      bytes("Title\0\x01\0de\0\0", zlib.deflateSync(Buffer.from("téxt"))),
      bytes("k\0\0\0\0\0"),
      bytes("k\0\x01\0", Buffer.alloc(200, "x"), [0], Buffer.alloc(200, "y"), [0], zlib.deflateSync("text")),
    ],
    gIFg: [[1, 0, 0, 10]],
    gIFx: [bytes("NETSCAPE2.0", [1, 0, 0])],
    // Nobody knows these: public and private, safe to copy and not, empty and not.
    abCd: [[], "anything"],
    abCD: [[1, 2, 3]],
    aBCd: [[]],
    aBCD: [Buffer.alloc(100000, 9)],
    // What programs really write: macOS screenshots, content credentials, Android, ImageMagick, Fireworks and others.
    iDOT: [u32(2, 0, 3, 40, 3, 3, 100)],
    caBX: [Buffer.alloc(200000, 5)],
    npTc: [Buffer.alloc(84, 1)],
    vpAg: [bytes(u32(9, 6), [0])],
    caNv: [u32(9, 6, 0, 0)],
    orNT: [[1]],
    prVW: [Buffer.alloc(3000, 2)],
    mkBS: [Buffer.alloc(50000, 3)],
    meTa: ["anything"],
    dSIG: [Buffer.alloc(64, 4)],
    gdAT: [Buffer.alloc(1000, 6)],
  },
};

type Chunks = Record<string, Buffer[]>;
const made = (group: Record<string, (string | number[] | Uint8Array)[]>): Chunks =>
  Object.fromEntries(Object.entries(group).map(([type, all]) => [type, all.map(data => chunk(type, data))]));
const [beforePalette, beforeData, anywhere] = [
  made(anyImage.beforePalette),
  made(anyImage.beforeData),
  made(anyImage.anywhere),
];

/** And those that do. */
function chunksFor(colorType: number, depth: number) {
  const significant = colorType === INDEXED ? 3 : channelsOf(colorType);
  const background = colorType === INDEXED ? [1] : Array(channelsOf(colorType) <= 2 ? 1 : 3).fill([0, 1]);
  return {
    beforePalette: {
      ...beforePalette,
      ...made({ sBIT: [Array(significant).fill(1), Array(significant).fill(Math.min(depth, 8))] }),
    },
    afterPalette: made({
      bKGD: [background.flat()],
      ...(colorType === INDEXED ? { hIST: [Buffer.alloc(32, 2)] } : {}),
    }),
  };
}

describe.each(pictures)("%s", (_, format, interlaced) => {
  const withChunks = maker(noise(format, 9, 6, randomBytes(9)), { interlaced });
  const own = chunksFor(...format);

  test("each chunk wherever it may be", async () => {
    const places: [Chunks, (keyof Layout)[]][] = [
      [own.beforePalette, ["beforePalette"]],
      [own.afterPalette, ["beforeData"]],
      [beforeData, ["beforePalette", "beforeData"]],
      [anywhere, ["beforePalette", "beforeData", "afterData"]],
    ];
    const cases: Case[] = [];
    for (const [group, where] of places) {
      for (const [type, all] of Object.entries(group)) {
        for (const [i, one] of all.entries()) {
          for (const place of where) cases.push(withChunks(`${type} ${i} ${place}`, { [place]: [one] }));
        }
      }
    }
    expect(await mistakes(cases)).toEqual([]);
  });

  test("all of them at once", async () => {
    const first = (group: Chunks, except?: string) =>
      Object.entries(group).flatMap(([type, all]) => (type === except ? [] : [all[0]]));
    const { tIME, eXIf, ...others } = anywhere;
    const repeatable = Object.values(others).flat();
    // sRGB and iCCP exclude each other.
    const layout = (colorSpace: Buffer): Layout => ({
      beforePalette: [...first(own.beforePalette, "sRGB"), colorSpace, ...repeatable],
      beforeData: [...first(own.afterPalette), ...first(beforeData), tIME[0], ...repeatable],
      afterData: [...repeatable, eXIf[0]],
    });
    const cases = [
      withChunks("with sRGB", layout(beforePalette.sRGB[0])),
      withChunks("with iCCP", layout(iccp("name")), profile),
    ];
    expect(await mistakes(cases)).toEqual([]);
  });
});

describe("iCCP", () => {
  test("any name, any size, however it is compressed", async () => {
    const withChunks = maker(noise([RGB, 8], 3, 2, randomBytes(11)));
    const withProfile = (name: string, chunk: Buffer, data = profile) =>
      withChunks(name, { beforePalette: [chunk] }, data);
    const latin1 = Array.from({ length: 256 }, (_, i) => i).filter(i => (i > 32 && i < 127) || i > 160);
    const cases = [
      ...[1, 2, 78, 79].map(length => withProfile(`a name of ${length}`, iccp(Buffer.alloc(length, "n").toString()))),
      // Every character a name may have, and spaces inside.
      ...[0, 79, 110].map(at =>
        withProfile(`characters from ${at}`, iccp(Buffer.from(latin1.slice(at, at + 79)).toString("latin1"))),
      ),
      withProfile("spaces", iccp("a b c")),
      ...[0, 1, 9].map(level => withProfile(`level ${level}`, iccp("name", profile, { level }))),
      ...[9, 15].map(windowBits => withProfile(`window ${windowBits}`, iccp("name", profile, { windowBits }))),
      ...[1, 2, 127, 128, 8191, 8192, 8193, 16384, 65536, 1_000_000].map(size => {
        const data = Buffer.alloc(size);
        const random = randomBytes(size);
        for (let i = 0; i < Math.min(size, 20000); i++) data[i] = random();
        return withProfile(`${size} bytes`, iccp("name", data), data);
      }),
    ];
    expect(latin1.length).toBe(189);
    expect(await mistakes(cases)).toEqual([]);
  });

  test("in every kind of image", async () => {
    const cases = formats.flatMap(format =>
      [false, true].map(interlaced =>
        make(
          `${format}, interlaced: ${interlaced}`,
          noise(format, 5, 4, randomBytes(21)),
          { interlaced, beforePalette: [iccp("name")] },
          profile,
        ),
      ),
    );
    expect(await mistakes(cases)).toEqual([]);
  });
});

test("1000 chunks of text", async () => {
  const text = Array.from({ length: 1000 }, (_, i) => chunk("tEXt", `key ${i}\0text`));
  const withChunks = maker(noise([RGBA, 8], 3, 2, randomBytes(12)));
  const cases = [
    withChunks("before", { beforeData: text }),
    withChunks("and after", { beforeData: text, afterData: text }),
  ];
  expect(await mistakes(cases)).toEqual([]);
});

// https://www.w3.org/TR/png-3/#apng-frame-based-animation
test("an animation is its static image", async () => {
  const withChunks = maker(noise([RGBA, 8], 4, 3, randomBytes(13)));
  const frame = (sequence: number, width = 4, height = 3, x = 0, y = 0) =>
    chunk("fcTL", bytes(u32(sequence, width, height, x, y), [0, 1, 0, 10, 0, 0]));
  const data = (sequence: number, width: number, height: number) =>
    chunk("fdAT", bytes(u32(sequence), zlib.deflateSync(Buffer.alloc(height * (1 + width * 4), 77))));
  const cases = [
    withChunks("the first frame", {
      beforeData: [chunk("acTL", u32(3, 0)), frame(0)],
      afterData: [frame(1), data(2, 4, 3), frame(3, 2, 1, 1, 1), data(4, 2, 1)],
    }),
    withChunks("not a frame", { beforeData: [chunk("acTL", u32(1, 5))], afterData: [frame(0), data(1, 4, 3)] }),
  ];
  expect(await mistakes(cases)).toEqual([]);
});

test("the color under an alpha of 0 stays, whatever the background", async () => {
  const cases = (
    [
      [GRAY_ALPHA, 8],
      [GRAY_ALPHA, 16],
      [RGBA, 8],
      [RGBA, 16],
    ] as const
  ).flatMap(format => {
    const picture = noise(format, 7, 5, randomBytes(19));
    const channels = channelsOf(format[0]);
    for (let i = channels - 1; i < picture.samples.length; i += channels) picture.samples[i] = 0;
    const beforeData = [
      chunk(
        "bKGD",
        Array(channels - 1)
          .fill([0, 200])
          .flat(),
      ),
    ];
    return [false, true].map(interlaced =>
      make(`${format}, interlaced: ${interlaced}`, picture, { interlaced, beforeData }),
    );
  });
  expect(await mistakes(cases)).toEqual([]);
});

// Not by the book, but files like this are around.
test("bytes after IEND", async () => {
  const whole = make("", noise([RGB, 8], 5, 4, randomBytes(22)));
  const cases = [Buffer.from([0]), Buffer.from("\n"), Buffer.alloc(100000, 1), whole.file].map((more, i) => ({
    ...whole,
    name: `${i}`,
    file: Buffer.concat([whole.file, more]),
  }));
  expect(await mistakes(cases)).toEqual([]);
});
