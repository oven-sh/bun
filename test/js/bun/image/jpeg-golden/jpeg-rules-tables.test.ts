// The rules for tables, for what says what the colors are, and for the color profile.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import {
  bothWays,
  bytes,
  decode,
  eights,
  expectPictures,
  fine,
  headerOnly,
  hex,
  levels,
  outcome,
  range,
  refused,
  where,
} from "./decode";
import { pictureOf, type Colors } from "./model";
import { before, behind, data, frame, gray, header, scan, scanned, steps } from "./one-block";
import {
  AC,
  adobe,
  all,
  APP0,
  APP14,
  APP2,
  as,
  coded,
  COM,
  DAC,
  DHT,
  dht,
  DQT,
  dqt,
  DRI,
  frameOf,
  headerOf,
  icc,
  jfif,
  jpeg,
  noise,
  optimalTable,
  scanOf,
  segment,
  sof,
  SOF0,
  SOF1,
  SOF2,
  SOF3,
  SOF9,
  sos,
  Symbols,
  tableOf,
  typical,
  write,
  type Frame,
  type HuffmanTable,
  type Scan,
} from "./write";

describe("DQT", () => {
  const twos = Array(64).fill(16);

  test("there are four tables, and any precision but 0 is 16 bits", async () => {
    const withFirst = (first: number) =>
      outcome(before(segment(DQT, [first, ...Array(first > 15 ? 128 : 64).fill(1)])));
    expect(await where(bytes, withFirst, hex)).toEqual({
      [fine]: hex(bytes.filter(first => (first & 15) < 4)),
      [refused]: hex(bytes.filter(first => (first & 15) >= 4)),
    });
    expect(await levels(jpeg(dqt(0, eights, true), frame, scan))).toEqual([[5]]);
    expect(await levels(jpeg(dqt(0, eights, true).with(4, 0xf0), frame, scan))).toEqual([[5]]);
  });

  test("a segment holds whole tables", async () => {
    const two = Buffer.concat([dqt(1, twos, true).subarray(4), steps.subarray(4)]);
    expect(await levels(jpeg(segment(DQT, two), frame, scan))).toEqual([[5]]);
    const lengths = range(0, 2 + two.length + 3);
    // Zeros to follow, which are a table 0 where they are taken for one, and else stray bytes.
    const saying = (length: number) => outcome(before(segment(DQT, two, length), Buffer.alloc(70)));
    expect((await where(lengths, saying))[fine]).toEqual([2, 2 + 129, 2 + 129 + 65]);
  });

  test("the values are in zigzag order, and as large as 16 bits in any kind of frame", async () => {
    const random = randomBytes(5);
    await expectPictures(
      [SOF0, SOF1, SOF9].flatMap(type =>
        [40, 400].map(most => {
          const table = Array.from({ length: 64 }, () => 1 + (((random() << 8) | random()) % most));
          const picture = frameOf(64, 64, "1x1", { type, tables: [table] });
          for (let k = 0; k < 64; k++) picture.components[0].data[k * 64 + k] = k & 1 ? -1 : 2;
          return { name: `${type}, up to ${most}`, file: write(picture), expected: pictureOf(picture) };
        }),
      ),
    );
    // Where there is nothing to multiply.
    expect(await levels(jpeg(dqt(0, [8, ...Array(63).fill(65535)]), frame, scan))).toEqual([[5]]);
  });

  test("0 is a value like any other", async () => {
    const picture = noise(frameOf(16, 16), randomBytes(6));
    picture.tables = [eights.map((_, k) => k % 2)];
    await expectPictures([{ name: "zeros", file: write(picture), expected: pictureOf(picture) }]);
  });

  test("a component has the table as it is when its first scan begins", async () => {
    expect(await levels(jpeg(dqt(0, twos), frame, steps, scan))).toEqual([[5]]);
    expect(await levels(behind(dqt(0, twos)))).toEqual([[5]]);

    const rgb = frameOf(8, 8, "1x1,1x1,1x1", { ids: [82, 71, 66] });
    for (const { data } of rgb.components) data[0] = 5;
    const of = (c: number) => scanned(rgb, scanOf([c]));
    const file = jpeg(sof(rgb), steps, of(0), dqt(0, twos), of(0), of(1), dqt(0, Array(64).fill(24)), of(2), of(1));
    expect([...(await decode(file)).rgba.subarray(0, 4)]).toEqual([133, 138, 143, 255]);
    // So it need not be there any sooner.
    rgb.components[1].table = 1;
    expect(await outcome(jpeg(sof(rgb), steps, of(0), dqt(1, twos), of(1)))).toBe(fine);
    expect(await outcome(jpeg(sof(rgb), steps, of(0), of(1), dqt(1, twos)))).toBe(headerOnly);
  });
});

