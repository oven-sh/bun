// With resize(), the image is decoded at the smallest scale that is large enough.
import { expect, test } from "bun:test";
import { slow } from "../png-golden/check";
import { randomBytes } from "../png-golden/write";
import { difference, expectPictures, grouped, pictureFrom, pngOf, range } from "./decode";
import { pictureOf, scaled } from "./model";
import { coded, frameOf, headerOf, jpeg, noise, scanOf, segment, typical, write } from "./write";

/** The result says at how many eighths the image was decoded. */
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

test("the scale covers both the width and the height", async () => {
  const byEighths = (length: number) =>
    Object.fromEntries(range(1, 8).map(e => [e, range(e > 1 ? scaled(length, e - 1) + 1 : 1, scaled(length, e))]));
  expect(await grouped(range(1, 40), width => scale(image => image.resize(width, 3)))).toEqual(byEighths(40));
  expect(await grouped(range(1, 20), height => scale(image => image.resize(5, height)))).toEqual(byEighths(20));
  expect(await scale(image => image.resize(20, 15))).toBe("6");
  expect(await scale(image => image.resize(30, 5))).toBe("6");
});

test("full scale if the width or the height does not shrink", async () => {
  for (const [width, height] of [
    [40, 20],
    [41, 3],
    [5, 21],
    [80, 40],
  ]) {
    expect([width, height, await scale(image => image.resize(width, height))]).toEqual([width, height, "8"]);
  }
});

test("without a height, the width counts for both", async () => {
  expect(
    await scale(
      image => image.resize(10),
      image => image.resize(10, 5),
    ),
  ).toBe("4");
});

test("the largest of the scales that give the same size", async () => {
  // 3 pixels stay 3 from 6/8 on, and become 2 from 3/8 to 5/8, and 1 below.
  const tiny = scaleFinder(3, 3);
  expect(await Promise.all([3, 2, 1].map(side => tiny(image => image.resize(side, side))))).toEqual(["8", "5", "2"]);
});

test("rotate() and the EXIF orientation swap the sides", async () => {
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

test("sides of 65472 pixels", async () => {
  // Eight times the same block take whole bytes.
  const [one, eight] = [noise(frameOf(8, 8), randomBytes(3), { dc: 0, sparse: 4 }), frameOf(64, 8)];
  for (let i = 0; i < 8; i++) eight.components[0].data.set(one.components[0].data, i * 64);
  const { header, data } = coded(eight, scanOf([0]), typical);
  const blocks = 8184;
  const of = (width: number, height: number) =>
    jpeg(headerOf({ ...one, width, height }), header, Buffer.alloc((data.length * blocks) / 8, data));
  const [wide, tall] = [of(blocks * 8, 8), of(8, blocks * 8)];
  await expectPictures(
    (slow ? [1, 7] : range(1, 8)).flatMap(eighths => {
      const [{ rgba }, row, long] = [pictureOf(one, { eighths }), eighths * 4, blocks * eighths];
      const rows = range(0, eighths - 1).map(y => Buffer.alloc(blocks * row, rgba.subarray(y * row, (y + 1) * row)));
      return [
        { file: wide, expected: { width: long, height: eighths, rgba: Buffer.concat(rows) } },
        { file: tall, expected: { width: eighths, height: long, rgba: Buffer.alloc(blocks * rgba.length, rgba) } },
      ].map(both => ({ ...both, eighths, name: `${both.expected.width} by ${both.expected.height}` }));
    }),
  );
});
