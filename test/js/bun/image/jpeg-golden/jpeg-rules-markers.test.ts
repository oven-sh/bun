// The rules for markers, frames and scans, one at a time, in files made by hand.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import {
  bytes,
  eights,
  expectPictures,
  fine,
  flat,
  headerOnly,
  hex,
  levels,
  outcome,
  range,
  refused,
  where,
} from "./decode";
import { pictureOf } from "./model";
import { before, behind, data, frame, gray, header, scan, scanned, steps } from "./one-block";
import {
  AC,
  adobe,
  all,
  APP0,
  APP14,
  APP2,
  as,
  COM,
  DAC,
  DHT,
  dht,
  DNL,
  DQT,
  dqt,
  DRI,
  dri,
  EOI,
  frameOf,
  headerOf,
  icc,
  isProgressive,
  jfif,
  jpeg,
  marker,
  noise,
  RST0,
  scanOf,
  segment,
  sof,
  SOF0,
  SOF1,
  SOF10,
  SOF11,
  SOF2,
  SOF3,
  SOF9,
  SOI,
  SOS,
  sos,
  tableOf,
  TEM,
  typical,
  unfinished,
  write,
  type Frame,
} from "./write";

describe("between the segments", () => {
  test("a file begins with SOI and the first byte of a marker", async () => {
    expect(await levels(before())).toEqual([[5]]);
    const unknown = "ERR_IMAGE_UNKNOWN_FORMAT, ERR_IMAGE_UNKNOWN_FORMAT";
    expect(await outcome(before().subarray(2))).toBe(unknown);
    expect(await outcome(before(Buffer.from([0])))).toBe(unknown);
    expect(await outcome(Buffer.concat([Buffer.from([0xff]), before()]))).toBe(unknown);
  });

  test("the markers that are known, in front of the picture and behind it", async () => {
    // With a segment of nothing, which behind a marker that takes none is two stray bytes.
    const known = [TEM, DHT, DAC, ...range(RST0, RST0 + 7), DQT, DNL, ...range(APP0, APP0 + 15), COM];
    const codes = range(1, 254);
    expect(await where(codes, code => outcome(before(segment(code))), hex)).toEqual({
      [fine]: hex(known),
      [refused]: hex(codes.filter(code => !known.includes(code))),
    });
    expect(await where(codes, code => outcome(behind(segment(code))), hex)).toEqual({
      [fine]: hex([...known, EOI].sort((a, b) => a - b)),
      [headerOnly]: hex(codes.filter(code => !known.includes(code) && code !== EOI)),
    });
  });

  test("RST and TEM have no length", async () => {
    // Taken for a length, these two bytes would lead past the table.
    for (const code of [TEM, ...range(RST0, RST0 + 7)]) {
      expect([code, await levels(before(marker(code), Buffer.from([0, 9])))]).toEqual([code, [[5]]]);
    }
  });

  test("any number of FF may come before a marker, and other bytes are passed over", async () => {
    for (const stray of [
      [0xff],
      [0xff, 0xff, 0xff],
      [0],
      [1, 2, 3],
      [0xff, 0],
      [0xff, 0xff, 0],
      [7, 0xff, 0, 7, 0xff],
    ]) {
      const between = Buffer.from(stray);
      const file = jpeg(jfif, between, steps, between, frame, between, scan, between);
      expect([stray, await outcome(file), await levels(file)]).toEqual([stray, fine, [[5]]]);
    }
  });

  test("a segment that is passed over may say that it is shorter than its length", async () => {
    for (const code of [APP0, APP0 + 1, APP2, APP14, APP0 + 15, COM, DNL]) {
      for (const length of [0, 1]) {
        const short = segment(code, [], length);
        expect([code, await outcome(before(short)), await outcome(behind(short))]).toEqual([code, fine, fine]);
      }
    }
    for (const code of [DHT, DAC, DQT]) {
      for (const length of [0, 1])
        expect([code, await outcome(before(segment(code, [], length)))]).toEqual([code, refused]);
    }
  });

  test("markers inside such a segment are not seen", async () => {
    const thumbnail = write(flat([[9, 9]]));
    for (const code of [APP0, APP0 + 1, APP2, APP14, COM, DNL]) {
      expect([code, await levels(before(segment(code, thumbnail)))]).toEqual([code, [[5]]]);
    }
    expect(await levels(before(segment(COM, Buffer.alloc(65533, marker(EOI)))))).toEqual([[5]]);
  });

  test("nothing is looked at behind EOI", async () => {
    for (const rest of [before(), marker(0xc5), segment(DRI), Buffer.alloc(600, 0xff)]) {
      expect(await levels(Buffer.concat([before(), rest]))).toEqual([[5]]);
    }
  });

  test("tables alone, or a frame without a scan, are no picture", async () => {
    expect(await outcome(jpeg())).toBe(refused);
    expect(await outcome(jpeg(steps, dht(0, typical[0])))).toBe(refused);
    expect(await outcome(jpeg(steps, frame))).toBe(refused);
    expect(await outcome(jpeg(steps, marker(EOI), marker(SOI), frame, scan))).toBe(refused);
  });

  test("tables can be anywhere in front of the scan", async () => {
    const tables = [dht(0, typical[0]), dht(AC, typical[AC])];
    expect(await levels(jpeg(frame, ...tables, steps, scan))).toEqual([[5]]);
    expect(await levels(jpeg(tables[1], steps, frame, tables[0], scan))).toEqual([[5]]);
    expect(await outcome(jpeg(frame, scan, steps))).toBe(headerOnly);
  });
});