describe("DHT", () => {
  const counts = (...some: number[]) => [...some, ...Array(16 - some.length).fill(0)];
  /** Not the typical ones: 0 for three bits, and 0 for the end of the block. */
  const [three, ends] = [tableOf([3], [1]), tableOf([0], [1])];
  const five = Buffer.from([0b0_101_0_111]);

  test("there are four tables of each class", async () => {
    expect((await where(bytes, number => outcome(before(dht(number, three)))))[fine]).toEqual([
      0, 1, 2, 3, 16, 17, 18, 19,
    ]);
    for (const [dc, ac] of [
      [0, 3],
      [1, 2],
      [2, 1],
      [3, 0],
    ]) {
      const selecting = sos(gray, scanOf([0], 0, 63, 0, 0, { dc: [dc], ac: [ac] }));
      expect(await levels(jpeg(steps, frame, dht(dc, three), dht(AC + ac, ends), selecting, five))).toEqual([[5]]);
    }
  });

  test("a segment holds whole tables", async () => {
    const two = Buffer.concat([dht(0, three).subarray(4), dht(AC, ends).subarray(4)]);
    expect(await levels(jpeg(steps, frame, segment(DHT, two), header, five))).toEqual([[5]]);
    // The zeros behind it make an empty table where 17 of them are taken.
    const saying = (length: number) => outcome(before(segment(DHT, two, length), Buffer.alloc(40), dht(0, typical[0])));
    expect((await where(range(0, 80), saying))[fine]).toEqual([2, 2 + 18, 2 + 36, 2 + 36 + 17, 2 + 36 + 34]);
  });

  test("a table has up to 256 codes", async () => {
    const withCount = (count: number) =>
      outcome(before(dht(3, { counts: [...counts().slice(2), 200, count - 200], symbols: Array(count).fill(0) })));
    expect(await where([255, 256, 257, 455], withCount)).toEqual({ [fine]: [255, 256], [refused]: [257, 455] });
  });

  test("the code that is all ones is not given out, in a table that a scan names", async () => {
    for (let length = 1; length <= 16; length++) {
      // One code of each length, which leaves room for two of the last.
      const table = (last: number) => {
        const lengths = [...range(1, length - 1), ...Array(last).fill(length)];
        return tableOf(
          lengths.map(() => 0),
          lengths,
        );
      };
      for (const number of [0, AC]) {
        expect([length, await where([1, 2, 3], last => outcome(before(dht(number, table(last)))))]).toEqual([
          length,
          { [fine]: [1], [headerOnly]: [2, 3] },
        ]);
      }
      expect(await outcome(before(dht(1, table(3)), dht(AC + 1, table(3))))).toBe(fine);
    }
    // Longer codes behind them change nothing.
    expect(await outcome(before(dht(0, { counts: counts(2, 0, 1), symbols: [0, 0, 0] })))).toBe(headerOnly);
  });

  /** Behind codes of these lengths, as many of `length` bits as there is room for. */
  function filledUp(lengths: number[], length: number) {
    const room = lengths.reduce((left, taken) => left - 2 ** (length - taken), 2 ** length - 1);
    return [...lengths, ...Array<number>(Math.min(room, 256 - lengths.length, 255)).fill(length)];
  }
  /** The codes of these lengths, and then what is none: the 16 bits that would be next, and all ones. */
  function codesOf(lengths: number[]) {
    let next = 0;
    const codes = lengths.map(length => {
      next += 1 << (16 - length);
      return (next >> (16 - length)) - 1;
    });
    return { codes, none: [next, 0xffff] };
  }
  const random = randomBytes(7);
  const lengthsIn = ({ counts }: HuffmanTable) => counts.flatMap((count, i) => Array<number>(count).fill(i + 1));

  describe.each([
    ["all of one length", range(1, 16).map(length => filledUp([], length))],
    ["from 1111 on", range(5, 16).map(length => filledUp([1, 2, 3, 4], length))],
    [
      "of one length on both sides of 1111",
      range(5, 16).map(length => filledUp([1, 2, 3, ...range(5, length - 1)], length)),
    ],
    ["16 bits behind each other length", range(1, 15).map(length => filledUp([...range(1, length - 1), length], 16))],
    ["in the typical tables", Object.values(typical).map(lengthsIn)],
    [
      "of many lengths",
      range(4, 15).map(spread => lengthsIn(optimalTable(bytes.map(() => 1 << (random() % (2 * spread)))))),
    ],
  ])("each code stands for its own symbol, and what is none for 0: %s", (_, spreads) => {
    test.each([
      ["few", (i: number) => i % 8],
      ["many", (i: number, length: number) => 15 - (i % Math.min(length, 8))],
    ])("with %s bits behind it", async (_, sizeOf) => {
      await expectPictures(
        spreads.map(lengths => {
          const { codes, none } = codesOf(lengths);
          const sizes = lengths.map((length, i) => sizeOf(i, length));
          // Zeros behind it for red, ones for green, and anything for blue.
          const picture = frameOf(codes.length + 3, 1, "1x1,1x1,1x1", { type: SOF3 });
          const rgba = Buffer.alloc(picture.width * 4, 255);
          const symbols = new Symbols();
          for (let x = 0; x < picture.width; x++) {
            // The first comes once more.
            const i = x === picture.width - 1 ? 0 : x;
            for (let c = 0; c < 3; c++) {
              let difference = 0;
              if (i < codes.length) {
                const ones = (1 << sizes[i]) - 1;
                const bits = ones & (c === 2 ? (random() << 8) | random() : -c);
                symbols.bits(codes[i], lengths[i]).bits(bits, sizes[i]);
                difference = 2 * bits > ones ? bits : bits - ones;
              } else symbols.bits(none[i - codes.length], 16).bits(c, 1);
              rgba[x * 4 + c] = (x ? rgba[x * 4 + c - 4] : 128) + difference;
            }
          }
          const named = sos(picture, scanOf([0, 1, 2], 1, 0, 0, 0, { dc: [0, 0, 0] }));
          const file = jpeg(sof(picture), dht(0, tableOf(sizes, lengths)), named, symbols.bytes({}));
          return { name: `${lengths}`, file, expected: { width: picture.width, height: 1, rgba } };
        }),
      );
    });

    test.each([
      ["sequential", SOF0],
      ["progressive", SOF2],
    ])("in a %s frame", async (_, type) => {
      await expectPictures(
        bothWays(
          spreads.map(lengths => {
            const { codes, none } = codesOf(lengths);
            const sizes = lengths.map((_, i) => 1 + (i % 7));
            const one = frameOf(8, 8, "1x1", { type, tables: [[8, ...Array(63).fill(0)]] });
            const width = codes.length + 3;
            const rgba = Buffer.alloc(width * 4, 255);
            const symbols = new Symbols();
            for (let x = 0, level = 0; x < width; x++) {
              const i = x === width - 1 ? 0 : x;
              if (i < codes.length) {
                const ones = (1 << sizes[i]) - 1;
                // Back towards the middle.
                const bits = ((random() & ones) >> 1) | (level < 0 ? (ones + 1) >> 1 : 0);
                symbols.bits(codes[i], lengths[i]).bits(bits, sizes[i]);
                level += level < 0 ? bits : bits - ones;
              } else symbols.bits(none[i - codes.length], 16).bits(x, 1);
              if (type === SOF0) symbols.bits(0, 1);
              rgba.fill(128 + level, x * 4, x * 4 + 3);
            }
            const file = jpeg(
              ...[headerOf({ ...one, width: width * 8 }), dht(0, tableOf(sizes, lengths)), dht(AC, ends)],
              ...[sos(one, scanOf([0], 0, type === SOF0 ? 63 : 0)), symbols.bytes({})],
            );
            return { name: `${lengths}`, file, expected: { width, height: 1, rgba }, eighths: 1 };
          }),
        ),
      );
    });
  });

  test("a difference has up to 15 bits, whether or not the code occurs", async () => {
    const withSymbol = (number: number) => (symbol: number) =>
      outcome(before(dht(number, tableOf([0, symbol], [1, 16]))));
    expect(await where(bytes, withSymbol(0))).toEqual({ [fine]: range(0, 15), [headerOnly]: range(16, 255) });
    expect(await where(bytes, withSymbol(AC))).toEqual({ [fine]: bytes });
  });

  test("the last definition in front of a scan counts", async () => {
    expect(await levels(jpeg(steps, frame, dht(0, ends), dht(0, three), dht(AC, ends), header, five))).toEqual([[5]]);
    // Nothing is left of a longer one: the second code is no code.
    const longer = dht(0, tableOf([3, 3], [1, 2]));
    expect(await levels(jpeg(steps, frame, longer, dht(AC, ends), header, [0b10_101_0_11]))).toEqual([[5]]);
    expect(await levels(jpeg(steps, frame, longer, dht(0, three), dht(AC, ends), header, [0b10_101_0_11]))).toEqual([
      [0],
    ]);

    const rgb = frameOf(8, 8, "1x1,1x1,1x1", { ids: [82, 71, 66], tables: [eights] });
    const of = (c: number) => sos(rgb, scanOf([c], 0, 63, 0, 0, { dc: [0], ac: [0] }));
    const file = jpeg(headerOf(rgb), of(0), data, dht(0, three), dht(AC, ends), of(1), five, of(2), five);
    expect([...(await decode(file)).rgba.subarray(0, 4)]).toEqual([133, 133, 133, 255]);
  });

  test("a sequential frame has the typical tables 0 and 1 where it defines none", async () => {
    // Every symbol that they have.
    const picture = frameOf(161 * 8, 8);
    const { data } = picture.components[0];
    for (let i = 0; i < 160; i++) data[i * 64 + 1 + (i % 16)] = (i & 1 ? -1 : 1) << Math.floor(i / 16);
    data[160 * 64 + 40] = 9;
    for (let size = 1; size <= 11; size++) data[size * 2 * 64] = 1 << (size - 1);
    const expected = pictureOf(picture);
    await expectPictures(
      [SOF0, SOF1].flatMap(type =>
        [0, 1].map(number => {
          const symbols = scanOf([0], 0, 63, 0, 0, { dc: [number], ac: [number] });
          return {
            name: `${type}, ${number}`,
            file: jpeg(headerOf(as(type, picture)), scanned(picture, symbols)),
            expected,
          };
        }),
      ),
    );
    const selecting = (both: number) => outcome(jpeg(steps, frame, header.with(6, both)));
    expect(await where(bytes, selecting, hex)).toEqual({
      [fine]: "00011011",
      [headerOnly]: hex(bytes.filter(both => both & 0xee)),
    });
    // One of them by itself.
    const [own, other] = [new Symbols().value(0, 0, 5).symbol(AC, 0), { 0: three, [AC]: ends }];
    for (const number of [0, AC]) {
      const mixed = own.bytes({ ...typical, [number]: other[number as 0] });
      expect(await levels(jpeg(steps, frame, dht(number, other[number as 0]), header, mixed))).toEqual([[5]]);
    }
  });

  test("so it has in the first of several scans, and in a later one", async () => {
    const color = frameOf(8, 8, "1x1,1x1,1x1");
    const named = (c: number, number: number) => sos(color, scanOf([c], 0, 63, 0, 0, { dc: [number], ac: [number] }));
    for (const earlier of [[], [named(0, 0)]]) {
      const of = (number: number) => outcome(jpeg(headerOf(color), ...earlier, named(1, number)));
      expect(await where(range(0, 4), of)).toEqual({ [fine]: [0, 1], [headerOnly]: [2, 3, 4] });
    }
  });

  test("a progressive frame has none, and needs only what the scan has codes for", async () => {
    const start = headerOf(as(SOF2, gray));
    const only = (number: number, scan: Scan) => async (both: number) =>
      outcome(jpeg(start, dht(number, ends), sos(gray, scan).with(6, both)));
    const some = [0x00, 0x01, 0x02, 0x04, 0x0f, 0x10, 0x20, 0x22, 0x40, 0xf0, 0xf2, 0x2f, 0xff];
    expect((await where(some, only(2, scanOf([0], 0, 0))))[fine]).toEqual([0x20, 0x22, 0x2f]);
    expect(await where(some, only(AC + 2, scanOf([0], 0, 0)))).toEqual({ [headerOnly]: some });
    expect(await where(some, only(2, scanOf([0], 0, 0, 1, 0)))).toEqual({ [fine]: some });
    for (const ah of [0, 1]) {
      expect((await where(some, only(AC + 2, scanOf([0], 1, 63, ah, 0))))[fine]).toEqual([0x02, 0x22, 0xf2]);
      expect(await where(some, only(2, scanOf([0], 1, 63, ah, 0)))).toEqual({ [headerOnly]: some });
    }
  });
});

