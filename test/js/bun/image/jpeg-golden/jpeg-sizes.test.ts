// The common sampling factors and color spaces in many sizes, bit for bit against model.ts.
import { describe, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { alsoWithTrailer, colorMarkers, expectPictures, range } from "./decode";
import { pictureOf, type Colors } from "./model";
import { frameOf, headerOf, jpeg, noise, typical, write, type Frame } from "./write";

const usual: [string, Colors][] = [
  ["1x1", "gray"],
  ["1x1,1x1,1x1", "YCbCr"],
  ["2x1,1x1,1x1", "YCbCr"],
  ["2x2,1x1,1x1", "YCbCr"],
  ["1x2,1x1,1x1", "YCbCr"],
  ["4x1,1x1,1x1", "YCbCr"],
  ["1x4,1x1,1x1", "YCbCr"],
  ["1x1,1x1,1x1", "RGB"],
  ["2x2,1x1,1x1", "RGB"],
  ["1x1,1x1,1x1,1x1", "CMYK"],
  ["2x1,1x1,1x1,2x1", "YCCK"],
  ["2x2,1x1,1x1,2x2", "YCCK"],
];

/** Sizes that take the same number of MCUs share their data. */
function ofSizes(sampling: string, colors: Colors, sizes: number[][], eighths = 8) {
  const random = randomBytes(7);
  const made = new Map<string, { frame: Frame; rest: Buffer }>();
  const cases = sizes.map(([width, height]) => {
    const frame = frameOf(width, height, sampling);
    const key = `${frame.components[0].across} ${frame.components[0].down}`;
    if (!made.has(key)) {
      const file = write(noise(frame, random, { sparse: 6, ac: 120 }), undefined, { tables: typical });
      made.set(key, { frame, rest: file.subarray(2 + headerOf(frame).length, -2) });
    }
    const { frame: first, rest } = made.get(key)!;
    frame.components.forEach((component, c) => (component.data = first.components[c].data));
    const file = jpeg(...colorMarkers[colors], headerOf(frame), rest);
    return {
      name: `${width} by ${height} at ${eighths}/8`,
      file,
      eighths,
      expected: pictureOf(frame, { eighths, colors }),
    };
  });
  return alsoWithTrailer(cases);
}

describe.each(usual)("%s, %s", (sampling, colors) => {
  test("every width up to 70, and around 128 and 256", async () => {
    const widths = [...range(1, slow ? 50 : 70), ...range(62, 66), ...range(126, 130), ...range(254, 258)];
    await expectPictures(
      ofSizes(
        sampling,
        colors,
        widths.map(width => [width, 3]),
      ),
    );
  });

  test("every height up to 50", async () => {
    await expectPictures(
      ofSizes(
        sampling,
        colors,
        range(1, slow ? 34 : 50).map(height => [7, height]),
      ),
    );
  });

  test("at every scale", async () => {
    // From 8 on, no two scales give the same width.
    const widths = slow ? [9, 17, 40, 150] : [...range(8, 70), 150, 299, 600];
    await expectPictures(
      range(1, 7).flatMap(eighths =>
        ofSizes(
          sampling,
          colors,
          widths.map(width => [width, 1 + (width % 37)]),
          eighths,
        ),
      ),
    );
  });

  test("long rows", async () => {
    await expectPictures(
      ofSizes(
        sampling,
        colors,
        (slow ? [1025] : [511, 1025, 2049, 4097, 16385, 65500]).map(width => [width, 2]),
      ),
    );
  });
});

test("2x horizontal upsampling only blends a component that is more than 2 samples wide", async () => {
  // At 2/8, a width of 16 becomes 4 pixels, or 2 samples.
  for (const sampling of ["2x1,1x1,1x1", "1x2,1x1,1x1"]) {
    await expectPictures(
      [2, 3, 4].flatMap(eighths =>
        ofSizes(
          sampling,
          "RGB",
          range(8, 24).map(width => [width, 24]),
          eighths,
        ),
      ),
    );
  }
});
