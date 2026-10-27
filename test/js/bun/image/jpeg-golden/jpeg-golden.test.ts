// `Bun.Image` decodes and encodes JPEG as it did when it used libjpeg-turbo. See record.ts.
import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { encodeCases, load, observeDecodeCase, observeEncode, type DecodeCase } from "./observe";

beforeAll(() => {
  Bun.Image.backend = "bun";
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

const cases = await load<DecodeCase[]>(join(import.meta.dir, "cases.json.gz"));
const parts = 8;
test.each(Array.from({ length: parts }, (_, part) => part))("decodes files, whole and damaged (part %d)", async part => {
  const mine = cases.map((c, index) => ({ ...c, index })).filter(c => c.index % parts === part);
  const actual = await mapConcurrently(mine, c => observeDecodeCase(Buffer.from(c.data, "base64"), c.index));
  const differences = mine.flatMap((c, i) =>
    c.expected!.flatMap((expected, copy) =>
      actual[i][copy] === expected ? [] : [{ name: c.name, copy, expected, actual: actual[i][copy] }],
    ),
  );
  expect(differences).toEqual([]);
});

test("encodes pictures", async () => {
  const expected = await load<string[]>(join(import.meta.dir, "encoded.json.gz"));
  const pictures = encodeCases();
  const actual = await mapConcurrently(pictures, observeEncode);
  const differences = pictures.flatMap((c, i) => (actual[i] === expected[i] ? [] : [{ ...c, expected: expected[i], actual: actual[i] }]));
  expect(differences).toEqual([]);
});