describe("DRI and DAC", () => {
  test("DRI has two bytes", async () => {
    expect(await where(range(0, 6), length => outcome(before(segment(DRI, [0, 0, 0, 0], length))))).toEqual({
      [refused]: [0, 1, 2, 3, 5, 6],
      [fine]: [4],
    });
  });

  // In a file with Huffman codes, too.
  test("DAC has pairs, for 16 tables of each class", async () => {
    expect(await where(bytes, number => outcome(before(segment(DAC, [number, 0]))))).toEqual({
      [fine]: range(0, 31),
      [refused]: range(32, 255),
    });
    expect(await where(range(2, 8), length => outcome(before(segment(DAC, Buffer.alloc(8), length))))).toEqual({
      [fine]: [2, 4, 6, 8],
      [refused]: [3, 5, 7],
    });
    expect(await outcome(before(segment(DAC, [0, 0, 32, 0])))).toBe(refused);
  });

  test("the lower bound in DAC is not above the upper", async () => {
    expect(await where(bytes, value => outcome(before(segment(DAC, [15, value]))), hex)).toEqual({
      [fine]: hex(bytes.filter(value => (value & 15) <= value >> 4)),
      [refused]: hex(bytes.filter(value => (value & 15) > value >> 4)),
    });
    expect(await where(bytes, value => outcome(before(segment(DAC, [16, value]))))).toEqual({ [fine]: bytes });
  });
});

