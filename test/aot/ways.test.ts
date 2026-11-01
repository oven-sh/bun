// harness/ways.ts says why.
import { expect, test } from "bun:test";
import { partOfGrid, waysFor } from "./harness/ways";

const ways = ["as one program", "in layers", "from disk"];

test("the witness of a family runs in every way, the others in the first", () => {
  expect([0, 1, 2].map(index => waysFor(ways, index === 2, false))).toEqual([[ways[0]], [ways[0]], ways]);
});

test("a file that names no witness does not load", () => {
  // @ts-expect-error
  expect(() => waysFor(ways)).toThrow("say which case is the witness");
  // @ts-expect-error: the place of a case in its table was taken for that once.
  expect(() => waysFor(ways, 0)).toThrow("say which case is the witness");
});

test("a bench runs every case in every way", () => {
  expect([false, true].map(isWitness => waysFor(ways, isWitness, true))).toEqual([ways, ways]);
  expect(partOfGrid("a grid", ways, 3, it => it, 20_000, true)).toEqual(ways);
});

test("as many days as a grid has parts run each of its cases once", () => {
  const cases = Array.from({ length: 300 }, (_, index) => `case ${index}`);
  const parts = [20_000, 20_001, 20_002, 20_003, 20_004].map(day =>
    partOfGrid("of 300", cases, 5, it => it, day, false),
  );
  expect(parts.flat().sort()).toEqual([...cases].sort());
  for (const part of parts) expect(part.length).toBeWithin(30, 91);
  expect(partOfGrid("of 300", cases, 5, it => it, 20_000, false)).toEqual(parts[0]);
});