describe("a file that breaks off goes on as FF D9, over and over", () => {
  test("in front of the first scan, that is no picture", async () => {
    const parts = [jfif, adobe(1), icc(1, 1, "abc"), segment(COM, "abc"), dri(0), segment(DAC, [0, 16]), steps, frame];
    const start = unfinished(...parts, dht(0, typical[0]));
    expect(await where(range(3, start.length), length => outcome(start.subarray(0, length)))).toEqual({
      [refused]: range(3, start.length),
    });
  });

  test("in the header of the scan, it stands for what is missing", async () => {
    const cut = (missing: number) => unfinished(steps, frame, header.subarray(0, -missing));
    // D9 is left for the data: 110 for five bits, which are 11001. Then come zeros, which are no end of the block here.
    const ends = dht(AC, tableOf([0], [1]));
    for (const missing of [1, 3]) expect(await levels(unfinished(ends, cut(missing).subarray(2)))).toEqual([[25]]);
    expect(await levels(unfinished(ends, cut(2).subarray(2)))).toEqual([[0]]);
    // There is no table 15, and no component 255.
    expect(await outcome(cut(4))).toBe(headerOnly);
    for (const missing of [5, 6, 7, 8, 9]) expect([missing, await outcome(cut(missing))]).toEqual([missing, refused]);

    // With arithmetic coding there can be both.
    const other = frameOf(8, 8, "1x1", { type: SOF9, ids: [255] });
    const missing = (count: number) =>
      outcome(unfinished(headerOf(other), sos(other, scanOf([0])).subarray(0, -count)));
    expect(await where(range(1, 9), missing)).toEqual({ [fine]: range(1, 5), [refused]: range(6, 9) });
  });

  test("behind the picture, it depends on the segment", async () => {
    const cuts = async (last: Buffer) => {
      const lengths = range(0, last.length);
      return where(lengths, length => outcome(unfinished(steps, frame, scan, last.subarray(0, length))));
    };
    for (const code of [APP0, APP0 + 1, APP2, APP14, COM, DNL]) {
      // An even and an odd number of bytes are left to pass over.
      expect([code, await cuts(segment(code, Buffer.alloc(20)))]).toEqual([code, { [fine]: range(0, 24) }]);
    }
    expect(await cuts(dri(1))).toEqual({ [fine]: [0, 1, 4, 5, 6], [headerOnly]: [2, 3] });
    expect(await cuts(steps)).toEqual({ [fine]: [0, 1, ...range(5, 69)], [headerOnly]: [2, 3, 4] });
    expect(await cuts(dht(0, typical[0]))).toEqual({ [fine]: [0, 1, ...range(21, 33)], [headerOnly]: range(2, 20) });
    expect(await cuts(segment(DAC, [0, 16, 16, 5]))).toEqual({ [fine]: [0, 1, 7, 8], [headerOnly]: range(2, 6) });
  });
});

