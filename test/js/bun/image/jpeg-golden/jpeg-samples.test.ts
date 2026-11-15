// From samples to pixels, to the last bit. model.ts says what has to come out, and it shares no code with Bun.
import { test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { expectPictures, range, said } from "./decode";
import { pictureOf, type Colors } from "./model";
import {
  all,
  dht,
  frameOf,
  headerOf,
  jpeg,
  noise,
  scanOf,
  SOF2,
  SOF3,
  sos,
  Symbols,
  typical,
  write,
  type Frame,
} from "./write";

const tables = typical;

/** A pixel for each block at an eighth of the size. */
function fileOfSamples(samples: Frame, before: Buffer[]) {
  const { width, height, components } = samples;
  const one = frameOf(1, 1, components.map(() => "1x1").join(), { type: SOF2, tables: [[8, ...Array(63).fill(0)]] });
  const frame = { ...one, width: width * 8, height: height * 8 };
  const symbols = new Symbols();
  for (let i = 0; i < width * height; i++) {
    for (const { data } of components) symbols.value(0, 0, data[i] - (i ? data[i - 1] : 128));
  }
  const header = sos(frame, scanOf(all(frame), 0, 0, 0, 0, { dc: [0, 0, 0, 0] }));
  return jpeg(...before, headerOf(frame), dht(0, typical[0]), header, symbols.bytes());
}

test.each<[string, Colors, (x: number, y: number) => number[]]>([
  // With room for green to go where it goes.
  ["every Cb with every Cr", "YCbCr", (x, y) => [x + 2 * y < 384 ? 60 : 195, x, y]],
  ["every Y with every Cb and every Cr", "YCbCr", (x, y) => [x, y, 255 - y]],
  ["every Cb with every Cr", "YCCK", (x, y) => [x + 2 * y < 384 ? 60 : 195, x, y, 255]],
  ["every Y with every Cb and every Cr", "YCCK", (x, y) => [x, y, 255 - y, 255 - ((x * y) & 63)]],
  ["every ink with every K", "CMYK", (x, y) => [x, 255 - x, x ^ 0x55, y]],
])("%s, in %s", async (name, colors, pixel) => {
  const samples = frameOf(
    256,
    256,
    Array(colors === "YCbCr" ? 3 : 4)
      .fill("1x1")
      .join(),
    { type: SOF3 },
  );
  for (let i = 0; i < 65536; i++) {
    const values = pixel(i & 255, i >> 8);
    for (let c = 0; c < values.length; c++) samples.components[c].data[i] = values[c];
  }
  await expectPictures([
    { name, file: fileOfSamples(samples, said[colors]), eighths: 1, expected: pictureOf(samples, { colors }) },
  ]);
});

const factors = range(1, 4).flatMap(h => range(1, 4).map(v => [h, v]));
/** The first component has the most blocks each way, or the second has, or each has one way. */
const unusual = factors.flatMap(([h, v]) =>
  factors
    .filter(
      ([otherH, otherV]) =>
        Math.max(h, otherH) % Math.min(h, otherH) === 0 && Math.max(v, otherV) % Math.min(v, otherV) === 0,
    )
    .map(([otherH, otherV]) => `${h}x${v},${otherH}x${otherV},1x1`),
);
const apart = (sampling: string, random: () => number, eighths: number) => {
  const frame = noise(frameOf(37, 35, sampling), random, { sparse: 12, ac: 160 });
  const file = write(frame, [scanOf([0]), scanOf([1]), scanOf([2])], { before: said.RGB, tables });
  return { name: `${sampling} at ${eighths}/8`, file, eighths, expected: pictureOf(frame, { eighths, colors: "RGB" }) };
};

test.each(range(1, 4))("any sampling factors, the first being %i across", async h => {
  const random = randomBytes(h);
  await expectPictures(
    unusual
      .filter((sampling, i) => sampling.startsWith(`${h}`) && (!slow || i % 3))
      .map(sampling => apart(sampling, random, 8)),
  );
});

test.each(range(1, 7))("any sampling factors at %i eighths", async eighths => {
  const random = randomBytes(eighths);
  await expectPictures(
    unusual.filter((_, i) => !slow || i % 7 === eighths - 1).map(sampling => apart(sampling, random, eighths)),
  );
});

test.each(["2x3", "2x4", "3x2", "4x2"])("samples that are repeated %s times, in one scan", async times => {
  const random = randomBytes(9);
  await expectPictures(
    [1, 2, 3, 5, 17, 25, 33, 67].flatMap(height => {
      const frame = noise(frameOf(41, height, `1x1,${times},1x1`), random, { sparse: 12, ac: 160 });
      const file = write(frame, undefined, { before: said.RGB, tables });
      return (slow ? [3, 8] : range(1, 8)).map(eighths => ({
        name: `${height} high at ${eighths}/8`,
        file,
        eighths,
        expected: pictureOf(frame, { eighths, colors: "RGB" }),
      }));
    }),
  );
});

test("other ways to write the usual ones, at every scale", async () => {
  const random = randomBytes(8);
  await expectPictures(
    ["2x2", "3x1", "2x2,2x1,2x1", "2x2,1x2,1x2", "2x1,2x1,2x1", "1x3,1x3,1x3", "2x2,2x1,2x1,2x2"].flatMap(sampling => {
      const frame = noise(frameOf(37, 35, sampling), random, { sparse: 12 });
      const file = write(
        frame,
        all(frame).map(c => scanOf([c])),
        { tables },
      );
      return range(1, 8).map(eighths => ({
        name: `${sampling} at ${eighths}/8`,
        file,
        eighths,
        expected: pictureOf(frame, { eighths }),
      }));
    }),
  );
});
