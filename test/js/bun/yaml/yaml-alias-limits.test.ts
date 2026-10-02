// Tests ported from https://github.com/eemeli/yaml/blob/v2.9.1/tests/doc/parse.ts and tests/doc/anchors.ts (ISC license)
// The fixtures in fixtures/pr104 are tests/artifacts/pr104 of the same tag.

import { YAML } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

// There: every error of the document has the code RESOURCE_EXHAUSTION.
function parseOrExhaust(src: string) {
  try {
    return YAML.parse(src);
  } catch (error) {
    expect(error).toBeInstanceOf(RangeError);
  }
}

describe("Resource exhaustion attacks", () => {
  describe("Excessive recursion", () => {
    test("Nested flow collections", () => {
      const depth = 5000;
      parseOrExhaust(repeat("[", depth) + "1" + repeat("]", depth));
    });

    test("excessive tag indicators", () => {
      // There: one error for each tag but the last.
      expect(() => YAML.parse(repeat("! ", 5000) + "a")).toThrow(SyntaxError);
    });

    test("excessive block sequence indicators", () => {
      parseOrExhaust(repeat("- ", 5000) + "b");
    });

    test("excessive empty lines in flow collection", () => {
      expect(YAML.parse("[[]" + repeat("\n", 150_000) + "]")).toEqual([[]]);
    });
  });

  describe("Excessive entity expansion attacks", () => {
    const root = resolve(import.meta.dir, "fixtures/pr104");
    const src1 = readFileSync(resolve(root, "case1.yml"), "utf8");
    const src2 = readFileSync(resolve(root, "case2.yml"), "utf8");
    const srcB = readFileSync(resolve(root, "billion-laughs.yml"), "utf8");
    const srcQ = readFileSync(resolve(root, "quadratic.yml"), "utf8");

    // There: "Limit count by default", which is 100.
    describe("Limit count at that package's default", () => {
      for (const [name, src] of [
        ["js-yaml case 1", src1],
        ["js-yaml case 2", src2],
        ["billion laughs", srcB],
        ["quadratic expansion", srcQ],
      ]) {
        test(name, () => {
          expect(() => YAML.parse(src, { maxAliasCount: 100 })).toThrow(/Excessive alias count/);
        });
      }
    });

    describe("Work sensibly even with disabled limits", () => {
      test("billion laughs", () => {
        const obj = YAML.parse(srcB, { maxAliasCount: -1 }) as object;
        expect(Object.keys(obj)).toHaveLength(9);
      });

      test("quadratic expansion", () => {
        const obj = YAML.parse(srcQ, { maxAliasCount: -1 }) as object;
        expect(Object.keys(obj)).toHaveLength(11);
      });
    });

    describe("maxAliasCount limits", () => {
      const rows = [
        "a: &a [lol, lol, lol, lol, lol, lol, lol, lol, lol]",
        "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
        "c: &c [*b, *b, *b, *b]",
        "d: &d [*c, *c]",
        "e: [*d]",
      ];

      for (const maxAliasCount of [0, 1]) {
        test(`depth 0: maxAliasCount ${maxAliasCount} passes`, () => {
          expect(() => YAML.parse(rows[0], { maxAliasCount })).not.toThrow();
        });

        test(`depth 1: maxAliasCount ${maxAliasCount} fails on first alias`, () => {
          const src = `${rows[0]}\nb: *a`;
          expect(() => YAML.parse(src, { maxAliasCount })).toThrow(ReferenceError);
        });
      }

      const limits = [10, 50, 150, 300];
      for (let i = 0; i < 4; ++i) {
        const src = rows.slice(0, i + 2).join("\n");

        test(`depth ${i + 1}: maxAliasCount ${limits[i] - 1} fails`, () => {
          expect(() => YAML.parse(src, { maxAliasCount: limits[i] - 1 })).toThrow(ReferenceError);
        });

        test(`depth ${i + 1}: maxAliasCount ${limits[i]} passes`, () => {
          expect(() => YAML.parse(src, { maxAliasCount: limits[i] })).not.toThrow();
        });
      }
    });
  });
});

describe("anchors", () => {
  test("resolution with maxAliasCount:0", () => {
    expect(() => YAML.parse("- &a 1\n- *a\n", { maxAliasCount: 0 })).toThrow(ReferenceError);
  });

  test("circular reference", () => {
    const src = "&A { <<: *A, B: b }\n";
    expect(() => YAML.parse(src, { maxAliasCount: 100 })).toThrow(ReferenceError);
    expect(() => YAML.parse(src, { maxAliasCount: 0 })).toThrow(ReferenceError);
  });

  test("merge pair of an alias", () => {
    const src = "[ &a1 { a: A }, { b: B, <<: *a1 } ]\n";
    expect(YAML.parse(src)).toMatchObject([{ a: "A" }, { a: "A", b: "B" }]);
    expect(() => YAML.parse(src, { maxAliasCount: 0 })).toThrow(ReferenceError);
  });
});
