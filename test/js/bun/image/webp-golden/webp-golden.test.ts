// For these files and images, `Bun.Image` reads and writes WebP exactly as it did with libwebp 1.6.0: the same pixels,
// the same errors, the same bytes. record.ts says where the expected results come from.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  hash,
  isLarge,
  load,
  observeDecode,
  observeEncode,
  observeMetadata,
  type DecodeCase,
  type EncodeCase,
} from "./observe";

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
          decoded: decoded && (await observeDecode(file)),
        };
      }),
    );
    expect(actual).toEqual(cases.map(({ metadata, decoded }, index) => ({ index: start + index, metadata, decoded })));
  });

  // No encoder writes these coefficients. They overflow the 16-bit arithmetic of libwebp's SSE2 code but not its C code.
  test("coefficients that overflow 16 bits decode as in libwebp's C code", async () => {
    const cases = [
      {
        data: "UklGRkYAAABXRUJQVlA4IDkAAAC2AwCdASogAA8Az4BqhEgAC6D8uzfxihQIGdILRCzLeiAfSca+OAD183X3zflN//r1u///zfr2jX8A",
        decoded: { width: 32, height: 15, rgba: "ea6839333e4e3c49" },
      },
      {
        data: "UklGRk4AAABXRUJQVlA4IEEAAACwAwCdASoDgB8AEBB8AAAg2T2kiAuvP0TuFIUukKvoDLv+c0xPpjj/////hv///0w//////0X/nf///////////wA=",
        decoded: { width: 3, height: 31, rgba: "801a2168af43c85b" },
      },
      {
        data: "UklGRlIAAABXRUJQVlA4IEUAAABwAgCdASoCABKAD9jcAAAvjQUotBaLGGQScvXWIP//////////////1P///9D///////////+q///c////////////Zf8A",
        decoded: { width: 2, height: 18, rgba: "f4b4b6e4edb73358" },
      },
      {
        data: "UklGRlIAAABXRUJQVlA4IEYAAACQAgCdASoQgA9AAAB778/QAEB41q5QkG095ZO1wAD///////////////v///////+7/+3/////////////////////////",
        decoded: { width: 16, height: 15, rgba: "2e062002111ebc6d" },
      },
      {
        data: "UklGRlIAAABXRUJQVlA4IEYAAACQAgCdASoBwAFAADj2CBM3IJKlKUi2VpmXqCcPX4D///85/////////////2//////////////////////////////////",
        decoded: { width: 1, height: 1, rgba: "ad95131bc0b799c0" },
      },
    ];
    const actual = await Promise.all(cases.map(({ data }) => observeDecode(Buffer.from(data, "base64"))));
    expect(actual).toEqual(cases.map(({ decoded }) => decoded));
  });
});

describe("encode", () => {
  const large = encodeCases.filter(c => isLarge(c.image));
  const small = encodeCases.filter(c => !isLarge(c.image));

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

  test("an image that takes more than 500 cost intervals", async () => {
    const file = await Bun.file(join(import.meta.dir, "intervals.webp")).bytes();
    expect(hash(await new Bun.Image(file).webp({ lossless: true }).bytes())).toBe(hash(file));
  });
});