describe("SOF", () => {
  const fields = frame.subarray(4);
  const withFrame = (other: Buffer) => outcome(jpeg(steps, other, scan));

  test("has three bytes for each component, and no more", async () => {
    expect(await where(range(0, 20), length => withFrame(segment(SOF0, fields, length)))).toEqual({
      [fine]: [11],
      [refused]: range(0, 20).filter(length => length !== 11),
    });
    expect(await withFrame(segment(SOF0, [8, 0, 8, 0, 8, 0]))).toBe(refused);
  });

  test("there is one", async () => {
    for (const type of [SOF0, SOF1, SOF2, SOF3, SOF9, SOF10, SOF11]) {
      const second = sof(as(type, gray));
      expect([type, await outcome(before(second)), await outcome(behind(second))]).toEqual([type, refused, headerOnly]);
    }
  });

  test("width and height are 1 to 65500", async () => {
    const sized = (width: number, height: number) => withFrame(sof({ ...gray, width, height }));
    expect(await where([0, 1, 65500, 65501, 65535], width => sized(width, 1))).toEqual({
      [fine]: [1, 65500],
      [refused]: [0, 65501, 65535],
    });
    expect(await where([0, 1, 65500, 65501, 65535], height => sized(1, height))).toEqual({
      [fine]: [1, 65500],
      [refused]: [0, 65501, 65535],
    });
    expect(await new Bun.Image(jpeg(steps, sof({ ...gray, width: 0x0102, height: 0x0304 }), scan)).metadata()).toEqual({
      width: 0x0102,
      height: 0x0304,
      format: "jpeg",
    });
  });

  test("DNL does not say how high the picture is", async () => {
    const lines = segment(DNL, [0, 16]);
    expect(await outcome(jpeg(steps, sof({ ...gray, height: 0 }), scan, lines))).toBe(refused);
    expect(await levels(behind(lines))).toEqual([[5]]);
  });

  test.each([
    ["baseline", SOF0],
    ["extended", SOF1],
    ["progressive", SOF2],
    ["arithmetic", SOF9],
    ["progressive arithmetic", SOF10],
  ])("%s: 8 bits are decoded, and of 12 bits the size can be had", async (_, type) => {
    const scans = [scanOf([0], 0, type === SOF2 || type === SOF10 ? 0 : 63)];
    const file = write(as(type, gray), scans);
    const at = file.indexOf(marker(type)) + 4;
    expect(await where(bytes, precision => outcome(file.with(at, precision)))).toEqual({
      [refused]: bytes.filter(precision => precision !== 8 && precision !== 12),
      [fine]: [8],
      [headerOnly]: [12],
    });
  });

  test("1, 3 or 4 components", async () => {
    const withCount = (count: number) => {
      const many = frameOf(8, 8, Array(count).fill("1x1").join(), { ids: range(1, count) });
      return outcome(write(many, [scanOf([0])]));
    };
    expect(await where([...range(1, 12), 255], withCount)).toEqual({
      [fine]: [1, 3, 4],
      [refused]: [2, ...range(5, 12), 255],
    });
  });

  test("sampling factors are 1 to 4", async () => {
    const valid = bytes.filter(both => both >> 4 >= 1 && both >> 4 <= 4 && (both & 15) >= 1 && (both & 15) <= 4);
    expect(await where(bytes, both => withFrame(segment(SOF0, fields.with(7, both))), hex)).toEqual({
      [refused]: hex(bytes.filter(both => !valid.includes(both))),
      [fine]: hex(valid),
    });
    // Of a component that is not in the first scan, too.
    const file = write(frameOf(8, 8, "1x1,1x1,1x1"), [scanOf([0])]);
    const last = file.indexOf(marker(SOF0)) + 17;
    expect(await where([0x11, 0x01, 0x10, 0x51, 0x15], both => outcome(file.with(last, both)))).toEqual({
      [fine]: [0x11],
      [refused]: [0x01, 0x10, 0x51, 0x15],
    });
  });

  test("the largest has to be a multiple of each", async () => {
    const samplings = ["3x1,2x1,1x1", "1x3,1x1,1x2", "4x1,3x1,1x1", "1x1,1x3,1x4", "3x1,3x1,1x1", "1x4,1x2,1x1"];
    expect(await where(samplings, sampling => outcome(write(frameOf(8, 8, sampling))))).toEqual({
      [headerOnly]: samplings.slice(0, 4),
      [fine]: samplings.slice(4),
    });
  });

  test("an MCU has up to 10 blocks", async () => {
    const samplings = ["4x2,1x1,1x1", "2x2,2x2,2x1", "2x2,1x1,1x1,2x2", "3x3,1x1,1x1", "2x2,2x2,2x2", "4x4,1x1,1x1"];
    for (const type of [SOF0, SOF2, SOF9, SOF10]) {
      const of = (sampling: string) => {
        const sampled = frameOf(8, 8, sampling, { type });
        return outcome(write(sampled, [scanOf(all(sampled), 0, isProgressive(sampled) ? 0 : 63)]));
      };
      expect(await where(samplings, of)).toEqual({ [fine]: samplings.slice(0, 3), [headerOnly]: samplings.slice(3) });
    }
    // What counts is the scan, the first or a later one.
    const twelve = frameOf(8, 8, "2x2,2x2,2x2");
    expect(await outcome(write(twelve, [scanOf([0, 1]), scanOf([2])]))).toBe(fine);
    expect(await outcome(write(twelve, [scanOf([0]), scanOf([0, 1, 2])]))).toBe(headerOnly);
  });

  test("a component that is in a scan needs its quantization table", async () => {
    const tables = [0, 1, 3].map(number => dqt(number, eights));
    expect(await where(bytes, number => outcome(jpeg(...tables, segment(SOF0, fields.with(8, number)), scan)))).toEqual(
      {
        [fine]: [0, 1, 3],
        [headerOnly]: bytes.filter(number => number === 2 || number > 3),
      },
    );
  });

  test("one that is in no scan does not, and is 128 all over", async () => {
    const rgb = noise(frameOf(16, 16, "1x1,1x1,1x1"), randomBytes(1));
    for (const left of [0, 1, 2]) {
      const shown = {
        ...rgb,
        components: rgb.components.map((c, i) => (i === left ? { ...c, data: c.data.map(() => 0) } : c)),
      };
      const named = { ...rgb, components: rgb.components.map((c, i) => (i === left ? { ...c, table: 200 } : c)) };
      const file = write(named, [scanOf([0, 1, 2].filter(c => c !== left))], { before: [adobe(0)] });
      await expectPictures([{ name: `without ${left}`, file, expected: pictureOf(shown, { colors: "RGB" }) }]);
    }
  });
});

