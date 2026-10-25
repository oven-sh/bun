// A check of a very deep value ends in a RangeError wherever the stack ends, also where a part of the type is met for the first time.
// The next check of that type answers as if it were the first: a getter is read once, and a hole is refused.
import type { Schema } from "bun";
import { validate } from "bun:bundle";
import { changing, finish, handsBack, refuses, verdictOf } from "./check";

interface Probe {
  next?: Probe;
  alt?: Probe | null;
  x?: { m: number } & Schema.Strict;
  y?: unknown[] & Schema.Not<number[]>;
}
interface Deep {
  next?: Deep;
  alt?: Deep | null;
  x?: { n: number } & Schema.Strict;
  y?: unknown[] & Schema.Not<string[]>;
}

function deep(levels: number, throughAlt: number, innermost: unknown): unknown {
  let value = innermost;
  for (let level = 0; level < throughAlt; level++) value = { alt: value };
  for (let level = 0; level < levels; level++) value = { next: value };
  return value;
}

// A type of the same form says at how many levels the stack ends, so that `Deep` meets its last parts there for the first time.
let fits = 1;
let ends = 1 << 20;
if (verdictOf(() => validate<Probe>(deep(ends, 0, { x: { m: 1 }, y: ["a"] }))) === "threw RangeError") {
  while (ends - fits > 1) {
    const middle = (fits + ends) >> 1;
    if (verdictOf(() => validate<Probe>(deep(middle, 0, { x: { m: 1 }, y: ["a"] }))) === "accepted") fits = middle;
    else ends = middle;
  }
  for (let levels = ends + 40; levels > ends - 40 && levels > 0; levels--) {
    for (let throughAlt = 0; throughAlt < 4; throughAlt++) {
      if (verdictOf(() => validate<Deep>(deep(levels, throughAlt, { x: { n: 1 }, y: [1] }))) === "accepted") levels = 0;
    }
  }
}

refuses("a getter is judged by what it first answers", () => validate<Deep>({ x: changing("n", "not a number", 1) }));
handsBack("a getter is read once", { x: { n: 1 } }, () => validate<Deep>({ x: changing("n", 1, "not a number") }));
refuses("another member", () => validate<Deep>({ x: { n: 1, m: 1 } }));
refuses("a hole", () => validate<Deep>({ y: ["a", , "b"] }));
refuses("a list of texts", () => validate<Deep>({ y: ["a", "b"] }));
handsBack("a list that holds a number", { y: ["a", 1] }, () => validate<Deep>({ y: ["a", 1] }));

finish();
