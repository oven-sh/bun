// Markers, frame headers and scan headers.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import {
  bytes,
  eights,
  expectPictures,
  fine,
  flat,
  grouped,
  headerOnly,
  hex,
  levels,
  outcome,
  range,
  refused,
} from "./decode";
import { pictureOf } from "./model";
import { after, before, data, frame, gray, header, quant, scan } from "./one-block";
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
  EOB,
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
  scanWithoutTables,
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
  withoutEoi,
  write,
  type Frame,
} from "./write";

describe("markers", () => {
  test("a file starts with SOI and FF", async () => {
    expect(await levels(before())).toEqual([[5]]);
    const unknown = "ERR_IMAGE_UNKNOWN_FORMAT, ERR_IMAGE_UNKNOWN_FORMAT";
    expect(await outcome(before().subarray(2))).toBe(unknown);
    expect(await outcome(before(Buffer.from([0])))).toBe(unknown);
    expect(await outcome(Buffer.concat([Buffer.from([0xff]), before()]))).toBe(unknown);
  });

  test("which are accepted before the frame and after the scan", async () => {
    // As empty segments. After a marker without a length, the length field is two stray bytes.
    const known = [TEM, DHT, DAC, ...range(RST0, RST0 + 7), DQT, DNL, ...range(APP0, APP0 + 15), COM];
    const codes = range(1, 254);
    expect(await grouped(codes, code => outcome(before(segment(code))), hex)).toEqual({
      [fine]: hex(known),
      [refused]: hex(codes.filter(code => !known.includes(code))),
    });
    expect(await grouped(codes, code => outcome(after(segment(code))), hex)).toEqual({
      [fine]: hex([...known, EOI].sort((a, b) => a - b)),
      [headerOnly]: hex(codes.filter(code => !known.includes(code) && code !== EOI)),
    });
  });

  test("RST and TEM have no length", async () => {
    // As a length, these two bytes would skip the start of DQT.
    for (const code of [TEM, ...range(RST0, RST0 + 7)]) {
      expect([code, await levels(before(marker(code), Buffer.from([0, 9])))]).toEqual([code, [[5]]]);
    }
  });

  test("fill bytes and stray bytes before a marker are skipped", async () => {
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
      const file = jpeg(jfif, between, quant, between, frame, between, scan, between);
      expect([stray, await outcome(file), await levels(file)]).toEqual([stray, fine, [[5]]]);
    }
  });

  test("APPn, COM and DNL may have a length below 2, and table segments may not", async () => {
    for (const code of [APP0, APP0 + 1, APP2, APP14, APP0 + 15, COM, DNL]) {
      for (const length of [0, 1]) {
        const short = segment(code, [], length);
        expect([code, await outcome(before(short)), await outcome(after(short))]).toEqual([code, fine, fine]);
      }
    }
    for (const code of [DHT, DAC, DQT]) {
      for (const length of [0, 1])
        expect([code, await outcome(before(segment(code, [], length)))]).toEqual([code, refused]);
    }
  });

  test("markers inside APPn, COM and DNL are ignored", async () => {
    const thumbnail = write(flat([[9, 9]]));
    for (const code of [APP0, APP0 + 1, APP2, APP14, COM, DNL]) {
      expect([code, await levels(before(segment(code, thumbnail)))]).toEqual([code, [[5]]]);
    }
    expect(await levels(before(segment(COM, Buffer.alloc(65533, marker(EOI)))))).toEqual([[5]]);
  });

  test("everything after EOI is ignored", async () => {
    for (const rest of [before(), marker(0xc5), segment(DRI), Buffer.alloc(600, 0xff)]) {
      expect(await levels(Buffer.concat([before(), rest]))).toEqual([[5]]);
    }
  });

  test("a file needs a frame and a scan", async () => {
    expect(await outcome(jpeg())).toBe(refused);
    expect(await outcome(jpeg(quant, dht(0, typical[0])))).toBe(refused);
    expect(await outcome(jpeg(quant, frame))).toBe(refused);
    expect(await outcome(jpeg(quant, marker(EOI), marker(SOI), frame, scan))).toBe(refused);
  });

  test("tables can be anywhere before the scan", async () => {
    const tables = [dht(0, typical[0]), dht(AC, typical[AC])];
    expect(await levels(jpeg(frame, ...tables, quant, scan))).toEqual([[5]]);
    expect(await levels(jpeg(tables[1], quant, frame, tables[0], scan))).toEqual([[5]]);
    expect(await outcome(jpeg(frame, scan, quant))).toBe(headerOnly);
  });
});

