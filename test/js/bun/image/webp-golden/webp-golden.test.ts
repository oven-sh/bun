// `Bun.Image` reads and writes WebP exactly as it did with libwebp 1.6.0: the same pixels, the same errors, the same
// bytes. record.ts says where the expected results come from.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { load, observeDecode, observeEncode, observeMetadata, type DecodeCase, type EncodeCase } from "./observe";

const decodeCases = await load<DecodeCase>(join(import.meta.dir, "decode.json.gz"));
const encodeCases = await load<EncodeCase>(join(import.meta.dir, "encode.json.gz"));

function batches<T>(cases: T[], size: number): [string, T[], number][] {
  const out: [string, T[], number][] = [];
  for (let start = 0; start < cases.length; start += size) {
    out.push([`${start}-${Math.min(start + size, cases.length) - 1}`, cases.slice(start, start + size), start]);
  }
  return out;
}

describe("decode", () => {
  test.concurrent.each(batches(decodeCases, 100))("cases %s", async (_, cases, start) => {
    const actual = await Promise.all(
      cases.map(async ({ data, decoded }, index) => {
        const file = Buffer.from(data, "base64");
        return {
          index: start + index,
          metadata: await observeMetadata(file),
          ...(decoded ? { decoded: await observeDecode(file) } : {}),
        };
      }),
    );
    expect(actual).toEqual(
      cases.map(({ metadata, decoded }, index) => ({
        index: start + index,
        metadata,
        ...(decoded ? { decoded } : {}),
      })),
    );
  });
});

describe("encode", () => {
  const large = encodeCases.filter(c => c.again !== undefined);
  const small = encodeCases.filter(c => c.again === undefined);

  test.concurrent.each(batches(small, 50))("cases %s", async (_, cases) => {
    const actual = await Promise.all(cases.map(async c => ({ ...c, ...(await observeEncode(c)) })));
    expect(actual).toEqual(cases);
  });

  test.concurrent.each(large.map(c => [JSON.stringify({ ...c.image, ...c.options }), c] as const))(
    "large image %s",
    async (_, c) => {
      expect({ ...c, ...(await observeEncode(c)) }).toEqual(c);
    },
  );
});