describe("SOS", () => {
  const color = noise(frameOf(16, 8, "1x1,1x1,1x1,1x1"), randomBytes(2));
  const naming = (frame: Frame, ids: number[]) =>
    outcome(jpeg(headerOf(frame), segment(SOS, [ids.length, ...ids.flatMap(id => [id, 0]), 0, 63, 0])));

  test("comes behind SOF", async () => {
    expect(await outcome(jpeg(steps, scan, frame))).toBe(refused);
    expect(await outcome(jpeg(steps, scan, frame, scan))).toBe(refused);
  });

  test("has two bytes for each of 1 to 4 components", async () => {
    const lengths = range(0, 16);
    expect(
      await where(lengths, length => outcome(jpeg(steps, frame, segment(SOS, header.subarray(4), length)))),
    ).toEqual({
      [refused]: lengths.filter(length => length !== 8),
      [fine]: [8],
    });
    expect(await naming(color, [])).toBe(refused);
    expect(await naming(color, [1, 2, 3, 4])).toBe(fine);
    expect(await naming(color, [1, 2, 3, 4, 1])).toBe(refused);
  });

  test("names components of the frame, each once", async () => {
    expect(await where(bytes, id => naming(color, [id]))).toEqual({
      [refused]: [0, ...range(5, 255)],
      [fine]: [1, 2, 3, 4],
    });
    for (const ids of [
      [1, 1],
      [2, 2],
      [4, 4],
      [2, 3, 3],
      [3, 4, 3],
      [1, 5],
    ]) {
      expect([ids, await naming(color, ids)]).toEqual([ids, refused]);
    }
    expect(await naming(gray, [1, 1])).toBe(refused);
  });

  test("a component is no further back in the scan than in the frame", async () => {
    const orders = (left: number[], count: number): number[][] =>
      count
        ? left.flatMap(c =>
            orders(
              left.filter(other => other !== c),
              count - 1,
            ).map(rest => [c, ...rest]),
          )
        : [[]];
    const some = [2, 3, 4].flatMap(count => orders([0, 1, 2, 3], count));
    const allowed = some.filter(order => order.every((c, i) => c >= i));
    expect(allowed.length).toBe(9 + 8 + 1);
    expect(
      await where(some, order =>
        naming(
          color,
          order.map(c => c + 1),
        ),
      ),
    ).toEqual({
      [fine]: allowed,
      [refused]: some.filter(order => !allowed.includes(order)),
    });
    const expected = pictureOf(color);
    await expectPictures(
      allowed.map(order => {
        const rest = [0, 1, 2, 3].filter(c => !order.includes(c));
        return { name: `${order}`, file: write(color, [scanOf(order), ...rest.map(c => scanOf([c]))]), expected };
      }),
    );
  });

  test("of components with one name, it is the first whose place in the scan is free", async () => {
    const same = noise(frameOf(16, 8, "1x1,1x1,1x1", { ids: [7, 7, 7] }), randomBytes(3));
    const [first, second, third] = same.components;
    const none = { ...first, data: first.data.map(() => 0) };
    // Only DC coefficients, so that nothing is left of what came before.
    for (const { data } of same.components) data.forEach((_, i) => i % 64 && (data[i] = 0));
    await expectPictures([
      { name: "together", file: write(same), expected: pictureOf(same) },
      {
        name: "one by one",
        file: write(same, [scanOf([0]), scanOf([1]), scanOf([2])]),
        expected: pictureOf({ ...same, components: [third, none, none] }),
      },
      {
        name: "two",
        file: write(same, [scanOf([1, 2])]),
        expected: pictureOf({ ...same, components: [second, third, none] }),
      },
    ]);
  });

  test("the band and the bits mean nothing in a sequential frame", async () => {
    for (const type of [SOF0, SOF1, SOF9]) {
      for (const [ss, se, ah, al] of [
        [1, 63, 0, 0],
        [0, 0, 0, 0],
        [0, 63, 1, 0],
        [0, 63, 0, 1],
        [255, 255, 15, 15],
      ]) {
        const picture = noise(frameOf(8, 8, "1x1", { type }), randomBytes(4));
        const file = write(picture, [{ ...scanOf([0]), ss, se, ah, al }]);
        await expectPictures([{ name: `${type}: ${[ss, se, ah, al]}`, file, expected: pictureOf(picture) }]);
      }
    }
  });

  test("none follows a first scan that is sequential and has all components", async () => {
    expect(await outcome(behind(scan))).toBe(headerOnly);
    expect(await outcome(write(color, [scanOf([0, 1, 2, 3]), scanOf([0])]))).toBe(headerOnly);
    expect(await outcome(write(color, [scanOf([0]), scanOf([0, 1, 2, 3]), scanOf([0])]))).toBe(fine);
  });

  test("a later one is held to the same rules", async () => {
    const start = [headerOf(color), scanned(color, scanOf([0]))];
    expect(await outcome(jpeg(...start, segment(SOS, [1, 2, 0, 0, 63, 0])))).toBe(fine);
    expect(await outcome(jpeg(...start, segment(SOS, [1, 5, 0, 0, 63, 0])))).toBe(headerOnly);
    expect(await outcome(jpeg(...start, segment(SOS, [1, 2, 0, 0, 63])))).toBe(headerOnly);
  });
});

