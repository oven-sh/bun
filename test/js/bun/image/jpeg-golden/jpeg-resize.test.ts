// resize() has the picture decoded at the smallest scale that is large enough.
import { expect, test } from "bun:test";
import { randomBytes } from "../png-golden/write";
import { difference, pictureFrom, pngOf, range, where } from "./decode";
import { pictureOf, scaled } from "./model";
import { frameOf, noise, segment, write } from "./write";

/** Says at how many eighths. */
function scaleFinder(width: number, height: number, before: Buffer[] = []) {
  const frame = noise(frameOf(width, height), randomBytes(9));
  const file = write(frame, undefined, { before });
  const atScale = range(1, 8).map(eighths => pngOf(pictureOf(frame, { eighths })));
  return async (change: (image: Bun.Image) => Bun.Image, same = change) => {
    const [actual, ...candidates] = await Promise.all([
      pictureFrom(change(new Bun.Image(file))),
      ...atScale.map(from => pictureFrom(same(new Bun.Image(from)))),
    ]);
    return range(1, 8)
      .filter(eighths => !difference(actual, candidates[eighths - 1]))
      .join();
  };
}
const scale = scaleFinder(40, 20);

test("in both directions", async () => {
  const byEighths = (length: number) =>
    Object.fromEntries(range(1, 8).map(e => [e, range(e > 1 ? scaled(length, e - 1) + 1 : 1, scaled(length, e))]));
  expect(await where(range(1, 40), width => scale(image => image.resize(width, 3)))).toEqual(byEighths(40));
  expect(await where(range(1, 20), height => scale(image => image.resize(5, height)))).toEqual(byEighths(20));
  expect(await scale(image => image.resize(20, 15))).toBe("6");
  expect(await scale(image => image.resize(30, 5))).toBe("6");
});

test("not if it is to be as large as it is, or larger, either way", async () => {
  for (const [width, height] of [
    [40, 20],
    [41, 3],
    [5, 21],
    [80, 40],
  ]) {
    expect([width, height, await scale(image => image.resize(width, height))]).toEqual([width, height, "8"]);
  }
});

test("a height that is left out is taken to be the width", async () => {
  expect(
    await scale(
      image => image.resize(10),
      image => image.resize(10, 5),
    ),
  ).toBe("4");
});

test("of scales that come to the same size, the largest", async () => {
  // 3 pixels are 3 at six eighths and more, 2 at three to five, and 1 below.
  const tiny = scaleFinder(3, 3);
  expect(await Promise.all([3, 2, 1].map(side => tiny(image => image.resize(side, side))))).toEqual(["8", "5", "2"]);
});

test("with the sides as they are after turning", async () => {
  expect(await scale(image => image.rotate(90).resize(10, 20))).toBe("4");
  expect(await scale(image => image.rotate(180).resize(20, 10))).toBe("4");
  const exif = segment(0xe1, "Exif\0\0MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0");
  const turned = scaleFinder(40, 20, [exif]);
  expect(
    await turned(
      image => image.resize(10, 20),
      image => image.rotate(90).resize(10, 20),
    ),
  ).toBe("4");
  expect(
    await turned(
      image => image.rotate(90).resize(20, 10),
      image => image.rotate(180).resize(20, 10),
    ),
  ).toBe("4");
});
