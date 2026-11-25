// Upsampling and color conversion, bit for bit against model.ts.
import { test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { colorMarkers, expectPictures, range } from "./decode";
import { pictureOf, type Colors } from "./model";
import {
  all,
  dcOnly,
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

/** Each sample becomes a block, which is one pixel at 1/8. */
function fileOfSamples(samples: Frame, before: Buffer[]) {
  const { width, height, components } = samples;
  const one = frameOf(1, 1, components.map(() => "1x1").join(), { type: SOF2, tables: [dcOnly(8)] });
  const frame = { ...one, width: width * 8, height: height * 8 };
  const symbols = new Symbols();
  for (let i = 0; i < width * height; i++) {
    for (const { data } of components) symbols.value(0, 0, data[i] - (i ? data[i - 1] : 128));
  }
  const header = sos(frame, scanOf(all(frame), 0, 0, 0, 0, { dc: [0, 0, 0, 0] }));
  return jpeg(...before, headerOf(frame), dht(0, typical[0]), header, symbols.bytes());
}

test.each<[string, Colors, (x: number, y: number) => number[]]>([
  // This Y keeps green from being clamped.
  ["every Cb with every Cr", "YCbCr", (x, y) => [x + 2 * y < 384 ? 60 : 195, x, y]],
  ["every Y with every Cb and every Cr", "YCbCr", (x, y) => [x, y, 255 - y]],
  ["every Cb with every Cr", "YCCK", (x, y) => [x + 2 * y < 384 ? 60 : 195, x, y, 255]],
  ["every Y with every Cb and every Cr", "YCCK", (x, y) => [x, y, 255 - y, 255 - ((x * y) & 63)]],
  ["every C, M and Y with every K", "CMYK", (x, y) => [x, 255 - x, x ^ 0x55, y]],
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
    { name, file: fileOfSamples(samples, colorMarkers[colors]), eighths: 1, expected: pictureOf(samples, { colors }) },
  ]);
});

const factors = range(1, 4).flatMap(h => range(1, 4).map(v => [h, v]));
/** All pairs of sampling factors that divide each other. */
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
  const file = write(frame, [scanOf([0]), scanOf([1]), scanOf([2])], { before: colorMarkers.RGB, tables: typical });
  return { name: `${sampling} at ${eighths}/8`, file, eighths, expected: pictureOf(frame, { eighths, colors: "RGB" }) };
};

test.each(range(1, 4))("any sampling factors, with H = %i for the first component", async h => {
  const random = randomBytes(h);
  await expectPictures(
    unusual
      .filter((sampling, i) => sampling.startsWith(`${h}`) && (!slow || i % 3))
      .map(sampling => apart(sampling, random, 8)),
  );
});

test.each(range(1, 7))("any sampling factors at %i/8", async eighths => {
  const random = randomBytes(eighths);
  await expectPictures(
    unusual.filter((_, i) => !slow || i % 7 === eighths - 1).map(sampling => apart(sampling, random, eighths)),
  );
});

test.each(["2x3", "2x4", "3x2", "4x2"])("upsampling by %s in an interleaved scan", async times => {
  const random = randomBytes(9);
  await expectPictures(
    [1, 2, 3, 5, 17, 25, 33, 67].flatMap(height => {
      const frame = noise(frameOf(41, height, `1x1,${times},1x1`), random, { sparse: 12, ac: 160 });
      const file = write(frame, undefined, { before: colorMarkers.RGB, tables: typical });
      return (slow ? [3, 8] : range(1, 8)).map(eighths => ({
        name: `${height} high at ${eighths}/8`,
        file,
        eighths,
        expected: pictureOf(frame, { eighths, colors: "RGB" }),
      }));
    }),
  );
});

test("sampling factors with a common divisor, at every scale", async () => {
  const random = randomBytes(8);
  await expectPictures(
    ["2x2", "3x1", "2x2,2x1,2x1", "2x2,1x2,1x2", "2x1,2x1,2x1", "1x3,1x3,1x3", "2x2,2x1,2x1,2x2"].flatMap(sampling => {
      const frame = noise(frameOf(37, 35, sampling), random, { sparse: 12 });
      const file = write(
        frame,
        all(frame).map(c => scanOf([c])),
        { tables: typical },
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

test("Cb and Cr with different sampling factors", async () => {
  const [random, chroma] = [randomBytes(10), ["1x1", "1x2", "2x1", "2x2"]];
  await expectPictures(
    chroma.flatMap(cb =>
      chroma
        .filter(cr => cr !== cb)
        .map(cr => {
          const frame = noise(frameOf(37, 35, `2x2,${cb},${cr}`), random, { sparse: 12 });
          return {
            name: `${cb}, ${cr}`,
            file: write(frame, undefined, { tables: typical }),
            expected: pictureOf(frame),
          };
        }),
    ),
  );
});
