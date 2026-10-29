// `Bun.Image` decodes and encodes JPEG as it did when it used libjpeg-turbo. See record.ts and README.md.
//
// Serial on purpose: a test keeps other threads busy already, and the time goes into reading their results on this one.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { encodeCases, load, observeDecodeCase, observeEncode, type DecodeCase } from "./observe";

const defaultBackend = Bun.Image.backend;
beforeAll(() => {
  Bun.Image.backend = "bun";
});
afterAll(() => {
  Bun.Image.backend = defaultBackend;
});

/** Runs `run` on every item, several at a time: the work is done on other threads. */
async function mapConcurrently<T, R>(items: T[], run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    }),
  );
  return results;
}

/** Deals `items` out to `count` numbered parts that cost about the same. */
function inParts<T>(items: T[], count: number, costOf: (item: T) => number): [number, T[]][] {
  const parts = Array.from({ length: count }, () => ({ cost: 0, items: [] as T[] }));
  const priced = items.map(item => ({ item, cost: costOf(item) }));
  for (const { item, cost } of priced.sort((a, b) => b.cost - a.cost)) {
    const cheapest = parts.reduce((a, b) => (b.cost < a.cost ? b : a));
    cheapest.cost += cost;
    cheapest.items.push(item);
  }
  return parts.map((part, index) => [index, part.items]);
}

/** What one call of `Bun.Image` costs a debug build whatever the size of the image, in pixels. */
const call = 4000;

const files = await load<DecodeCase[]>(join(import.meta.dir, "cases.json.gz"));
const encoded = await load<string[]>(join(import.meta.dir, "encoded.json.gz"));
const pictures = encodeCases().map((c, index) => ({ ...c, expected: encoded[index] }));

test("the fixtures are whole", () => {
  expect({ files: files.length, pictures: pictures.length, encoded: encoded.length }).toEqual({
    files: 804,
    pictures: 364,
    encoded: 364,
  });
});

function costOfFile(c: DecodeCase): number {
  let cost = 0;
  for (const result of c.expected!.join(" ").split(" ")) {
    const [, width, height] = /^(\d+)x(\d+):/.exec(result) ?? [];
    cost += call + Number(width ?? 0) * Number(height ?? 0);
  }
  return cost;
}
test.each(inParts(files, 24, costOfFile))("decodes files, whole and damaged (part %d)", async (_, mine) => {
  const actual = await mapConcurrently(mine, c => observeDecodeCase(Buffer.from(c.data, "base64"), c.seed));
  const differences = mine.flatMap((c, i) =>
    Bun.deepEquals(actual[i], c.expected) ? [] : [{ name: c.name, expected: c.expected, actual: actual[i] }],
  );
  expect(differences).toEqual([]);
});

test.each(inParts(pictures, 4, c => call + c.width * c.height))("encodes pictures (part %d)", async (_, mine) => {
  const actual = await mapConcurrently(mine, observeEncode);
  const differences = mine.flatMap((c, i) => (actual[i] === c.expected ? [] : [{ ...c, actual: actual[i] }]));
  expect(differences).toEqual([]);
});