describe("a truncated file continues with endless EOI markers", () => {
  test("before SOS, it is refused", async () => {
    const parts = [jfif, adobe(1), icc(1, 1, "abc"), segment(COM, "abc"), dri(0), segment(DAC, [0, 16]), quant, frame];
    const start = withoutEoi(...parts, dht(0, typical[0]));
    expect(await grouped(range(3, start.length), length => outcome(start.subarray(0, length)))).toEqual({
      [refused]: range(3, start.length),
    });
  });

  test("in SOS, FF and D9 become the missing fields", async () => {
    const cut = (missing: number) => withoutEoi(quant, frame, header.subarray(0, -missing));
    // An odd number leaves D9 as data: 110 for category 5, and 11001. This table makes the next zero an EOB.
    const ends = dht(AC, tableOf([EOB], [1]));
    for (const missing of [1, 3]) expect(await levels(withoutEoi(ends, cut(missing).subarray(2)))).toEqual([[25]]);
    expect(await levels(withoutEoi(ends, cut(2).subarray(2)))).toEqual([[0]]);
    // There is no Huffman table 15, and no component 255.
    expect(await outcome(cut(4))).toBe(headerOnly);
    for (const missing of [5, 6, 7, 8, 9]) expect([missing, await outcome(cut(missing))]).toEqual([missing, refused]);

    // With arithmetic coding there can be both.
    const other = frameOf(8, 8, "1x1", { type: SOF9, ids: [255] });
    const missing = (count: number) =>
      outcome(withoutEoi(headerOf(other), sos(other, scanOf([0])).subarray(0, -count)));
    expect(await grouped(range(1, 9), missing)).toEqual({ [fine]: range(1, 5), [refused]: range(6, 9) });
  });

  test("after the scan, it depends on the segment", async () => {
    const cuts = async (last: Buffer) => {
      const lengths = range(0, last.length);
      return grouped(lengths, length => outcome(withoutEoi(quant, frame, scan, last.subarray(0, length))));
    };
    for (const code of [APP0, APP0 + 1, APP2, APP14, COM, DNL]) {
      expect([code, await cuts(segment(code, Buffer.alloc(20)))]).toEqual([code, { [fine]: range(0, 24) }]);
    }
    expect(await cuts(dri(1))).toEqual({ [fine]: [0, 1, 4, 5, 6], [headerOnly]: [2, 3] });
    expect(await cuts(quant)).toEqual({ [fine]: [0, 1, ...range(5, 69)], [headerOnly]: [2, 3, 4] });
    expect(await cuts(dht(0, typical[0]))).toEqual({ [fine]: [0, 1, ...range(21, 33)], [headerOnly]: range(2, 20) });
    expect(await cuts(segment(DAC, [0, 16, 16, 5]))).toEqual({ [fine]: [0, 1, 7, 8], [headerOnly]: range(2, 6) });
  });
});

