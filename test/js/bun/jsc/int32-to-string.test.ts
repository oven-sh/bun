import { describe, expect, test } from "bun:test";

// JSC keeps a 1024 slot cache of int32 -> string results. Each slot holds a
// JSString for the JS-visible paths and a String for Array.prototype.join,
// under separate keys (oven-sh/WebKit#821). Every path below must give the
// exact digits whatever the cache holds.

function slowDigits(n: number): string {
  const negative = n < 0;
  let m = negative ? -n : n;
  let s = "";
  do {
    s = String.fromCharCode(48 + (m % 10)) + s;
    m = Math.floor(m / 10);
  } while (m);
  return negative ? "-" + s : s;
}

const paths: Record<string, (n: number) => string> = {
  concat: n => "" + n,
  join: n => [n].join(""),
  prefixed: n => ("id/" + n).slice(3),
  template: n => `${n}`,
  String: n => String(n),
  toString: n => n.toString(),
  "toString(10)": n => n.toString(10),
};

function run(path: (n: number) => string, values: number[]): string[] {
  const out: string[] = [];
  for (const n of values) out.push(path(n));
  return out;
}

describe("int32 to string", () => {
  test("a monotonic counter, each value seen once", () => {
    const values: number[] = [];
    let count = 5_000_000;
    for (let i = 0; i < 20_000; i++) {
      values.push(count);
      count = (count + 1) | 0;
    }
    const expected = values.map(slowDigits);
    for (const name in paths) {
      expect(run(paths[name], values), name).toEqual(expected);
    }
  });

  test("values seen two and three times in the same slot", () => {
    const values: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const n = 1_000_000 + (i & 255);
      values.push(n, n, n);
    }
    expect(run(paths.concat, values)).toEqual(values.map(slowDigits));
  });

  test("edge values", () => {
    const edges = [1023, 1024, 1025, -1, -1024, -1025, 2147483647, -2147483648, 2147483646, -2147483647, 65536, -65536];
    const values = [...edges, ...edges, ...edges];
    const expected = values.map(slowDigits);
    for (const name in paths) {
      expect(run(paths[name], values), name).toEqual(expected);
    }
  });

  test("two values that alternate in one slot", () => {
    // Slot = intHash(n) & 1023 (WTF/HashFunctions.h). 123456789 and 123458614 both land in slot 74,
    // so each conversion evicts the other.
    const values: number[] = [];
    for (let i = 0; i < 10_000; i++) values.push(123456789, 123458614);
    const expected = values.map(n => (n === 123456789 ? "123456789" : "123458614"));
    expect(run(paths.concat, values)).toEqual(expected);
    expect(run(paths.join, values)).toEqual(expected);
  });

  test("a GC between a fill and a hit", () => {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(7_000_000 + i);
    const expected = values.map(slowDigits);
    for (let round = 0; round < 5; round++) {
      for (const name in paths) {
        expect(run(paths[name], values), name).toEqual(expected);
      }
      Bun.gc(true);
    }
  });
});
