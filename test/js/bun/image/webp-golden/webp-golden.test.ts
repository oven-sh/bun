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
  test.each(batches(decodeCases, 100))("cases %s", async (_, cases, start) => {
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
        data: "UklGRnAAAABXRUJQVlA4IGMAAACSBACdASovwByAD9IUCAAcby/Yz2lm0eUo8eq51tFU780F4Be3dlEutruJ7cagDgAAGwAAAwAAJ53SUqnfXa6vkrMM55Em////////////////////7//////////////1/ncA",
        decoded: { width: 47, height: 28, rgba: "0af0ea6c72c50e79" },
      },
      {
        data: "UklGRoYAAABXRUJQVlA4IHoAAAByAwCdASoxQA9AQASsBAALxuief+JlpCePqrdA3dHg6jD3pkVgUQAAUv+S/////////////////0Gb////+v////9h/////+D//////////////9n/////N/////////8a////////////////////////Tv//////7w==",
        decoded: { width: 49, height: 15, rgba: "a935dbefef375a5c" },
      },
      {
        data: "UklGRo4AAABXRUJQVlA4IIIAAADwBgCdASo9QBGAEAAj95Y9K8wABngD+b7Utn212ydw8w2U6zn3tjPWHh2ZEvPfX+BXBoEaYMl+DKmOBT976tRwAOb//////////////////////////////////5T////E/////////////////////////x3///9h///////s//9K",
        decoded: { width: 61, height: 17, rgba: "4c397305791f56c1" },
      },
      {
        data: "UklGRpgAAABXRUJQVlA4IIwAAAAQBgCdASoPgDNAHoAaCAAfM8zysLrwJANObdKSp8dQx0qBsb+tIE5rmyXnXW14EdMW+YCvYUnyF2AAKL//yf//8///////////+v///////////////////////////xX/////////////////////////7f//////////////////////////////OQ==",
        decoded: { width: 15, height: 51, rgba: "a5bd7904915f508b" },
      },
    ];
    const actual = await Promise.all(cases.map(({ data }) => observeDecode(Buffer.from(data, "base64"))));
    expect(actual).toEqual(cases.map(({ decoded }) => decoded));
  });

  // libwebp refuses these since 1844042d, after 1.6.0: the first byte is the boolean decoder's value, which stays below 255.
  test("a partition that starts with 0xff is refused", async () => {
    const file = Buffer.from(
      "UklGRlIAAABXRUJQVlA4IEYAAACQAgCdASoBwAFAADj2CBM3IJKlKUi2VpmXqCcPX4D///85/////////////2//////////////////////////////////",
      "base64",
    );
    expect(await observeMetadata(file)).toEqual({ width: 1, height: 1, format: "webp" });
    expect(await observeDecode(file)).toEqual({ error: "ERR_IMAGE_DECODE_FAILED" });
  });
});

describe("encode", () => {
  const large = encodeCases.filter(c => isLarge(c.image));
  const small = encodeCases.filter(c => !isLarge(c.image));

  test.each(batches(small, 50))("cases %s", async (_, cases) => {
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