describe("SOF", () => {
  const fields = frame.subarray(4);
  const withFrame = (other: Buffer) => outcome(jpeg(quant, other, scan));

  test("the length is 8 plus 3 for each component", async () => {
    expect(await grouped(range(0, 20), length => withFrame(segment(SOF0, fields, length)))).toEqual({
      [fine]: [11],
      [refused]: range(0, 20).filter(length => length !== 11),
    });
    expect(await withFrame(segment(SOF0, [8, 0, 8, 0, 8, 0]))).toBe(refused);
  });

  test("a second one is an error", async () => {
    for (const type of [SOF0, SOF1, SOF2, SOF3, SOF9, SOF10, SOF11]) {
      const second = sof(as(type, gray));
      expect([type, await outcome(before(second)), await outcome(after(second))]).toEqual([type, refused, headerOnly]);
    }
  });

  test("width and height are 1 to 65500", async () => {
    const sized = (width: number, height: number) => withFrame(sof({ ...gray, width, height }));
    expect(await grouped([0, 1, 65500, 65501, 65535], width => sized(width, 1))).toEqual({
      [fine]: [1, 65500],
      [refused]: [0, 65501, 65535],
    });
    expect(await grouped([0, 1, 65500, 65501, 65535], height => sized(1, height))).toEqual({
      [fine]: [1, 65500],
      [refused]: [0, 65501, 65535],
    });
    expect(await new Bun.Image(jpeg(quant, sof({ ...gray, width: 0x0102, height: 0x0304 }), scan)).metadata()).toEqual({
      width: 0x0102,
      height: 0x0304,
      format: "jpeg",
    });
  });

  test("DNL does not set the height", async () => {
    const lines = segment(DNL, [0, 16]);
    expect(await outcome(jpeg(quant, sof({ ...gray, height: 0 }), scan, lines))).toBe(refused);
    expect(await levels(after(lines))).toEqual([[5]]);
  });

  test.each([
    ["baseline", SOF0],
    ["extended", SOF1],
    ["progressive", SOF2],
    ["arithmetic", SOF9],
    ["progressive arithmetic", SOF10],
  ])("%s: precision 8 decodes, and 12 only has metadata", async (_, type) => {
    const scans = [scanOf([0], 0, type === SOF2 || type === SOF10 ? 0 : 63)];
    const file = write(as(type, gray), scans);
    const at = file.indexOf(marker(type)) + 4;
    expect(await grouped(bytes, precision => outcome(file.with(at, precision)))).toEqual({
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
    expect(await grouped([...range(1, 12), 255], withCount)).toEqual({
      [fine]: [1, 3, 4],
      [refused]: [2, ...range(5, 12), 255],
    });
  });

  test("sampling factors are 1 to 4", async () => {
    const valid = bytes.filter(both => both >> 4 >= 1 && both >> 4 <= 4 && (both & 15) >= 1 && (both & 15) <= 4);
    expect(await grouped(bytes, both => withFrame(segment(SOF0, fields.with(7, both))), hex)).toEqual({
      [refused]: hex(bytes.filter(both => !valid.includes(both))),
      [fine]: hex(valid),
    });
    // Also for a component that is not in the first scan.
    const file = write(frameOf(8, 8, "1x1,1x1,1x1"), [scanOf([0])]);
    const last = file.indexOf(marker(SOF0)) + 17;
    expect(await grouped([0x11, 0x01, 0x10, 0x51, 0x15], both => outcome(file.with(last, both)))).toEqual({
      [fine]: [0x11],
      [refused]: [0x01, 0x10, 0x51, 0x15],
    });
  });

  test("the largest sampling factor has to be a multiple of each", async () => {
    const samplings = ["3x1,2x1,1x1", "1x3,1x1,1x2", "4x1,3x1,1x1", "1x1,1x3,1x4", "3x1,3x1,1x1", "1x4,1x2,1x1"];
    expect(await grouped(samplings, sampling => outcome(write(frameOf(8, 8, sampling))))).toEqual({
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
      expect(await grouped(samplings, of)).toEqual({ [fine]: samplings.slice(0, 3), [headerOnly]: samplings.slice(3) });
    }
    // The limit is for each scan, not for the frame.
    const twelve = frameOf(8, 8, "2x2,2x2,2x2");
    expect(await outcome(write(twelve, [scanOf([0, 1]), scanOf([2])]))).toBe(fine);
    expect(await outcome(write(twelve, [scanOf([0]), scanOf([0, 1, 2])]))).toBe(headerOnly);
  });

  test("a component with a scan needs its quantization table", async () => {
    const tables = [0, 1, 3].map(number => dqt(number, eights));
    expect(
      await grouped(bytes, number => outcome(jpeg(...tables, segment(SOF0, fields.with(8, number)), scan))),
    ).toEqual({
      [fine]: [0, 1, 3],
      [headerOnly]: bytes.filter(number => number === 2 || number > 3),
    });
  });

  test("a component without a scan needs no quantization table, and its samples are 128", async () => {
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

  test("comes after SOF", async () => {
    expect(await outcome(jpeg(quant, scan, frame))).toBe(refused);
    expect(await outcome(jpeg(quant, scan, frame, scan))).toBe(refused);
  });

  test("the length is 6 plus 2 for each of 1 to 4 components", async () => {
    const lengths = range(0, 16);
    expect(
      await grouped(lengths, length => outcome(jpeg(quant, frame, segment(SOS, header.subarray(4), length)))),
    ).toEqual({
      [refused]: lengths.filter(length => length !== 8),
      [fine]: [8],
    });
    expect(await naming(color, [])).toBe(refused);
    expect(await naming(color, [1, 2, 3, 4])).toBe(fine);
    expect(await naming(color, [1, 2, 3, 4, 1])).toBe(refused);
  });

  test("selects components of the frame, each once", async () => {
    expect(await grouped(bytes, id => naming(color, [id]))).toEqual({
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

  test("the index of a component in the scan is at most its index in the frame", async () => {
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
      await grouped(some, order =>
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

  test("of components with the same id, the nth selector gets the first from index n on", async () => {
    const same = noise(frameOf(16, 8, "1x1,1x1,1x1", { ids: [7, 7, 7] }), randomBytes(3));
    const [first, second, third] = same.components;
    const none = { ...first, data: first.data.map(() => 0) };
    // Only DC coefficients, so that a repeated scan overwrites everything.
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

  test("Ss, Se, Ah and Al are ignored in a sequential frame", async () => {
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

  test("none may follow a first sequential scan of all components", async () => {
    expect(await outcome(after(scan))).toBe(headerOnly);
    expect(await outcome(write(color, [scanOf([0, 1, 2, 3]), scanOf([0])]))).toBe(headerOnly);
    expect(await outcome(write(color, [scanOf([0]), scanOf([0, 1, 2, 3]), scanOf([0])]))).toBe(fine);
  });

  test("later ones are checked too", async () => {
    const start = [headerOf(color), scanWithoutTables(color, scanOf([0]))];
    expect(await outcome(jpeg(...start, segment(SOS, [1, 2, 0, 0, 63, 0])))).toBe(fine);
    expect(await outcome(jpeg(...start, segment(SOS, [1, 5, 0, 0, 63, 0])))).toBe(headerOnly);
    expect(await outcome(jpeg(...start, segment(SOS, [1, 2, 0, 0, 63])))).toBe(headerOnly);
  });
});

describe("maxPixels", () => {
  const tooMany = "ERR_IMAGE_TOO_MANY_PIXELS, ERR_IMAGE_TOO_MANY_PIXELS";
  const sized = (width: number, height: number, more: Partial<Frame> = {}) => sof({ ...gray, width, height, ...more });

  test("is inclusive", async () => {
    for (const [width, height] of [
      [2, 1],
      [11, 7],
      [1, 65500],
    ]) {
      const file = jpeg(quant, sized(width, height), scan);
      expect(await outcome(file, { maxPixels: width * height })).toBe(fine);
      expect(await outcome(file, { maxPixels: width * height - 1 })).toBe(tooMany);
    }
    expect(await outcome(jpeg(quant, sized(16384, 16383), scan))).toBe(tooMany);
    expect(await outcome(jpeg(quant, sized(65500, 65500), scan))).toBe(tooMany);
    expect(await outcome(jpeg(quant, sized(65500, 65500), scan), { maxPixels: 65500 * 65500 - 1 })).toBe(tooMany);
  });

  test("applies to the full size, also with resize()", async () => {
    const small = (maxPixels: number) => new Bun.Image(before(), { maxPixels }).resize(1, 1).png().bytes();
    expect(await small(63).catch(error => error.code)).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
    expect(await new Bun.Image(await small(64)).metadata()).toEqual({ width: 1, height: 1, format: "png" });
  });

  test("is checked after SOF and SOS are parsed, and before anything else", async () => {
    const files = {
      "no scan": jpeg(quant, frame),
      "an unknown marker before the scan": jpeg(quant, frame, segment(0xf0), scan),
      "two components": write(frameOf(8, 8, "1x1,1x1")),
      "9 bits": jpeg(quant, sized(8, 8, { precision: 9 }), scan),
      "too wide": jpeg(quant, sized(65501, 8), scan),
      "12 bits": jpeg(quant, sized(8, 8, { precision: 12 }), scan),
      "no quantization table": jpeg(frame, scan),
      "no Huffman table": jpeg(quant, frame, header.with(6, 0x22), data),
      "too many blocks": write(frameOf(8, 8, "2x2,2x2,2x2")),
      "an unknown marker after the scan": after(segment(0xf0)),
    };
    const names = Object.keys(files) as (keyof typeof files)[];
    expect(await grouped(names, name => outcome(files[name]))).toEqual({
      [refused]: names.slice(0, 5),
      [headerOnly]: names.slice(5),
    });
    expect(await grouped(names, name => outcome(files[name], { maxPixels: 1 }))).toEqual({
      [refused]: names.slice(0, 5),
      [tooMany]: names.slice(5),
    });
  });
});
