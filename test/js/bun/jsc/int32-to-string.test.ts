import { describe, expect, test } from "bun:test";

// JSC keeps a 1024 slot cache of int32 -> string results. A value enters a
// slot on its second sighting there; a value seen once gets a fresh string
// and leaves the resident entry alone (oven-sh/WebKit#821). Every path below
// must give the exact digits whatever the cache holds.

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
  prefixed: n => ("id/" + n).slice(3),
  template: n => `${n}`,
  String: n => String(n),
  toString: n => n.toString(),
  "toString(10)": n => n.toString(10),
};

describe("int32 to string", () => {
  test("a monotonic counter, each value seen once", () => {
    let count = 5_000_000;
    for (let i = 0; i < 20_000; i++) {
      const expected = slowDigits(count);
      for (const name in paths) {
        expect(paths[name](count), name).toBe(expected);
      }
      count = (count + 1) | 0;
    }
  });

  test("values seen two and three times in the same slot", () => {
    for (let i = 0; i < 10_000; i++) {
      const n = 1_000_000 + (i & 255);
      const expected = slowDigits(n);
      expect("" + n).toBe(expected);
      expect("" + n).toBe(expected);
      expect("" + n).toBe(expected);
    }
  });

  test("edge values", () => {
    const edges = [1023, 1024, 1025, -1, -1024, -1025, 2147483647, -2147483648, 2147483646, -2147483647, 65536, -65536];
    for (let r = 0; r < 3; r++) {
      for (const n of edges) {
        const expected = slowDigits(n);
        for (const name in paths) {
          expect(paths[name](n), name).toBe(expected);
        }
      }
    }
  });

  test("two values that alternate", () => {
    for (let i = 0; i < 10_000; i++) {
      expect("" + 123456789).toBe("123456789");
      expect("" + 987654321).toBe("987654321");
      expect("" + 123456789).toBe("123456789");
      expect("" + 987654321).toBe("987654321");
    }
  });
});
