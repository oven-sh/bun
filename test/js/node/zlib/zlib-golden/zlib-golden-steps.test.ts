// Sequences of writes, flushes, params() and reset(), with the bytes that they give and when. See record.ts.
// The results are those of zlib-ng 2.3.3.
import { expect, test } from "bun:test";
import { once } from "node:events";
import zlib from "node:zlib";
import { input } from "./inputs";
import {
  deflate,
  deflateDifferences,
  fewerIfSlow,
  inParts,
  loadCases,
  optionsOf,
  sample,
  type DeflateCase,
} from "./observe";

const cases = (await loadCases()).steps;

test("there is something to compress", () => {
  expect(cases.length).toBe(1800);
});

test.each(inParts(fewerIfSlow(cases, 5), 100))("part %#", some => {
  expect(deflateDifferences(some)).toBe("");
});

async function throughStream(c: DeflateCase) {
  const stream: any = new (zlib[c.mode] as any)(optionsOf(c));
  const [source, chunks] = [input(...c.source), [] as Buffer[]];
  const ended = once(stream, "end");
  const done = (start: (callback: () => void) => void) => Promise.race([ended, new Promise<void>(start)]);
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  let at = 0;
  for (const step of c.steps.split(" ")) {
    if (step === "r") stream.reset();
    else if (step[0] === "p") {
      const [level, strategy] = step.slice(1).split(",").map(Number);
      await done(callback => stream.params(level, strategy, callback));
    } else {
      const [length, flush] = step.split(":").map(Number);
      if (flush) await done(callback => stream.flush(flush, callback));
      else await done(callback => stream.write(source.subarray(at, (at += length)), callback));
    }
  }
  stream.end();
  await ended;
  return Buffer.concat(chunks);
}

test("a stream gives the same bytes", async () => {
  // It flushes and finishes in writes of their own, and does nothing for params() that change nothing.
  const forStream = (c: DeflateCase) => {
    let current = `p${c.options[0]},${c.options[1]}`;
    const steps = c.steps.split(" ").flatMap(step => {
      if (step[0] === "p") return step === current ? [] : [(current = step)];
      const [length, flush] = step.split(":");
      return flush ? [length, `0:${flush}`] : [step];
    });
    return { ...c, steps: [...steps, c.source[1]].join(" ") };
  };
  const some = fewerIfSlow(sample(cases, 12), 3)
    .filter(c => /^[^!P]+$/.test(c.steps))
    .map(forStream);
  expect(some.length).toBeGreaterThan(30);
  const actual = await Promise.all(some.map(throughStream));
  expect(some.filter((c, i) => !actual[i].equals(deflate(c).output))).toEqual([]);
});
