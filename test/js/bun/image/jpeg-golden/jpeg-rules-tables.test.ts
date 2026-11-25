// Table segments, the color space and the ICC profile.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import {
  alsoWithTrailer,
  bytes,
  decode,
  eights,
  expectPictures,
  fine,
  grouped,
  headerOnly,
  hex,
  levels,
  outcome,
  range,
  refused,
} from "./decode";
import { pictureOf, type Colors } from "./model";
import { after, before, data, frame, gray, header, quant, scan } from "./one-block";
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
  dcOnly,
  DHT,
  dht,
  DQT,
  dqt,
  DRI,
  EOB,
  frameOf,
  headerOf,
  icc,
  jfif,
  jpeg,
  noise,
  optimalTable,
  random16,
  rgbIds,
  scanOf,
  scanWithoutTables,
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
  const sixteens = Array(64).fill(16);

  test("Tq is 0 to 3, and any Pq but 0 means 16 bits", async () => {
    const withFirst = (first: number) =>
      outcome(before(segment(DQT, [first, ...Array(first > 15 ? 128 : 64).fill(1)])));
    expect(await grouped(bytes, withFirst, hex)).toEqual({
      [fine]: hex(bytes.filter(first => (first & 15) < 4)),
      [refused]: hex(bytes.filter(first => (first & 15) >= 4)),
    });
    expect(await levels(jpeg(dqt(0, eights, true), frame, scan))).toEqual([[5]]);
    expect(await levels(jpeg(dqt(0, eights, true).with(4, 0xf0), frame, scan))).toEqual([[5]]);
  });

  test("a segment holds whole tables", async () => {
    const two = Buffer.concat([dqt(1, sixteens, true).subarray(4), quant.subarray(4)]);
    expect(await levels(jpeg(segment(DQT, two), frame, scan))).toEqual([[5]]);
    const lengths = range(0, 2 + two.length + 3);
    // The zeros are stray bytes, unless the length covers them.
    const saying = (length: number) => outcome(before(segment(DQT, two, length), Buffer.alloc(70)));
    expect((await grouped(lengths, saying))[fine]).toEqual([2, 2 + 129, 2 + 129 + 65]);
  });

  test("the values are in zigzag order, and can have 16 bits in any kind of frame", async () => {
    const random = randomBytes(5);
    await expectPictures(
      [SOF0, SOF1, SOF9].flatMap(type =>
        [40, 400].map(most => {
          const table = Array.from({ length: 64 }, () => 1 + (random16(random) % most));
          const picture = frameOf(64, 64, "1x1", { type, tables: [table] });
          for (let k = 0; k < 64; k++) picture.components[0].data[k * 64 + k] = k & 1 ? -1 : 2;
          return { name: `${type}, up to ${most}`, file: write(picture), expected: pictureOf(picture) };
        }),
      ),
    );
    expect(await levels(jpeg(dqt(0, [8, ...Array(63).fill(65535)]), frame, scan))).toEqual([[5]]);
  });

  test("a value can be 0", async () => {
    const picture = noise(frameOf(16, 16), randomBytes(6));
    picture.tables = [eights.map((_, k) => k % 2)];
    await expectPictures([{ name: "zeros", file: write(picture), expected: pictureOf(picture) }]);
  });

  test("a component keeps the table that is defined when its first scan starts", async () => {
    expect(await levels(jpeg(dqt(0, sixteens), frame, quant, scan))).toEqual([[5]]);
    expect(await levels(after(dqt(0, sixteens)))).toEqual([[5]]);

    const rgb = frameOf(8, 8, "1x1,1x1,1x1", { ids: rgbIds });
    for (const { data } of rgb.components) data[0] = 5;
    const of = (c: number) => scanWithoutTables(rgb, scanOf([c]));
    const file = jpeg(sof(rgb), quant, of(0), dqt(0, sixteens), of(0), of(1), dqt(0, Array(64).fill(24)), of(2), of(1));
    expect([...(await decode(file)).rgba.subarray(0, 4)]).toEqual([133, 138, 143, 255]);
    // It need not be defined any sooner.
    rgb.components[1].table = 1;
    expect(await outcome(jpeg(sof(rgb), quant, of(0), dqt(1, sixteens), of(1)))).toBe(fine);
    expect(await outcome(jpeg(sof(rgb), quant, of(0), of(1), dqt(1, sixteens)))).toBe(headerOnly);
  });
});