describe("maxPixels", () => {
  const tooMany = "ERR_IMAGE_TOO_MANY_PIXELS, ERR_IMAGE_TOO_MANY_PIXELS";
  const sized = (width: number, height: number, more: Partial<Frame> = {}) => sof({ ...gray, width, height, ...more });

  test("as many pixels, and no more", async () => {
    for (const [width, height] of [
      [2, 1],
      [11, 7],
      [1, 65500],
    ]) {
      const file = jpeg(steps, sized(width, height), scan);
      expect(await outcome(file, { maxPixels: width * height })).toBe(fine);
      expect(await outcome(file, { maxPixels: width * height - 1 })).toBe(tooMany);
    }
    expect(await outcome(jpeg(steps, sized(16384, 16383), scan))).toBe(tooMany);
    expect(await outcome(jpeg(steps, sized(65500, 65500), scan))).toBe(tooMany);
    expect(await outcome(jpeg(steps, sized(65500, 65500), scan), { maxPixels: 65500 * 65500 - 1 })).toBe(tooMany);
  });

  test("of the whole picture, however small it is decoded", async () => {
    const small = (maxPixels: number) => new Bun.Image(before(), { maxPixels }).resize(1, 1).png().bytes();
    expect(await small(63).catch(error => error.code)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await new Bun.Image(await small(64)).metadata()).toEqual({ width: 1, height: 1, format: "png" });
  });

  test("is looked at after the header and before the rest", async () => {
    const files = {
      "no scan": jpeg(steps, frame),
      "an unknown marker in front of the scan": jpeg(steps, frame, segment(0xf0), scan),
      "two components": write(frameOf(8, 8, "1x1,1x1")),
      "9 bits": jpeg(steps, sized(8, 8, { precision: 9 }), scan),
      "too wide": jpeg(steps, sized(65501, 8), scan),
      "12 bits": jpeg(steps, sized(8, 8, { precision: 12 }), scan),
      "no quantization table": jpeg(frame, scan),
      "no Huffman table": jpeg(steps, frame, header.with(6, 0x22), data),
      "too many blocks": write(frameOf(8, 8, "2x2,2x2,2x2")),
      "an unknown marker behind the scan": behind(segment(0xf0)),
    };
    const names = Object.keys(files) as (keyof typeof files)[];
    expect(await where(names, name => outcome(files[name]))).toEqual({
      [refused]: names.slice(0, 5),
      [headerOnly]: names.slice(5),
    });
    expect(await where(names, name => outcome(files[name], { maxPixels: 1 }))).toEqual({
      [refused]: names.slice(0, 5),
      [tooMany]: names.slice(5),
    });
  });
});