describe("what the components stand for", () => {
  const made = (count: number, ids?: number[]) =>
    noise(frameOf(8, 8, Array(count).fill("1x1").join(), { ids }), randomBytes(7));
  const [three, four] = [made(3), made(4)];
  const pictures = Object.fromEntries(
    (["YCbCr", "RGB", "CMYK", "YCCK"] as Colors[]).map(colors => [
      pictureOf(colors.length === 4 ? four : three, { colors }).rgba.toString("hex"),
      colors,
    ]),
  );
  const scans = new Map(
    [three, four].map(made => {
      const { data } = coded(made, scanOf(all(made)), typical);
      return [all(made).length, (frame: Frame) => [sos(frame, scanOf(all(frame))), data]];
    }),
  );
  const seen = async (file: Buffer) => pictures[(await decode(file)).rgba.toString("hex")];
  const takenFor = (frame: Frame, ...before: Buffer[]) =>
    seen(jpeg(...before, headerOf(frame), ...scans.get(all(frame).length)!(frame)));
  const rgb = made(3, [82, 71, 66]);

  test("three are YCbCr, unless they are named R, G and B", async () => {
    const names = ["RGB", "\x01\x02\x03", "\0\x01\x02", "rgb", "BGR", "xGB", "RxB", "RGx", "\x01\x02x", "\x01x\x03"];
    expect(await where(names, ids => takenFor(made(3, [...Buffer.from(ids)])))).toEqual({
      RGB: names.slice(0, 1),
      YCbCr: names.slice(1),
    });
  });

  test("Adobe's marker comes before the names", async () => {
    for (const frame of [three, rgb]) {
      expect(await where(bytes, transform => takenFor(frame, adobe(transform)))).toEqual({
        RGB: [0],
        YCbCr: range(1, 255),
      });
    }
  });

  test("JFIF comes before both", async () => {
    expect(await takenFor(rgb, jfif)).toBe("YCbCr");
    expect(await takenFor(rgb, jfif, adobe(0))).toBe("YCbCr");
    expect(await takenFor(rgb, adobe(0), jfif)).toBe("YCbCr");
  });

  test("four are CMYK, unless Adobe's marker says that they are transformed", async () => {
    expect(await takenFor(four)).toBe("CMYK");
    expect(await takenFor(four, jfif)).toBe("CMYK");
    expect(await takenFor(four, jfif, adobe(2))).toBe("YCCK");
    expect(await where(bytes, transform => takenFor(four, adobe(transform)))).toEqual({
      CMYK: [0],
      YCCK: range(1, 255),
    });
  });

  test("one is gray, whatever is said", async () => {
    for (const said of [jfif, adobe(0), adobe(1), adobe(2)]) expect(await levels(before(said))).toEqual([[5]]);
  });

  test("JFIF is an APP0 of 14 bytes or more with that name, in any version", async () => {
    const body = Buffer.concat([jfif.subarray(4), Buffer.alloc(4)]);
    expect(await where(range(0, 18), length => takenFor(rgb, segment(APP0, body.subarray(0, length))))).toEqual({
      RGB: range(0, 13),
      YCbCr: range(14, 18),
    });
    expect(await where(range(0, 13), at => takenFor(rgb, segment(APP0, body.with(at, 0x77))))).toEqual({
      RGB: range(0, 4),
      YCbCr: range(5, 13),
    });
    for (const extension of [0x10, 0x11, 0x13, 0x14]) {
      expect(await takenFor(rgb, segment(APP0, [...Buffer.from("JFXX\0"), extension, ...Array(8).fill(0)]))).toBe(
        "RGB",
      );
    }
    expect(await takenFor(rgb, segment(APP14, body))).toBe("RGB");
    // Another APP0 does not undo it.
    expect(await takenFor(rgb, jfif, segment(APP0, "AVI1"))).toBe("YCbCr");
  });

  test("Adobe's marker is an APP14 of 12 bytes or more with that name, and the last one counts", async () => {
    const body = Buffer.concat([adobe(0).subarray(4), Buffer.alloc(4, 1)]);
    expect(await where(range(0, 16), length => takenFor(three, segment(APP14, body.subarray(0, length))))).toEqual({
      YCbCr: range(0, 11),
      RGB: range(12, 16),
    });
    expect(await where(range(0, 15), at => takenFor(three, segment(APP14, body.with(at, 0x77))))).toEqual({
      YCbCr: [0, 1, 2, 3, 4, 11],
      RGB: [5, 6, 7, 8, 9, 10, 12, 13, 14, 15],
    });
    expect(await takenFor(three, segment(APP0, body))).toBe("YCbCr");
    expect(await takenFor(three, adobe(1), adobe(0))).toBe("RGB");
    expect(await takenFor(three, adobe(0), adobe(1))).toBe("YCbCr");
    expect(await takenFor(three, adobe(0), segment(APP14, "other"))).toBe("RGB");
  });

  test("they count up to the first scan", async () => {
    const around = (frame: Frame, first: Buffer[], later: Buffer[]) => {
      const [one, ...others] = all(frame).map(c => scanned(frame, scanOf([c])));
      return seen(jpeg(headerOf(frame), ...first, one, ...later, ...others));
    };
    expect(await around(rgb, [jfif], [])).toBe("YCbCr");
    expect(await around(rgb, [], [jfif])).toBe("RGB");
    expect(await around(three, [adobe(0)], [adobe(1)])).toBe("RGB");
    expect(await around(four, [], [adobe(2)])).toBe("CMYK");
  });
});

