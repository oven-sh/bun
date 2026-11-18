// Made-up data with the bytes that it is compressed to in one go, for all kinds of settings. See record.ts.
// The results are those of zlib-ng 2.3.3.
import { expect, test } from "bun:test";
import zlib from "node:zlib";
import { input } from "./inputs";
import { deflate, deflateDifferences, fewerIfSlow, inParts, loadCases, optionsOf, sample } from "./observe";

const cases = (await loadCases()).whole;

test("there is something to compress", () => {
  expect(cases.length).toBe(1123);
});

test.each(inParts(fewerIfSlow(cases, 5), 60))("part %#", some => {
  expect(deflateDifferences(some)).toBe("");
});

test("the functions for a whole buffer give the same bytes", async () => {
  const names = { Deflate: "deflate", DeflateRaw: "deflateRaw", Gzip: "gzip" } as const;
  for (const c of fewerIfSlow(sample(cases, 20), 3)) {
    const [source, options] = [input(...c.source), optionsOf(c)];
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    zlib[names[c.mode]](source, options, (error, result) => (error ? reject(error) : resolve(result)));
    expect(zlib[`${names[c.mode]}Sync`](source, options).equals(deflate(c).output)).toBe(true);
    // These write first and finish then.
    expect((await promise).equals(deflate({ ...c, steps: `${source.length}` }).output)).toBe(true);
  }
});

test("so do Bun.deflateSync() and Bun.gzipSync(), which have room for all of the output", () => {
  const some = cases.filter(c => c.mode !== "Deflate" && c.options[2] === 15 && !c.dictionary);
  for (const c of fewerIfSlow(sample(some, 4), 3)) {
    const [level, strategy, windowBits, memLevel] = c.options;
    const { source, output } = deflate({ ...c, options: [level, strategy, windowBits, memLevel, 1 << 18] });
    const compress = c.mode === "Gzip" ? Bun.gzipSync : Bun.deflateSync;
    expect(output.equals(compress(source, { level, strategy, memLevel } as any))).toBe(true);
  }
});
