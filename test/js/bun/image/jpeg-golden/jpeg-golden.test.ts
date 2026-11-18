// JPEG files of every kind the format has, well formed and damaged, with what Bun.Image made of each one when it was
// recorded. See record.ts. By the start of a case's name:
//   libjpeg-turbo/  test files of libjpeg-turbo, which are the Independent JPEG Group's and under its license
//   damaged/        small ones of the others with bytes changed, some for each thing djpeg had to say about such a file
//   limit/          decoded with a `maxPixels`
//   by-hand/        put together bit by bit
// The others are named by the program that wrote them, from a picture made for this test, and by what it was told.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { differences } from "../../archive-golden/observe";
import { differentInTarget } from "../png-golden/check";
import { loadCases } from "../png-golden/observe";
import { withTrailer } from "./decode";
import { scaled } from "./model";
import { observable, type Cases } from "./observe";

const recorded = await loadCases<Cases>(join(import.meta.dir, "cases.json.gz"));
const cases = { ...observable(recorded), "decode with a trailer": observable(recorded, withTrailer).decode };

describe.each([
  ["decode", 973],
  ["decode with a trailer", 973],
  ["scale", 1290],
  ["encode", 229],
] as const)("Bun.Image reads and writes JPEG the way it was recorded to: %s", (kind, count) => {
  test("all cases are there", () => {
    expect(cases[kind].length).toBe(count);
  });

  test.each(Array.from({ length: Math.ceil(count / 500) }, (_, i) => i * 500))("from case %i on", async first => {
    const results = await Promise.all(
      cases[kind].slice(first, first + 500).map(async ({ name, recorded, observe }) => ({
        index: name,
        expected: recorded.result,
        actual: await observe(),
      })),
    );
    expect(differences(results)).toBe("");
  });
});

describe("into a target", () => {
  const files = new Map(recorded.decode.map(c => [c.name, Buffer.from(c.data, "base64")]));

  test("decode", async () => {
    const images = recorded.decode.map(({ name, maxPixels }) => ({
      name,
      open: () => new Bun.Image(files.get(name)!, { maxPixels }),
    }));
    expect(await differentInTarget(images)).toEqual({ decoded: 802, refused: 80, different: [] });
  });

  test("scale", async () => {
    const images = recorded.scale.map(({ source, eighths }) => ({
      name: `${source} at ${eighths}`,
      async open() {
        const image = new Bun.Image(files.get(source)!);
        const { width, height } = await image.metadata();
        return image.resize(scaled(width, eighths), scaled(height, eighths), { fit: "fill" });
      },
    }));
    expect(await differentInTarget(images)).toEqual({ decoded: 1290, refused: 0, different: [] });
  });
});
