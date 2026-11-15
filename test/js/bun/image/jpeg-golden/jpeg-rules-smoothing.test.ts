// Block smoothing: the low AC coefficients that a progressive file lacks are estimated from neighboring blocks.
import { describe, expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { bytes, colorMarkers, expectPictures, range } from "./decode";
import { known, missingBits, pictureOf, scaled, smoothed } from "./model";
import {
  AC,
  all,
  coded,
  copyOf,
  dht,
  dhts,
  dri,
  frameOf,
  headerOf,
  jpeg,
  noise,
  progressiveTypes,
  rgbIds,
  rst,
  scanOf,
  simpleProgression,
  SOF10,
  SOF2,
  sos,
  tableOf,
  typical,
  withRestarts,
  write,
  type Frame,
  type HuffmanTable,
  type Scan,
} from "./write";

const steps = range(0, 63).map(k => 3 + ((k * 7) % 11));
const guessed = (frame: Frame, scans: Scan[], eighths = 8) => {
  const missing = missingBits(frame, scans);
  return pictureOf(
    smoothed(known(frame, scans), c => missing[c]),
    { eighths },
  );
};

test.each(progressiveTypes)("%s: without AC scans, coefficients 0 to 9 are estimated", async (_, type) => {
  const random = randomBytes(4);
  const sides = slow ? [1, 2, 3, 6] : range(1, 6);
  await expectPictures(
    sides.flatMap(wide =>
      sides.map(high => {
        const frame = noise(frameOf(wide * 8, high * 8, "1x1", { type, tables: [steps] }), random);
        const scans = [scanOf([0], 0, 0, 0, (wide + high) % 3)];
        return { name: `${wide} by ${high}`, file: write(frame, scans), expected: guessed(frame, scans) };
      }),
    ),
  );
});

test.each(progressiveTypes)(
  "%s: with a scan for any of 1 to 9, only 1 to 5 are estimated, below 2^Al",
  async (_, type) => {
    const frame = noise(frameOf(56, 48, "1x1", { type, tables: [steps] }), randomBytes(5), { sparse: 3, ac: 60 });
    const bands = [
      ...range(1, 10).map(k => [k, k, 0]),
      ...range(0, 4).map(al => [1, 5, al]),
      [1, 9, 0],
      [1, 63, 1],
      [10, 63, 0],
    ];
    await expectPictures(
      bands.map(([ss, se, al]) => {
        const scans = [scanOf([0], 0, 0), scanOf([0], ss, se, 0, al)];
        return { name: `${ss} to ${se}, Al ${al}`, file: write(frame, scans), expected: guessed(frame, scans) };
      }),
    );
  },
);

test("a half is rounded away from 0", async () => {
  // A DC step of 128 makes every odd sum a half.
  const frame = frameOf(48, 48, "1x1", { type: SOF2, tables: [[128, ...Array(63).fill(1)]] });
  const random = randomBytes(6);
  for (let i = 0; i < 36; i++) frame.components[0].data[i * 64] = (random() % 5) - 2;
  await expectPictures(
    [[], [scanOf([0], 9, 9)]].map(more => {
      const scans = [scanOf([0], 0, 0), ...more];
      return { name: `${scans.length}`, file: write(frame, scans), expected: guessed(frame, scans) };
    }),
  );
});

test("quantization steps are unsigned", async () => {
  const random = randomBytes(13);
  await expectPictures(
    range(0, 9).map(k => {
      // An even multiple of 32768 is 0 in 16 bits.
      const frame = frameOf(40, 40, "1x1", {
        type: SOF2,
        tables: [
          Array(64)
            .fill(k ? 3 : 30)
            .with(k, 32768),
        ],
      });
      for (let i = 0; i < 25; i++) frame.components[0].data[i * 64] = k ? (random() - 128) * 2 : (random() & 2) - 2;
      const scans = [scanOf([0], 0, 0), ...(k ? [] : [scanOf([0], 1, 5, 0, 1)])];
      return { name: `${k}`, file: write(frame, scans), expected: guessed(frame, scans) };
    }),
  );
});

test("rows of about 32, 64 and 96 blocks", async () => {
  const random = randomBytes(14);
  await expectPictures(
    [30, 31, 32, 33, 34, 35, 64, 65, 97].map(wide => {
      const frame = noise(frameOf(wide * 8, 16, "1x1", { type: SOF2, tables: [steps] }), random, { sparse: 200 });
      const scans = [scanOf([0], 0, 0)];
      return { name: `${wide}`, file: write(frame, scans), expected: guessed(frame, scans) };
    }),
  );
});

test.each(["across", "down"])("thousands of blocks %s", async way => {
  const [some, count] = [23, slow ? 180 : 356];
  const sized = (blocks: number): [number, number] => (way === "across" ? [blocks * 8, 8] : [8, blocks * 8]);
  const [once, twice] = [1, 2].map(n => frameOf(...sized(n * some), "1x1", { type: SOF2, tables: [steps] }));
  const [{ data: values }] = noise(once, randomBytes(15), { sparse: 200 }).components;
  for (const n of [0, 1]) twice.components[0].data.set(values, n * values.length);
  const scans = [scanOf([0], 0, 0)];
  const { tables, header, data } = coded(once, scans[0]);
  const [width, height] = sized(count * some - 0.5);
  const intervals = withRestarts<Buffer>(Array(count).fill(data));
  const file = jpeg(headerOf({ ...once, width, height }), dri(some), ...tables, header, ...intervals);
  // The part of `twice` from the middle of one copy to the middle of the other is out of reach of the edges.
  const two = guessed(twice, scans, 1).rgba;
  const [start, end] = [some >> 1, some + (some >> 1)].map(pixels => pixels * 4);
  const between = Buffer.alloc((count - 1) * some * 4, two.subarray(start, end));
  const rgba = Buffer.concat([two.subarray(0, start), between, two.subarray(end)]);
  const expected = { width: scaled(width, 1), height: scaled(height, 1), rgba };
  await expectPictures([{ name: way, file, eighths: 1, expected }]);
});

test("estimates are limited for Al up to 13", async () => {
  const random = randomBytes(16);
  await expectPictures(
    range(5, 13).map(al => {
      // Dequantized in 16 bits, DC wraps to 0, and the largest estimate to minus the step.
      const table = Array(64)
        .fill(65536 >> al)
        .with(0, 32768);
      const frame = frameOf(24, 24, "1x1", { type: SOF2, tables: [table] });
      for (let i = 0; i < 9; i++) frame.components[0].data[i * 64] = [-200, 200][random() & 1];
      const scans = [scanOf([0], 0, 0), scanOf([0], 1, 1, 0, al), scanOf([0], 2, 5)];
      return { name: `${al}`, file: write(frame, scans), expected: guessed(frame, scans) };
    }),
  );
});

test("each component by its own scans, at every scale", async () => {
  const frame = noise(
    frameOf(70, 60, "2x2,1x1,1x1", { type: SOF2, tables: [steps, steps.toReversed()] }),
    randomBytes(7),
  );
  const scans = simpleProgression.slice(0, 3);
  const file = write(frame, scans);
  await expectPictures(
    range(1, 8).map(eighths => ({ name: `${eighths}`, file, eighths, expected: guessed(frame, scans, eighths) })),
  );
});

test("each of four components by its own scans", async () => {
  const frame = noise(frameOf(40, 24, "1x1,1x1,1x1,1x1", { type: SOF2, tables: [steps] }), randomBytes(17), {
    sparse: 3,
    ac: 60,
  });
  const dc = scanOf(all(frame), 0, 0);
  await expectPictures(
    all(frame).map(c => {
      const scans = [dc, scanOf([c], 1, 5, 0, 1), scanOf([(c + 1) & 3], 1, 63)];
      return { name: `${c}`, file: write(frame, scans), expected: guessed(frame, scans) };
    }),
  );
});

test("padding blocks below the image count as neighbors, and a partial last row of MCUs has fewer above", async () => {
  const random = randomBytes(8);
  await expectPictures(
    ["1x2,1x1,1x1", "2x2,1x1,1x1", "1x4,1x1,1x1", "1x3,1x1,1x1", "1x2", "1x4"].flatMap(sampling =>
      (slow ? [1, 3, 5, 6, 9] : range(1, 9)).flatMap(high => {
        const frame = noise(frameOf(24, high * 8, sampling, { type: SOF2, tables: [steps] }), random);
        // A scan of one component has no padding blocks, so they are 0.
        const apart = copyOf(frame);
        for (const { data, wide, high, across } of apart.components) {
          data.forEach((_, i) => ((i >> 6) % across >= wide || i >> 6 >= high * across) && (data[i] = 0));
        }
        const [together, oneByOne] = [[scanOf(all(frame), 0, 0)], all(frame).map(c => scanOf([c], 0, 0))];
        const name = `${sampling}, ${high} high`;
        return [
          { name, file: write(frame, oneByOne, { tables: typical }), expected: guessed(apart, oneByOne) },
          ...(all(frame).length > 1
            ? [{ name, file: write(frame, together, { tables: typical }), expected: guessed(frame, together) }]
            : []),
        ];
      }),
    ),
  );
});

const rgb = noise(frameOf(24, 48, "1x1,1x1,1x1", { type: SOF2, ids: rgbIds, tables: [steps] }), randomBytes(9), {
  sparse: 3,
  ac: 60,
});
const colors = "RGB";
const nothing = Array(10).fill(-1);

test("is off if any component has a 0 among the first ten quantization steps", async () => {
  const scans = [scanOf([0, 1, 2], 0, 0)];
  await expectPictures(
    range(0, 10).map(k => {
      const frame = {
        ...rgb,
        tables: [steps, steps.with(k, 0)],
        components: rgb.components.with(2, { ...rgb.components[2], table: 1 }),
      };
      const sent = known(frame, scans);
      return {
        name: `${k}`,
        file: write(frame, scans),
        expected: pictureOf(k < 10 ? sent : smoothed(sent, () => nothing), { colors }),
      };
    }),
  );
});

test("is off if any component has no DC scan", async () => {
  await expectPictures(
    [[scanOf([0, 1], 0, 0)], [scanOf([1, 2], 0, 0)], [scanOf([0, 1], 0, 0), scanOf([2], 1, 5)]].map((scans, i) => ({
      name: `${i}`,
      file: write(rgb, scans),
      expected: pictureOf(known(rgb, scans), { colors }),
    })),
  );
});

/** Zeros decode as a DC difference of 0, or as EOB. */
const zeroFirst = (symbols: number[]): HuffmanTable =>
  tableOf(
    symbols,
    symbols.map(symbol => (symbol ? 10 : 1)),
  );
const tables = { 0: zeroFirst(range(0, 15)), [AC]: zeroFirst(bytes) };
/** Scan number `cut` ends after `rows` rows of blocks. */
function cutShort(frame: Frame, scans: Scan[], cut: number, rows: number) {
  const sent = known(frame, scans);
  const without = known(frame, scans.toSpliced(cut, 1));
  const { components, ss, se } = scans[cut];
  const { wide } = frame.components[components[0]];
  for (const c of components) {
    const { data, across } = sent.components[c];
    data.forEach(
      (_, i) => i >= rows * across * 64 && i % 64 >= ss && i % 64 <= se && (data[i] = without.components[c].data[i]),
    );
  }
  const parts = scans.flatMap((scan, i) => {
    const interval = i === cut ? wide : 0;
    const { header, data } = coded(frame, { ...scan, interval, maxEobRun: 1, dc: [0, 0, 0], ac: [0] }, tables);
    return [dri(interval), header, i === cut ? data.subarray(0, data.indexOf(rst(rows - 1))) : data];
  });
  return { sent, file: jpeg(headerOf(frame), ...dhts(tables), ...parts) };
}
const oneBit = [0, 1, 1, 1, 1, 1, -1, -1, -1, -1];

test("below the row of MCUs where the last scan is truncated, it goes by the state before that scan", async () => {
  const tall = noise(frameOf(24, 80, "1x2", { type: SOF2, tables: [steps] }), randomBytes(10), { sparse: 3, ac: 60 });
  await expectPictures(
    range(1, 8).map(rows => {
      const { sent, file } = cutShort(tall, [scanOf([0], 0, 0), scanOf([0], 1, 5, 0, 1)], 1, rows);
      const expected = pictureOf(smoothed(sent, (_, row) => (row > rows >> 1 ? nothing : oneBit)));
      return { name: `${rows}`, file, expected };
    }),
  );
});

describe("a row counts as decoded if data was left when one of its MCUs began, before any restart", () => {
  type Layout = [wide: number, interval: number, data: string, lastRow: number];
  /** The last scan is for component 1, which is all zeros. Its only code is 0, for `symbol`. */
  async function expectLastRows([ss, se, ah]: number[], symbol: number, layouts: Layout[]) {
    const random = randomBytes(15);
    const earlier = [scanOf([0, 1, 2], 0, 0), scanOf([0], 1, 5, 0, 1)];
    const table = dht(ss ? AC : 0, tableOf([symbol], [1]));
    const now = [oneBit, ss ? oneBit : nothing, nothing];
    const before = [nothing, nothing, Array(10).fill(0)];
    await expectPictures(
      layouts.map(([wide, interval, data, lastRow]) => {
        const all = noise({ ...frameOf(wide * 8, 40, "1x1,1x1,1x1"), type: SOF2, tables: [steps] }, random);
        all.components[1].data.fill(0);
        const frame = known(all, earlier.slice(0, 1));
        const start = write(frame, earlier, { before: colorMarkers.RGB }).subarray(2, -2);
        const header = sos(frame, scanOf([1], ss, se, ah, ss ? 1 : 0, { dc: [0], ac: [0] }));
        const parts = withRestarts(data.split(" ").map(part => Buffer.from(part, "hex")));
        return {
          name: `${wide}, ${interval}, ${data}`,
          file: jpeg(start, table, dri(interval), header, ...parts),
          expected: pictureOf(
            smoothed(frame, (c, row) => (row > lastRow ? before : now)[c]),
            { colors },
          ),
        };
      }),
    );
  }

  test.each([
    ["first DC scan", [0, 0, 0]],
    ["first AC scan", [1, 5, 0]],
    ["AC refinement", [1, 5, 2]],
  ])("%s", async (_, scan) => {
    // A block is a 0 bit, or an invalid code of 17 bits that goes past the data.
    await expectLastRows(scan, 0, [
      [1, 1, "00 ff00", 1],
      [1, 1, "00 ff00 ff00", 1],
      [1, 1, "00 ff00 00", 3],
      [2, 2, "ff00 ff00", 0],
      [2, 2, "ff00 7f", 1],
      [2, 2, "ff00 3f", 2],
      [3, 3, "ff00 7f", 1],
      [3, 3, "ff00 ff00", 0],
      [4, 2, "00 00 7f ff00", 1],
      [4, 2, "00 ff00 ff00 ff00", 0],
      [4, 2, "00 ff00 ff00 7f", 1],
      [4, 3, "00 ff00", 0],
      [4, 3, "00 7f", 1],
    ]);
  });

  test("DC refinement", async () => {
    await expectLastRows([0, 0, 1], 0, [
      [9, 9, " ", 0],
      [9, 9, " 00", 1],
      [8, 8, " 00", 2],
    ]);
  });

  test.each([0, 2])("EOB14, which takes 15 bits, with Ah = %i", async ah => {
    await expectLastRows([1, 5, ah], 0xe0, [
      [2, 2, "00 00 00 00 00", 0],
      [2, 2, "00 00 00 00 0000", 4],
      [1, 1, "00 00 00 00 0000", 0],
    ]);
  });
});

test("the earlier state is that before the last scan of each component, or complete if that is the first of the file", async () => {
  const dc = (components: number[], ah = 0, al = 0) => scanOf(components, 0, 0, ah, al);
  const below = (now: number[][], before: number[][]) => (c: number, row: number) => (row > 2 ? before : now)[c];
  const complete = Array(10).fill(0);
  const twoBits = oneBit.map(bits => (bits > 0 ? 2 : bits));
  const cases: [string, Scan[], number, Parameters<typeof smoothed>[1]][] = [
    ["the only scan", [dc([0, 1, 2])], 0, () => nothing],
    ["one for each", [dc([0]), dc([1]), dc([2])], 2, below([nothing, nothing, nothing], [complete, nothing, nothing])],
    [
      "DC refinement of another component",
      [dc([0, 1, 2], 0, 1), scanOf([0], 1, 5, 0, 1), dc([1], 1, 0)],
      2,
      below([oneBit, nothing, nothing], [nothing, nothing, complete]),
    ],
    [
      "the same, after a scan of 1 to 9",
      [dc([0, 1, 2], 0, 1), scanOf([0], 1, 9), dc([1], 1, 0)],
      2,
      below([complete, nothing, nothing], [nothing, nothing, complete]),
    ],
    [
      "AC refinement",
      [dc([0, 1, 2]), scanOf([1], 1, 5, 0, 2), scanOf([1], 1, 5, 2, 1)],
      2,
      below([nothing, oneBit, nothing], [complete, twoBits, complete]),
    ],
    [
      "a higher band",
      [dc([0, 1, 2]), scanOf([1], 1, 5, 0, 1), scanOf([1], 20, 30)],
      2,
      below([nothing, oneBit, nothing], [complete, oneBit, complete]),
    ],
    [
      "not the last",
      [dc([0, 1, 2]), scanOf([0], 1, 5, 0, 1), scanOf([1], 1, 5, 0, 1)],
      1,
      c => (c < 2 ? oneBit : nothing),
    ],
  ];
  await expectPictures(
    cases.map(([name, scans, cut, missing]) => {
      const { sent, file } = cutShort(rgb, scans, cut, 2);
      return { name, file, expected: pictureOf(smoothed(sent, missing), { colors }) };
    }),
  );
});

test("is off if the truncated scan completes coefficients 1 to 9", async () => {
  const gray = { ...rgb, components: rgb.components.slice(0, 1) };
  const { sent, file } = cutShort(gray, [scanOf([0], 0, 0), scanOf([0], 1, 9)], 1, 2);
  await expectPictures([{ name: "1 to 9", file, expected: pictureOf(sent) }]);
});

test.each([1, 3])("an arithmetic-coded scan never counts as truncated: %i blocks wide", async wide => {
  // An empty band needs next to no data, so most rows are decoded from the zeros after it.
  const all = noise(frameOf(wide * 8, 48, "1x1", { type: SOF10, tables: [steps] }), randomBytes(16));
  const gray = known(all, [scanOf([0], 0, 0)]);
  const [dc, band] = [coded(gray, scanOf([0], 0, 0)), coded(gray, scanOf([0], 1, 5, 0, 1))];
  expect(band.data.length).toBeLessThan(2);
  const file = jpeg(headerOf(gray), dc.header, dc.data, band.header, band.data);
  await expectPictures([{ name: "cut", file, expected: pictureOf(smoothed(gray, () => oneBit)) }]);
});