describe("the color profile", () => {
  const profile = async (...parts: Buffer[]) => {
    const file = before(...parts);
    expect(await levels(file)).toEqual([[5]]);
    return (await decode(file)).profile;
  };

  test("is put together by the numbers of its parts", async () => {
    expect(await profile()).toBe(null);
    expect(await profile(icc(1, 1, "a"))).toBe("a");
    expect(await profile(icc(1, 3, "ab"), icc(2, 3, "c"), icc(3, 3, "def"))).toBe("abcdef");
    expect(await profile(icc(3, 3, "def"), jfif, icc(1, 3, "ab"), segment(COM), icc(2, 3, "c"))).toBe("abcdef");
    expect(await profile(icc(1, 3, ""), icc(2, 3, "c"), icc(3, 3, ""))).toBe("c");
    const parts = range(1, 255).map(number => icc(256 - number, 255, [256 - number]));
    expect(await profile(...parts)).toBe(Buffer.from(range(1, 255)).toString("latin1"));
    const longest = Buffer.alloc(65519, "profile").toString();
    expect((await profile(icc(2, 2, longest), icc(1, 2, longest))) === longest + longest).toBe(true);
  });

  test.each([
    ["the first part is missing", [icc(2, 2, "b")]],
    ["the last part is missing", [icc(1, 2, "a")]],
    ["a part in the middle is missing", [icc(1, 3, "a"), icc(3, 3, "c")]],
    ["a part comes twice", [icc(1, 1, "a"), icc(1, 1, "a")]],
    ["a part comes twice, and another not at all", [icc(1, 2, "a"), icc(1, 2, "b")]],
    ["a part has the number 0", [icc(0, 1, "a"), icc(1, 1, "b")]],
    ["a part has too high a number", [icc(1, 1, "a"), icc(2, 1, "b")]],
    ["there are no parts, it says", [icc(1, 0, "a")]],
    ["there are no parts, the first says", [icc(0, 0, "a"), icc(1, 1, "b")]],
    ["a part counts more parts", [icc(1, 2, "a"), icc(2, 3, "b")]],
    ["a part counts fewer parts", [icc(2, 2, "b"), icc(1, 1, "a")]],
    ["an empty part is at fault", [icc(1, 1, "a"), icc(9, 9, "")]],
    ["one more follows 255 parts", [...range(1, 255).map(number => icc(number, 255, "a")), icc(1, 255, "a")]],
    ["many more follow", Array(300).fill(icc(1, 1, "a"))],
    ["all parts are empty", [icc(1, 2, ""), icc(2, 2, "")]],
  ])("is lost, and the picture is not, if %s", async (_, parts) => {
    expect(await profile(...parts)).toBe(null);
  });

  test("a part is an APP2 of 14 bytes or more with that name, and others are passed over", async () => {
    const wrong = icc(9, 9, "x").subarray(4);
    const beside = (other: Buffer) => profile(other, icc(1, 1, "a"), other).then(String);
    expect(await where(range(0, 15), length => beside(segment(APP2, wrong.subarray(0, length))))).toEqual({
      a: range(0, 13),
      null: [14, 15],
    });
    expect(await where(range(0, 11), at => beside(segment(APP2, wrong.with(at, 0x77))))).toEqual({ a: range(0, 11) });
    expect(await where([...range(APP0, APP0 + 15), COM], code => beside(segment(code, wrong)))).toEqual({
      a: [APP0, APP0 + 1, ...range(APP0 + 3, APP0 + 15), COM],
      null: [APP2],
    });
  });

  test("counts up to the first scan", async () => {
    expect((await decode(jpeg(steps, frame, icc(1, 1, "a"), scan))).profile).toBe("a");
    expect((await decode(behind(icc(1, 1, "a")))).profile).toBe(null);
    expect((await decode(jpeg(icc(1, 1, "a"), steps, frame, scan, icc(1, 1, "b")))).profile).toBe("a");
    expect((await decode(jpeg(icc(1, 2, "a"), steps, frame, scan, icc(2, 2, "b")))).profile).toBe(null);
  });

  test("is kept for any colors but inks", async () => {
    const kept = async (sampling: string, transform: number, type = SOF0) =>
      (
        await decode(
          write(frameOf(8, 8, sampling, { type }), undefined, { before: [adobe(transform), icc(1, 1, "a")] }),
        )
      ).profile;
    const [three, four] = ["1x1,1x1,1x1", "1x1,1x1,1x1,1x1"];
    expect([await kept(three, 0), await kept(three, 1), await kept(three, 0, SOF3)]).toEqual(["a", "a", "a"]);
    expect([await kept(four, 0), await kept(four, 2), await kept(four, 0, SOF3)]).toEqual([null, null, null]);
  });
});