describe("DHT", () => {
  const counts = (...some: number[]) => [...some, ...Array(16 - some.length).fill(0)];
  /** The code 0 is DC category 3, and EOB. */
  const [three, ends] = [tableOf([3], [1]), tableOf([EOB], [1])];
  const five = Buffer.from([0b0_101_0_111]);

  test("Tc is 0 or 1, and Th is 0 to 3", async () => {
    expect((await grouped(bytes, number => outcome(before(dht(number, three)))))[fine]).toEqual([
      0, 1, 2, 3, 16, 17, 18, 19,
    ]);
    for (const [dc, ac] of [
      [0, 3],
      [1, 2],
      [2, 1],
      [3, 0],
    ]) {
      const selecting = sos(gray, scanOf([0], 0, 63, 0, 0, { dc: [dc], ac: [ac] }));
      expect(await levels(jpeg(quant, frame, dht(dc, three), dht(AC + ac, ends), selecting, five))).toEqual([[5]]);
    }
  });

  test("a segment holds whole tables", async () => {
    const two = Buffer.concat([dht(0, three).subarray(4), dht(AC, ends).subarray(4)]);
    expect(await levels(jpeg(quant, frame, segment(DHT, two), header, five))).toEqual([[5]]);
    // Each 17 of the zeros after it are an empty table.
    const saying = (length: number) => outcome(before(segment(DHT, two, length), Buffer.alloc(40), dht(0, typical[0])));
    expect((await grouped(range(0, 80), saying))[fine]).toEqual([2, 2 + 18, 2 + 36, 2 + 36 + 17, 2 + 36 + 34]);
  });

  test("a table has up to 256 codes", async () => {
    const withCount = (count: number) =>
      outcome(before(dht(3, { counts: [...counts().slice(2), 200, count - 200], symbols: Array(count).fill(0) })));
    expect(await grouped([255, 256, 257, 455], withCount)).toEqual({ [fine]: [255, 256], [refused]: [257, 455] });
  });

  test("a table that a scan selects must not have the all-ones code", async () => {
    for (let length = 1; length <= 16; length++) {
      // One code of each shorter length leaves room for two.
      const table = (last: number) => {
        const lengths = [...range(1, length - 1), ...Array(last).fill(length)];
        return tableOf(
          lengths.map(() => 0),
          lengths,
        );
      };
      for (const number of [0, AC]) {
        expect([length, await grouped([1, 2, 3], last => outcome(before(dht(number, table(last)))))]).toEqual([
          length,
          { [fine]: [1], [headerOnly]: [2, 3] },
        ]);
      }
      expect(await outcome(before(dht(1, table(3)), dht(AC + 1, table(3))))).toBe(fine);
    }
    // Also if longer codes follow.
    expect(await outcome(before(dht(0, { counts: counts(2, 0, 1), symbols: [0, 0, 0] })))).toBe(headerOnly);
  });

  /** Adds as many codes of `length` bits as fit. */
  function filledUp(lengths: number[], length: number) {
    const room = lengths.reduce((left, taken) => left - 2 ** (length - taken), 2 ** length - 1);
    return [...lengths, ...Array<number>(Math.min(room, 256 - lengths.length, 255)).fill(length)];
  }
  /** The codes of these lengths, and two invalid ones: the first unused 16 bits, and all ones. */
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
    ["long ones start with 1111", range(5, 16).map(length => filledUp([1, 2, 3, 4], length))],
    [
      "one length on both sides of 1111",
      range(5, 16).map(length => filledUp([1, 2, 3, ...range(5, length - 1)], length)),
    ],
    ["16 bits after each other length", range(1, 15).map(length => filledUp([...range(1, length - 1), length], 16))],
    ["the tables of K.3", Object.values(typical).map(lengthsIn)],
    [
      "many lengths",
      range(4, 15).map(spread => lengthsIn(optimalTable(bytes.map(() => 1 << (random() % (2 * spread)))))),
    ],
  ])("each code decodes as its symbol, and an invalid one as 0: %s", (_, spreads) => {
    test.each([
      ["few", (i: number) => i % 8],
      ["many", (i: number, length: number) => 15 - (i % Math.min(length, 8))],
    ])("in a lossless frame, with %s extra bits", async (_, sizeOf) => {
      await expectPictures(
        spreads.map(lengths => {
          const { codes, none } = codesOf(lengths);
          const sizes = lengths.map((length, i) => sizeOf(i, length));
          // The extra bits are zeros for red, ones for green and random for blue.
          const picture = frameOf(codes.length + 3, 1, "1x1,1x1,1x1", { type: SOF3 });
          const rgba = Buffer.alloc(picture.width * 4, 255);
          const symbols = new Symbols();
          for (let x = 0; x < picture.width; x++) {
            // The first code again, to show that the invalid ones took 17 bits.
            const i = x === picture.width - 1 ? 0 : x;
            for (let c = 0; c < 3; c++) {
              let difference = 0;
              if (i < codes.length) {
                const ones = (1 << sizes[i]) - 1;
                const bits = ones & (c === 2 ? random16(random) : -c);
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
        alsoWithTrailer(
          spreads.map(lengths => {
            const { codes, none } = codesOf(lengths);
            const sizes = lengths.map((_, i) => 1 + (i % 7));
            const one = frameOf(8, 8, "1x1", { type, tables: [dcOnly(8)] });
            const width = codes.length + 3;
            const rgba = Buffer.alloc(width * 4, 255);
            const symbols = new Symbols();
            for (let x = 0, level = 0; x < width; x++) {
              const i = x === width - 1 ? 0 : x;
              if (i < codes.length) {
                const ones = (1 << sizes[i]) - 1;
                // Back towards 128.
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

  test("the symbols of a DC table are 0 to 15, whether or not they occur", async () => {
    const withSymbol = (number: number) => (symbol: number) =>
      outcome(before(dht(number, tableOf([0, symbol], [1, 16]))));
    expect(await grouped(bytes, withSymbol(0))).toEqual({ [fine]: range(0, 15), [headerOnly]: range(16, 255) });
    expect(await grouped(bytes, withSymbol(AC))).toEqual({ [fine]: bytes });
  });

  test("the last definition before a scan counts", async () => {
    expect(await levels(jpeg(quant, frame, dht(0, ends), dht(0, three), dht(AC, ends), header, five))).toEqual([[5]]);
    // Nothing remains of a longer table: its second code becomes invalid.
    const longer = dht(0, tableOf([3, 3], [1, 2]));
    expect(await levels(jpeg(quant, frame, longer, dht(AC, ends), header, [0b10_101_0_11]))).toEqual([[5]]);
    expect(await levels(jpeg(quant, frame, longer, dht(0, three), dht(AC, ends), header, [0b10_101_0_11]))).toEqual([
      [0],
    ]);

    const rgb = frameOf(8, 8, "1x1,1x1,1x1", { ids: rgbIds, tables: [eights] });
    const of = (c: number) => sos(rgb, scanOf([c], 0, 63, 0, 0, { dc: [0], ac: [0] }));
    const file = jpeg(headerOf(rgb), of(0), data, dht(0, three), dht(AC, ends), of(1), five, of(2), five);
    expect([...(await decode(file)).rgba.subarray(0, 4)]).toEqual([133, 133, 133, 255]);
  });

  test("in a sequential frame, tables 0 and 1 default to those of K.3", async () => {
    // All their symbols.
    const picture = frameOf(161 * 8, 8);
    const { data } = picture.components[0];
    for (let i = 0; i < 160; i++) data[i * 64 + 1 + (i % 16)] = (i & 1 ? -1 : 1) << Math.floor(i / 16);
    data[160 * 64 + 40] = 9;
    for (let size = 1; size <= 11; size++) data[size * 2 * 64] = 1 << (size - 1);
    const expected = pictureOf(picture);
    await expectPictures(
      [SOF0, SOF1].flatMap(type =>
        [0, 1].map(number => {
          const scan = scanWithoutTables(picture, scanOf([0], 0, 63, 0, 0, { dc: [number], ac: [number] }));
          return { name: `${type}, ${number}`, file: jpeg(headerOf(as(type, picture)), scan), expected };
        }),
      ),
    );
    const selecting = (both: number) => outcome(jpeg(quant, frame, header.with(6, both)));
    expect(await grouped(bytes, selecting, hex)).toEqual({
      [fine]: "00011011",
      [headerOnly]: hex(bytes.filter(both => both & 0xee)),
    });
    // With only one class defined.
    const [own, other] = [new Symbols().value(0, 0, 5).symbol(AC, EOB), { 0: three, [AC]: ends }];
    for (const number of [0, AC]) {
      const mixed = own.bytes({ ...typical, [number]: other[number as 0] });
      expect(await levels(jpeg(quant, frame, dht(number, other[number as 0]), header, mixed))).toEqual([[5]]);
    }
  });

  test("the defaults apply to each of several sequential scans", async () => {
    const color = frameOf(8, 8, "1x1,1x1,1x1");
    const named = (c: number, number: number) => sos(color, scanOf([c], 0, 63, 0, 0, { dc: [number], ac: [number] }));
    for (const earlier of [[], [named(0, 0)]]) {
      const of = (number: number) => outcome(jpeg(headerOf(color), ...earlier, named(1, number)));
      expect(await grouped(range(0, 4), of)).toEqual({ [fine]: [0, 1], [headerOnly]: [2, 3, 4] });
    }
  });

  test("a progressive scan has no defaults, and needs only the class of table that it uses", async () => {
    const start = headerOf(as(SOF2, gray));
    const only = (number: number, scan: Scan) => async (both: number) =>
      outcome(jpeg(start, dht(number, ends), sos(gray, scan).with(6, both)));
    const some = [0x00, 0x01, 0x02, 0x04, 0x0f, 0x10, 0x20, 0x22, 0x40, 0xf0, 0xf2, 0x2f, 0xff];
    expect((await grouped(some, only(2, scanOf([0], 0, 0))))[fine]).toEqual([0x20, 0x22, 0x2f]);
    expect(await grouped(some, only(AC + 2, scanOf([0], 0, 0)))).toEqual({ [headerOnly]: some });
    expect(await grouped(some, only(2, scanOf([0], 0, 0, 1, 0)))).toEqual({ [fine]: some });
    for (const ah of [0, 1]) {
      expect((await grouped(some, only(AC + 2, scanOf([0], 1, 63, ah, 0))))[fine]).toEqual([0x02, 0x22, 0xf2]);
      expect(await grouped(some, only(2, scanOf([0], 1, 63, ah, 0)))).toEqual({ [headerOnly]: some });
    }
  });
});

describe("DRI and DAC", () => {
  test("DRI has the length 4", async () => {
    expect(await grouped(range(0, 6), length => outcome(before(segment(DRI, [0, 0, 0, 0], length))))).toEqual({
      [refused]: [0, 1, 2, 3, 5, 6],
      [fine]: [4],
    });
  });

  test("DAC has pairs of bytes for 16 tables of each class, and is checked in Huffman-coded files too", async () => {
    expect(await grouped(bytes, number => outcome(before(segment(DAC, [number, 0]))))).toEqual({
      [fine]: range(0, 31),
      [refused]: range(32, 255),
    });
    expect(await grouped(range(2, 8), length => outcome(before(segment(DAC, Buffer.alloc(8), length))))).toEqual({
      [fine]: [2, 4, 6, 8],
      [refused]: [3, 5, 7],
    });
    expect(await outcome(before(segment(DAC, [0, 0, 32, 0])))).toBe(refused);
  });

  test("L in DAC is at most U", async () => {
    expect(await grouped(bytes, value => outcome(before(segment(DAC, [15, value]))), hex)).toEqual({
      [fine]: hex(bytes.filter(value => (value & 15) <= value >> 4)),
      [refused]: hex(bytes.filter(value => (value & 15) > value >> 4)),
    });
    expect(await grouped(bytes, value => outcome(before(segment(DAC, [16, value]))))).toEqual({ [fine]: bytes });
  });
});

describe("the color space", () => {
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
  const rgb = made(3, rgbIds);

  test("three components are YCbCr, unless their ids are R, G and B", async () => {
    const names = ["RGB", "\x01\x02\x03", "\0\x01\x02", "rgb", "BGR", "xGB", "RxB", "RGx", "\x01\x02x", "\x01x\x03"];
    expect(await grouped(names, ids => takenFor(made(3, [...Buffer.from(ids)])))).toEqual({
      RGB: names.slice(0, 1),
      YCbCr: names.slice(1),
    });
  });

  test("the Adobe segment overrides the ids", async () => {
    for (const frame of [three, rgb]) {
      expect(await grouped(bytes, transform => takenFor(frame, adobe(transform)))).toEqual({
        RGB: [0],
        YCbCr: range(1, 255),
      });
    }
  });

  test("JFIF overrides the Adobe segment and the ids", async () => {
    expect(await takenFor(rgb, jfif)).toBe("YCbCr");
    expect(await takenFor(rgb, jfif, adobe(0))).toBe("YCbCr");
    expect(await takenFor(rgb, adobe(0), jfif)).toBe("YCbCr");
  });

  test("four components are CMYK, or YCCK if the Adobe transform is not 0", async () => {
    expect(await takenFor(four)).toBe("CMYK");
    expect(await takenFor(four, jfif)).toBe("CMYK");
    expect(await takenFor(four, jfif, adobe(2))).toBe("YCCK");
    expect(await grouped(bytes, transform => takenFor(four, adobe(transform)))).toEqual({
      CMYK: [0],
      YCCK: range(1, 255),
    });
  });

  test("one component is always gray", async () => {
    for (const app of [jfif, adobe(0), adobe(1), adobe(2)]) expect(await levels(before(app))).toEqual([[5]]);
  });

  test("JFIF is an APP0 of at least 14 bytes with that identifier, in any version", async () => {
    const body = Buffer.concat([jfif.subarray(4), Buffer.alloc(4)]);
    expect(await grouped(range(0, 18), length => takenFor(rgb, segment(APP0, body.subarray(0, length))))).toEqual({
      RGB: range(0, 13),
      YCbCr: range(14, 18),
    });
    expect(await grouped(range(0, 13), at => takenFor(rgb, segment(APP0, body.with(at, 0x77))))).toEqual({
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

  test("the Adobe segment is an APP14 of at least 12 bytes with that identifier, and the last one counts", async () => {
    const body = Buffer.concat([adobe(0).subarray(4), Buffer.alloc(4, 1)]);
    expect(await grouped(range(0, 16), length => takenFor(three, segment(APP14, body.subarray(0, length))))).toEqual({
      YCbCr: range(0, 11),
      RGB: range(12, 16),
    });
    expect(await grouped(range(0, 15), at => takenFor(three, segment(APP14, body.with(at, 0x77))))).toEqual({
      YCbCr: [0, 1, 2, 3, 4, 11],
      RGB: [5, 6, 7, 8, 9, 10, 12, 13, 14, 15],
    });
    expect(await takenFor(three, segment(APP0, body))).toBe("YCbCr");
    expect(await takenFor(three, adobe(1), adobe(0))).toBe("RGB");
    expect(await takenFor(three, adobe(0), adobe(1))).toBe("YCbCr");
    for (const other of ["other", body.subarray(0, 11)]) {
      expect(await takenFor(three, adobe(0), segment(APP14, other))).toBe("RGB");
    }
  });

  test("JFIF and Adobe segments after the first scan are ignored", async () => {
    const around = (frame: Frame, first: Buffer[], later: Buffer[]) => {
      const [one, ...others] = all(frame).map(c => scanWithoutTables(frame, scanOf([c])));
      return seen(jpeg(headerOf(frame), ...first, one, ...later, ...others));
    };
    expect(await around(rgb, [jfif], [])).toBe("YCbCr");
    expect(await around(rgb, [], [jfif])).toBe("RGB");
    expect(await around(three, [adobe(0)], [adobe(1)])).toBe("RGB");
    expect(await around(four, [], [adobe(2)])).toBe("CMYK");
  });
});

describe("the ICC profile", () => {
  const profile = async (...parts: Buffer[]) => {
    const file = before(...parts);
    expect(await levels(file)).toEqual([[5]]);
    return (await decode(file)).profile;
  };

  test("is assembled by the sequence numbers of its segments", async () => {
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
    ["the first segment is missing", [icc(2, 2, "b")]],
    ["the last segment is missing", [icc(1, 2, "a")]],
    ["a segment in the middle is missing", [icc(1, 3, "a"), icc(3, 3, "c")]],
    ["a number comes twice", [icc(1, 1, "a"), icc(1, 1, "a")]],
    ["a number comes twice, and another not at all", [icc(1, 2, "a"), icc(1, 2, "b")]],
    ["a number is 0", [icc(0, 1, "a"), icc(1, 1, "b")]],
    ["a number is above the count", [icc(1, 1, "a"), icc(2, 1, "b")]],
    ["the count is 0", [icc(1, 0, "a")]],
    ["the first count is 0", [icc(0, 0, "a"), icc(1, 1, "b")]],
    ["a later count is higher", [icc(1, 2, "a"), icc(2, 3, "b")]],
    ["a later count is lower", [icc(2, 2, "b"), icc(1, 1, "a")]],
    ["an empty segment has wrong numbers", [icc(1, 1, "a"), icc(9, 9, "")]],
    ["there are 256 segments", [...range(1, 255).map(number => icc(number, 255, "a")), icc(1, 255, "a")]],
    ["there are 300 segments", Array(300).fill(icc(1, 1, "a"))],
    ["all segments are empty", [icc(1, 2, ""), icc(2, 2, "")]],
  ])("is dropped, and the image still decodes, if %s", async (_, parts) => {
    expect(await profile(...parts)).toBe(null);
  });

  test("a segment is an APP2 of at least 14 bytes with that identifier", async () => {
    const wrong = icc(9, 9, "x").subarray(4);
    const beside = (other: Buffer) => profile(other, icc(1, 1, "a"), other).then(String);
    expect(await grouped(range(0, 15), length => beside(segment(APP2, wrong.subarray(0, length))))).toEqual({
      a: range(0, 13),
      null: [14, 15],
    });
    expect(await grouped(range(0, 11), at => beside(segment(APP2, wrong.with(at, 0x77))))).toEqual({ a: range(0, 11) });
    expect(await grouped([...range(APP0, APP0 + 15), COM], code => beside(segment(code, wrong)))).toEqual({
      a: [APP0, APP0 + 1, ...range(APP0 + 3, APP0 + 15), COM],
      null: [APP2],
    });
  });

  test("segments after the first scan are ignored", async () => {
    expect((await decode(jpeg(quant, frame, icc(1, 1, "a"), scan))).profile).toBe("a");
    expect((await decode(after(icc(1, 1, "a")))).profile).toBe(null);
    expect((await decode(jpeg(icc(1, 1, "a"), quant, frame, scan, icc(1, 1, "b")))).profile).toBe("a");
    expect((await decode(jpeg(icc(1, 2, "a"), quant, frame, scan, icc(2, 2, "b")))).profile).toBe(null);
  });

  test("is dropped for CMYK and YCCK", async () => {
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
