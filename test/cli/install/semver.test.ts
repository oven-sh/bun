// The ISC License

// Copyright (c) Isaac Z. Schlueter and Contributors

// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.

// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
// IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import { semverIntersects } from "bun:internal-for-testing";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import nodeSemver from "semver";
import { unsortedPrereleases } from "./semver-fixture.js";
const { satisfies, order } = Bun.semver;

// Replay a failure of a seeded differential with BUN_SEMVER_FUZZ_SEED=<seed>. Soak with BUN_SEMVER_FUZZ_ITERS=<n>.
function seededRandom() {
  const seed = Number(process.env.BUN_SEMVER_FUZZ_SEED ?? 0x73656d76) >>> 0;
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  // node-semver needs about 20 ms for each range in a debug build.
  const iterations = (release: number) =>
    Number(process.env.BUN_SEMVER_FUZZ_ITERS ?? (isDebug || isASAN ? 20 : release));
  return { seed, next, pick, iterations };
}

function testSatisfiesExact(left: any, right: any, expected: boolean) {
  expect(satisfies(left, right)).toBe(expected);
  expect(satisfies(right, left)).toBe(expected);
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  expect(satisfies(leftBuffer, rightBuffer)).toBe(expected);
  expect(satisfies(rightBuffer, leftBuffer)).toBe(expected);
  expect(satisfies(leftBuffer, right)).toBe(expected);
  expect(satisfies(right, leftBuffer)).toBe(expected);
  expect(satisfies(left, rightBuffer)).toBe(expected);
  expect(satisfies(rightBuffer, left)).toBe(expected);
}

function testSatisfies(right: any, left: any, expected: boolean) {
  expect(satisfies(left, right)).toBe(expected);
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  expect(satisfies(leftBuffer, rightBuffer)).toBe(expected);
  expect(satisfies(leftBuffer, right)).toBe(expected);
  expect(satisfies(left, rightBuffer)).toBe(expected);
}

function testSatisfiesTable(cases: [version: string, range: string, expected: boolean][]) {
  expect(cases.map(([version, range]) => ({ version, range, satisfies: satisfies(version, range) }))).toEqual(
    cases.map(([version, range, expected]) => ({ version, range, satisfies: expected })),
  );
}

const u64Max = "18446744073709551615";
// u64::MAX + 1, then 20 and 30 digits: the answer must not depend on the length.
const numbersAboveU64Max = ["18446744073709551616", Buffer.alloc(20, "9").toString(), Buffer.alloc(30, "9").toString()];

function versionsWith(big: string) {
  return [
    `${big}.0.0`,
    `1.${big}.0`,
    `1.0.${big}`,
    `v1.0.${big}`,
    `1.0.${big}-beta.1`,
    `1.0.${big}+build`,
    `${big}.${big}.${big}`,
  ];
}

test("Bun.semver is a plain object of two functions", () => {
  expect(Object.getPrototypeOf(Bun.semver)).toBe(Object.prototype);
  expect(Bun.semver).toBe(Bun.semver);
  expect(
    Object.entries(Object.getOwnPropertyDescriptors(Bun.semver)).map(([key, { value, ...attributes }]) => ({
      key,
      name: value.name,
      length: value.length,
      ...attributes,
    })),
  ).toEqual([
    { key: "satisfies", name: "satisfies", length: 2, writable: true, enumerable: true, configurable: true },
    { key: "order", name: "order", length: 2, writable: true, enumerable: true, configurable: true },
  ]);
});

test.each(["order", "satisfies"] as const)("Bun.semver.%s converts its arguments to strings, left to right", name => {
  const log: string[] = [];
  const stringLike = (label: string, value: string) => ({
    toString() {
      log.push(label);
      return value;
    },
  });
  const equal = name === "order" ? 0 : true;
  expect(Bun.semver[name](stringLike("left", "1.2.3"), stringLike("right", "1.2.3"))).toBe(equal);
  expect(log).toEqual(["left", "right"]);
  expect(Bun.semver[name](new String("1.2.3"), ["1.2.3"] as any)).toBe(equal);
  expect(() =>
    Bun.semver[name](
      {
        toString() {
          throw new RangeError("left");
        },
      },
      stringLike("right", "1.2.3"),
    ),
  ).toThrow(expect.objectContaining({ name: "RangeError", message: "left" }));
  expect(log).toEqual(["left", "right"]);
});

describe("Bun.semver.order()", () => {
  test("an argument that is left out is undefined", () => {
    for (const args of [[], ["1.2.3"]] as any[]) {
      expect(() => order(...(args as [string, string]))).toThrow(
        expect.objectContaining({ name: "Error", message: "Invalid SemVer: undefined\n" }),
      );
    }
  });

  test("whitespace bug fix", () => {
    expect(
      order(
        `1.2.3`,
        `
1.2.3`,
      ),
    ).toBe(0);
    expect(
      order(
        `1.2.3`,
        `\t
1.2.3`,
      ),
    ).toBe(0);
    expect(order("1.2.3", " 1.2.3")).toBe(0);
    expect(order(`\n\t1.2.3`, " 1.2.3")).toBe(0);
    expect(order(`\r\t\n\r1.2.3`, " 1.2.3")).toBe(0);
  });
  // https://github.com/npm/node-semver/blob/14d263faa156e408a033b9b12a2f87735c2df42c/test/fixtures/comparisons.js#L4
  test("comparisons", () => {
    var tests = [
      ["0.0.0", "0.0.0-foo"],
      ["0.0.1", "0.0.0"],
      ["1.0.0", "0.9.9"],
      ["0.10.0", "0.9.0"],
      ["0.99.0", "0.10.0"],
      ["2.0.0", "1.2.3"],
      ["v0.0.0", "0.0.0-foo"],
      ["v0.0.1", "0.0.0"],
      ["v1.0.0", "0.9.9"],
      ["v0.10.0", "0.9.0"],
      ["v0.99.0", "0.10.0"],
      ["v2.0.0", "1.2.3"],
      ["0.0.0", "v0.0.0-foo"],
      ["0.0.1", "v0.0.0"],
      ["1.0.0", "v0.9.9"],
      ["0.10.0", "v0.9.0"],
      ["0.99.0", "v0.10.0"],
      ["2.0.0", "v1.2.3"],
      ["1.2.3", "1.2.3-asdf"],
      ["1.2.3", "1.2.3-4"],
      ["1.2.3", "1.2.3-4-foo"],
      ["1.2.3-5-foo", "1.2.3-5"],
      ["1.2.3-5", "1.2.3-4"],
      ["1.2.3-5-foo", "1.2.3-5-Foo"],
      ["3.0.0", "2.7.2+asdf"],
      ["1.2.3-a.10", "1.2.3-a.5"],
      ["1.2.3-a.b", "1.2.3-a.5"],
      ["1.2.3-a.b", "1.2.3-a"],
      ["1.2.3-a.b.c.10.d.5", "1.2.3-a.b.c.5.d.100"],
      ["1.2.3-r2", "1.2.3-r100"],
      ["1.2.3-r100", "1.2.3-R2"],
      ["1.0.0-pre.a.b", "1.0.0-pre.a"],
      ["1.0.0-alpha.22-alpha.jkwejf334jkj43", "1.0.0-alpha.3"],
      ["1.0.0-alpha.1beta", "1.0.0-alpha.2"],
    ];
    for (const [left, right] of tests) {
      expect(order(left, right)).toBe(1);
      expect(order(right, left)).toBe(-1);
      expect(order(left, left)).toBe(0);
      expect(order(right, right)).toBe(0);
    }
  });

  // not supported by semver, but supported by Bun
  test.each([
    ["0", "0.0"],
    ["1", "1.0"],
    ["1.2", "1.2.0"],
    ["1.x", "1.0.x"],
    ["1.x.x", "1.0.x"],
    ["2.x", "1.x"],
    ["2.x", "2.1"],
    ["2", "1"],
    ["3.*", "3.1"],
    ["3.2.*", "3.2.0"],
    ["4294967295.4294967295.x", "4294967295.4294967295.4294967294"],
    ["*", "4294967295.4294967295.4294967294"],
  ])('loose compare("%s", "%s")', (left, right) => {
    expect(order(left, right)).toBe(1);
    expect(order(right, left)).toBe(-1);
    expect(order(left, left)).toBe(0);
    expect(order(right, right)).toBe(0);
  });

  test("equality", () => {
    // https://github.com/npm/node-semver/blob/14d263faa156e408a033b9b12a2f87735c2df42c/test/fixtures/equality.js#L3
    var tests = [
      ["1.2.3", "v1.2.3"],
      ["1.2.3", "=1.2.3"],
      ["1.2.3", "v 1.2.3"],
      ["1.2.3", "= 1.2.3"],
      ["1.2.3", " v1.2.3"],
      ["1.2.3", " =1.2.3"],
      ["1.2.3", " v 1.2.3"],
      ["1.2.3", " = 1.2.3"],
      ["1.2.3-0", "v1.2.3-0"],
      ["1.2.3-0", "=1.2.3-0"],
      ["1.2.3-0", "v 1.2.3-0"],
      ["1.2.3-0", "= 1.2.3-0"],
      ["1.2.3-0", " v1.2.3-0"],
      ["1.2.3-0", " =1.2.3-0"],
      ["1.2.3-0", " v 1.2.3-0"],
      ["1.2.3-0", " = 1.2.3-0"],
      ["1.2.3-1", "v1.2.3-1"],
      ["1.2.3-1", "=1.2.3-1"],
      ["1.2.3-1", "v 1.2.3-1"],
      ["1.2.3-1", "= 1.2.3-1"],
      ["1.2.3-1", " v1.2.3-1"],
      ["1.2.3-1", " =1.2.3-1"],
      ["1.2.3-1", " v 1.2.3-1"],
      ["1.2.3-1", " = 1.2.3-1"],
      ["1.2.3-beta", "v1.2.3-beta"],
      ["1.2.3-beta", "=1.2.3-beta"],
      ["1.2.3-beta", "v 1.2.3-beta"],
      ["1.2.3-beta", "= 1.2.3-beta"],
      ["1.2.3-beta", " v1.2.3-beta"],
      ["1.2.3-beta", " =1.2.3-beta"],
      ["1.2.3-beta", " v 1.2.3-beta"],
      ["1.2.3-beta", " = 1.2.3-beta"],
      ["1.2.3-beta+build", " = 1.2.3-beta+otherbuild"],
      ["1.2.3+build", " = 1.2.3+otherbuild"],
      ["1.2.3-beta+build", "1.2.3-beta+otherbuild"],
      ["1.2.3+build", "1.2.3+otherbuild"],
      ["  v1.2.3+build", "1.2.3+otherbuild"],

      ["1.1.1-next.0 ", "1.1.1-next.0    "],
      ["1.1.1-next.0.a ", "1.1.1-next.0.a    "],
      ["1.1.1-next.0.a+abc ", "1.1.1-next.0.a+jkejf    "],
    ];

    for (const [left, right] of tests) {
      expect(order(left, right)).toBe(0);
      expect(order(right, left)).toBe(0);
    }
  });

  test("a major, minor or patch number above u64::MAX is an invalid version", () => {
    // These used to read the number as 0, so "1.0.18446744073709551616" compared equal to "1.0.0".
    // node-semver throws "Invalid patch version" (its limit is Number.MAX_SAFE_INTEGER).
    for (const big of numbersAboveU64Max) {
      for (const version of versionsWith(big)) {
        expect(() => order(version, "1.0.0")).toThrow(`Invalid SemVer: ${version}\n`);
        expect(() => order("1.0.0", version)).toThrow(`Invalid SemVer: ${version}\n`);
      }
      // order() accepts a wildcard, but not such a number after it.
      expect(() => order(`1.x.${big}`, "1.0.0")).toThrow(`Invalid SemVer: 1.x.${big}\n`);
    }

    // u64::MAX itself still fits.
    expect(order(`1.0.${u64Max}`, "1.0.0")).toBe(1);
    expect(order(`1.${u64Max}.0`, `1.0.${u64Max}`)).toBe(1);
    expect(order(`${u64Max}.${u64Max}.${u64Max}`, `${u64Max}.${u64Max}.${u64Max}`)).toBe(0);
  });

  test.each([
    // a wildcard glued to a number: "2x" used to be "2.x"
    ...["2x", "v2x", "1.2x", "1.2*", "1.2.3x", "10X"],
    `${u64Max}x`,
    `${numbersAboveU64Max[0]}x`,
    // text that no number or wildcard could be read from: these used to be "*"
    ...["^1.0.0", "|1.0.0", "#1", "&", "%", "!"],
  ])("%j is an invalid version", version => {
    expect(() => order(version, "1.0.0")).toThrow(`Invalid SemVer: ${version}\n`);
    expect(() => order("1.0.0", version)).toThrow(`Invalid SemVer: ${version}\n`);
  });

  test("a '-' in build metadata belongs to the build metadata", () => {
    // "1.0.0+build-1" used to be read as the prerelease "1.0.0-1".
    expect(order("1.0.0+build-1", "1.0.0")).toBe(0);
    expect(order("1.0.0+build-1", "1.0.0-1")).toBe(1);
    expect(order("1.0.0+a-b.c-d", "1.0.0+x")).toBe(0);
    expect(order("1.0.0-rc.1+build-2", "1.0.0-rc.1")).toBe(0);
    expect(order("1.0.0-rc-1+build-2", "1.0.0-rc-1")).toBe(0);
    expect(order("1.0.0-rc.1+build-2", "1.0.0-rc.2")).toBe(-1);
  });
});

describe("Bun.semver.satisfies()", () => {
  test("expected errors", () => {
    expect(satisfies).toBeInstanceOf(Function);
    // An argument that is left out is `undefined`, so the string "undefined": not a version, and a range with no
    // parseable part, which behaves like "*".
    // @ts-expect-error
    expect(satisfies()).toBe(false);
    // @ts-expect-error
    expect(satisfies("1.2.3")).toBe(true);
    for (const range of [undefined, null, "undefined", "latest"] as any[]) expect(satisfies("1.2.3", range)).toBe(true);
    expect(satisfies(undefined as any, "1.2.3")).toBe(false);
    // @ts-expect-error
    expect(satisfies("1.2.3", "1.2.3", "blah")).toBeTrue();
    expect(() => {
      satisfies(Symbol.for("~1.2.3"), "1.2.3");
    }).toThrow("Cannot convert a symbol to a string");
    expect(() => {
      satisfies(Symbol.for("~1.2.3"), Symbol.for("1.2.3"));
    }).toThrow("Cannot convert a symbol to a string");
    expect(() => {
      satisfies("~1.2.3", Symbol.for("1.2.3"));
    }).toThrow("Cannot convert a symbol to a string");
  });

  test("failures does not cause weird memory issues", () => {
    for (let i = 0; i < 1e5; i++) {
      if (!satisfies("1.2.3", "1.2.3")) {
        expect().fail("Expected true");
      }

      if (satisfies("^2.2.3||lol||!!#4_", "1.2.3")) {
        expect().fail("Expected false");
      }

      if (satisfies("^1.2.3||lol||!!#4_", "+!+!+!_)31231.2.3")) {
        expect().fail("Expected false");
      }

      if (!satisfies("1.2.3", "^1.2.3")) {
        expect().fail("Expected true");
      }

      if (satisfies("^1.2.3", "1.2.3")) {
        expect().fail("Expected false");
      }
    }
    Bun.gc(true);
  }, 30_000);

  test("exact versions", () => {
    testSatisfiesExact("1.2.3", "1.2.3", true);
    testSatisfiesExact("4", "4", false);
    testSatisfiesExact("4.0.0", "4.0.0", true);
    testSatisfiesExact("4.0", "4.0", false);
    testSatisfiesExact("5.0.0-beta.1", "5.0.0-beta.1", true);
    testSatisfiesExact("5.0.0-beta.1", "5.0.0-beta.2", false);
    testSatisfiesExact("5.0.0-beta.1", "5.0.0-beta.0", false);
    testSatisfiesExact("5.0.0-beta.1", "5.0.0-beta", false);
    testSatisfiesExact("5.0.0-beta.1", "5.0.0", false);
  });

  test("long version components are not treated as wildcards", () => {
    // A component >20 bytes must parse to its numeric value (or make the range match nothing on
    // overflow), not fall through to a wildcard. node-semver loose mode agrees with all of these.
    const twenty = Buffer.alloc(20, "9").toString();
    const twentyOne = Buffer.alloc(21, "9").toString();
    for (const big of [twenty, twentyOne]) {
      testSatisfies("^" + big, "1.0.0", false);
      testSatisfies("^" + big, "5.0.0", false);
      testSatisfies("~" + big, "1.0.0", false);
      testSatisfies("~" + big, "5.0.0", false);
      testSatisfies("~1." + big, "2.0.0", false);
    }
    // 31 bytes but value 5: must be Some(5), not wildcard and not Some(0).
    const padded = Buffer.alloc(30, "0").toString() + "5";
    testSatisfies("^" + padded, "5.2.0", true);
    testSatisfies("^" + padded, "0.5.0", false);
    testSatisfies("^" + padded, "6.0.0", false);
  });

  describe("> with a partial version starts at the next major or minor", () => {
    // node-semver reads `>1` as `>=2.0.0` and `>1.2` as `>=1.3.0`. Where a second comparator
    // names a prerelease of that bound, the prerelease rule alone does not reject the version.
    // Every expectation is the answer of npm's semver 7.7.4.
    const rows: [range: string, version: string, expected: boolean][] = [
      [">1 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">=2.0.0-rc.0 >1", "2.0.0-rc.1", false],
      ["> 1 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">v1 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1.x >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1.* >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1.x.x >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1 <=2.0.0-rc.5", "2.0.0-rc.1", false],
      ["<=2.0.0-rc.5 >1", "2.0.0-rc.1", false],
      [">1 ^2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1 ~2.0.0-rc.0", "2.0.0-rc.1", false],
      [">0 >=1.0.0-a", "1.0.0-a", false],
      [">1 >=2.0.0-rc.0 || 5.0.0", "2.0.0-rc.1", false],
      ["5.0.0 || >1 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">1.9 >=1.10.0-rc.0", "1.10.0-rc.1", false],
      [">=1.10.0-rc.0 >1.9", "1.10.0-rc.1", false],
      ["> 1.9 >=1.10.0-rc.0", "1.10.0-rc.1", false],
      [">1.2.x >=1.3.0-rc.0", "1.3.0-rc.1", false],
      [">1.2.* >=1.3.0-rc.0", "1.3.0-rc.1", false],
      [">1.2 <=1.3.0-rc.5", "1.3.0-rc.1", false],
      [">1.2 ^1.3.0-rc.0", "1.3.0-rc.1", false],
      [">0.0 >=0.1.0-a", "0.1.0-a", false],
      [">99 ~>100.0.0-9", "100.0.0-aA", false],

      // still inside the range
      [">1", "2.0.0", true],
      [">1", "3.1.4", true],
      [">1.x", "2.0.0", true],
      [">0", "1.0.0", true],
      [">1.2", "1.3.0", true],
      [">1.2", "2.0.0", true],
      [">1.2.x", "1.3.0", true],
      [">0.0", "0.1.0", true],
      [">1 >=2.0.0-rc.0", "2.0.0", true],
      // a prerelease above the bound still passes
      [">1 >=2.0.1-rc.0", "2.0.1-rc.1", true],
      [">1 >=3.0.0-rc.0", "3.0.0-rc.1", true],
      [">1.9 >=2.0.0-rc.0", "2.0.0-rc.1", true],
      [">1.2 >=1.3.1-rc.0", "1.3.1-rc.1", true],
      [">1.2 >=1.4.0-rc.0", "1.4.0-rc.1", true],
      [">1 || 2.0.0-rc.1", "2.0.0-rc.1", true],
      // a full version after `>` keeps its form
      [">1.9.9 >=2.0.0-rc.0", "2.0.0-rc.1", true],
      [">1.2.3-rc.0", "1.2.3-rc.1", true],

      // rejected before this change too
      [">1", "1.0.0", false],
      [">1", "1.9.9", false],
      [">1", "2.0.0-rc.1", false],
      [">1", "2.0.0-0", false],
      [">1.x", "1.9.9", false],
      [">0", "0.9.9", false],
      [">1.2", "1.2.0", false],
      [">1.2", "1.2.9", false],
      [">1.2", "1.3.0-rc.1", false],
      [">1.2.x", "1.2.9", false],
      [">0.0", "0.0.9", false],
      [">1 >=2.0.0-rc.5", "2.0.0-rc.1", false],
    ];
    test.each(rows)("%s with %s is %p", (range, version, expected) => {
      testSatisfies(range, version, expected);
    });

    // npm's semver rejects a number above 2^53 - 1, so these have no answer from it. Bun counts
    // in u64: the minor carries into the major, and nothing is above the last major.
    const M = "18446744073709551615";
    const M1 = "18446744073709551614";
    const u64Rows: [range: string, version: string, expected: boolean][] = [
      [`>${M1}`, `${M}.0.0`, true],
      [`>${M1}`, `${M1}.${M}.${M}`, false],
      [`>${M1} >=${M}.0.0-rc.0`, `${M}.0.0-rc.1`, false],
      [`>1.${M1}`, `1.${M}.0`, true],
      [`>1.${M1}`, `1.${M1}.${M}`, false],
      [`>1.${M1} >=1.${M}.0-rc.0`, `1.${M}.0-rc.1`, false],
      [`>1.${M}`, `2.0.0`, true],
      [`>1.${M}`, `1.${M}.${M}`, false],
      [`>1.${M} >=2.0.0-rc.0`, `2.0.0-rc.1`, false],
      [`>${M}`, `${M}.0.0`, false],
      [`>${M}`, `${M}.${M}.${M}`, false],
    ];
    test.each(u64Rows)("%s with %s is %p", (range, version, expected) => {
      testSatisfies(range, version, expected);
    });
  });

  test("u64::MAX component does not collapse ^/~/x/hyphen ranges to empty", () => {
    // Desugaring these range forms builds an exclusive `< {component+1}` upper bound.
    // At u64::MAX that +1 must not saturate back to MAX (which yields `>=X <X`, an empty range).
    const M = "18446744073709551615";
    const M1 = "18446744073709551614";

    // sanity: version is valid and exactly matchable
    testSatisfies("*", `${M}.0.0`, true);
    testSatisfies(`=${M}.0.0`, `${M}.0.0`, true);
    testSatisfies(`>=${M}.0.0`, `${M}.0.0`, true);

    // caret: major / minor (major==0) / patch (major==0,minor==0)
    testSatisfies(`^${M}`, `${M}.0.0`, true);
    testSatisfies(`^${M}.2.3`, `${M}.5.0`, true);
    testSatisfies(`^0.${M}`, `0.${M}.7`, true);
    testSatisfies(`^0.${M}.3`, `0.${M}.7`, true);
    testSatisfies(`^0.0.${M}`, `0.0.${M}`, true);

    // tilde: major / minor
    testSatisfies(`~${M}`, `${M}.0.0`, true);
    testSatisfies(`~${M}`, `${M}.9.9`, true);
    testSatisfies(`~1.${M}`, `1.${M}.0`, true);
    testSatisfies(`~1.${M}.3`, `1.${M}.3`, true);
    testSatisfies(`~1.${M}.3`, `1.${M}.9`, true);

    // bare partial and x-range (init_wildcard)
    testSatisfies(M, `${M}.0.0`, true);
    testSatisfies(`${M}.x`, `${M}.0.0`, true);
    testSatisfies(`${M}.x`, `${M}.5.0`, true);
    testSatisfies(`1.${M}`, `1.${M}.0`, true);
    testSatisfies(`1.${M}.x`, `1.${M}.5`, true);

    // hyphen range right endpoint (partial)
    testSatisfies(`1.0.0 - ${M}`, `${M}.5.0`, true);
    testSatisfies(`1.0.0 - ${M}.x`, `${M}.5.0`, true);
    testSatisfies(`1.0.0 - 1.${M}`, `1.${M}.5`, true);
    testSatisfies(`1.0.0 - 1.${M}.x`, `1.${M}.5`, true);

    // upper bound is still enforced: the clamped range doesn't leak past its ceiling
    testSatisfies(`^0.${M}`, `1.0.0`, false);
    testSatisfies(`^0.0.${M}`, `0.1.0`, false);
    testSatisfies(`~1.${M}.3`, `2.0.0`, false);
    testSatisfies(`1.${M}.x`, `2.0.0`, false);
    testSatisfies(`1.0.0 - 1.${M}`, `2.0.0`, false);

    // control at MAX-1: every shape already worked and still works
    testSatisfies(`^${M1}`, `${M1}.0.0`, true);
    testSatisfies(`~${M1}`, `${M1}.0.0`, true);
    testSatisfies(M1, `${M1}.0.0`, true);
    testSatisfies(`^${M1}`, `${M}.0.0`, false);
  });

  describe("a derived upper bound excludes the prereleases of its own version", () => {
    // node-semver ends ^, ~, x-ranges, partials and hyphen ranges at `<X.Y.Z-0`, not `<X.Y.Z`.
    // Where a second comparator names a prerelease of that bound, the prerelease rule alone
    // does not reject the version. Every expectation is the answer of npm's semver 7.7.4.
    const rows: [range: string, version: string, expected: boolean][] = [
      [">=2.0.0-rc.0 ^1.2.3", "2.0.0-rc.1", false],
      ["^1.2.3 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">=2.0.0-rc.0 ^1", "2.0.0-rc.1", false],
      [">=0.2.0-rc.0 ^0.1.2", "0.2.0-rc.1", false],
      ["^0.1.2 >=0.2.0-rc.0", "0.2.0-rc.1", false],
      [">=0.0.2-rc.0 ^0.0.1", "0.0.2-rc.1", false],
      ["~1.5.0 >=1.6.0-beta", "1.6.0-beta.2", false],
      [">=1.6.0-beta ~1.5.0", "1.6.0-beta.2", false],
      [">=2.0.0-rc.0 ~1", "2.0.0-rc.1", false],
      ["<2 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">=2.0.0-rc.0 <2", "2.0.0-rc.1", false],
      [">=1.0.0-rc.0 <1.x", "1.0.0-rc.1", false],
      [">=1.2.0-rc.0 <1.2.x", "1.2.0-rc.1", false],
      ["<=2.0.0-rc.5 ^1.2.3", "2.0.0-rc.1", false],
      ["1.5.x >=1.6.0-beta", "1.6.0-beta.2", false],
      ["1.5 >=1.6.0-beta", "1.6.0-beta.2", false],
      ["1.x >=2.0.0-rc.0", "2.0.0-rc.1", false],
      ["1 >=2.0.0-rc.0", "2.0.0-rc.1", false],
      [">=1.6.0-beta 1.5.x", "1.6.0-beta.2", false],
      [">=1.6.0-beta 1.5", "1.6.0-beta.2", false],
      [">=2.0.0-rc.0 1.x", "2.0.0-rc.1", false],
      [">=2.0.0-rc.0 1", "2.0.0-rc.1", false],
      // `1.0.0 - 1.5` is `>=1.0.0 <1.6.0-0`. npm calls a hyphen range next to another
      // comparator invalid. Bun parses it, and the bound it derives has the same floor.
      ["1.0.0 - 1.5 >=1.6.0-beta", "1.6.0-beta.2", false],
      ["1.0.0 - 1.x >=2.0.0-rc.0", "2.0.0-rc.1", false],
      ["1.0.0 - 1.5.x >=1.6.0-beta", "1.6.0-beta.2", false],

      // still inside the range
      ["^1.2.3", "1.9.0", true],
      ["~1.2.3", "1.2.4", true],
      ["^1.2.3-alpha", "1.2.3-pre", true],
      ["1.5.x", "1.5.9", true],
      ["1.0.0 - 1.5", "1.5.9", true],
      ["<2", "1.9.9", true],
      ["<2 >=1.5.0-rc.0", "1.5.0-rc.1", true],
      ["^1.2.3 >=1.5.0-rc.0", "1.5.0-rc.1", true],
      // a bound written in full keeps its form
      [">=2.0.0-rc.0 <2.0.0", "2.0.0-rc.1", true],
      [">=1.2.3 <2.0.0 >=2.0.0-rc.0", "2.0.0-rc.1", true],

      // rejected before this floor too
      ["^1.2.3", "2.0.0-0", false],
      ["^1.2.3", "2.0.0", false],
      ["^1.2.3", "2.0.0-rc.1", false],
      ["^1.2.3", "1.5.0-beta", false],
      ["^1.2.3-alpha", "2.0.0-alpha", false],
      ["~1.5.0", "1.6.0-beta.2", false],
      ["1.x", "2.0.0-rc.1", false],
      [">=1.6.0-beta <1.6.0-0", "1.6.0-beta.2", false],
    ];
    test.each(rows)("%s with %s is %p", (range, version, expected) => {
      testSatisfies(range, version, expected);
    });
  });

  test("a version with a number above u64::MAX satisfies nothing", () => {
    // These used to read the number as 0, so "1.0.18446744073709551616" satisfied "1.0.0".
    // node-semver returns false: the version is invalid.
    const ranges = ["*", "", "x", ">=0.0.0", `<=${u64Max}.${u64Max}.${u64Max}`, "1.0.0", "^1.0.0", "1.x", ">=1.0.0-0"];
    const satisfied: [version: string, range: string][] = [];
    for (const big of numbersAboveU64Max) {
      for (const version of versionsWith(big)) {
        for (const range of [...ranges, version]) {
          if (satisfies(version, range)) satisfied.push([version, range]);
        }
      }
    }
    expect(satisfied).toEqual([]);
  });

  test("a range with a number above u64::MAX is satisfied by nothing", () => {
    // These used to read the number as 0, so "^99999999999999999999" was "^0" and "0.5.0" satisfied it.
    // node-semver throws "Invalid major version" for the whole range, also when the
    // number is in one "||" alternative only, so satisfies() is false for every version.
    const rangesWith = (big: string) => [
      // exact
      `${big}.0.0`,
      `=${big}.0.0`,
      `v${big}.0.0`,
      `1.${big}.0`,
      `1.0.${big}`,
      `1.0.${big}-beta.1`,
      // primitive comparators
      `>=${big}.0.0`,
      `>${big}.0.0`,
      `<${big}.0.0`,
      `<=${big}.0.0`,
      `<=1.0.${big}`,
      `<1.${big}.0`,
      `>= ${big}.0.0`,
      // caret and tilde
      `^${big}`,
      `^${big}.2.3`,
      `^0.${big}`,
      `^0.0.${big}`,
      `~${big}`,
      `~1.${big}`,
      `~1.0.${big}`,
      `~>1.${big}`,
      // partial versions and x-ranges
      `${big}`,
      `${big}.x`,
      `${big}.*.*`,
      `1.${big}`,
      `1.${big}.x`,
      `>=${big}.x`,
      `<1.${big}.x`,
      // hyphen ranges, the number on each side
      `1.0.0 - ${big}.0.0`,
      `1.0.0 - ${big}`,
      `1.0.0 - 1.${big}.x`,
      `${big}.0.0 - 2.0.0`,
      `0.0.0 - 1.0.${big}`,
      // the number is in one comparator of an intersection
      `>=0.0.0 <${big}.0.0`,
      `<${big}.0.0 >=0.0.0`,
      `>=1.0.0 <=1.0.${big}`,
      // the number is in one alternative of a union
      `1.0.0 || ${big}.0.0`,
      `${big}.0.0 || 1.0.0`,
      `* || <${big}.0.0`,
      `<${big}.0.0 || *`,
      `^1.0.0 || ^${big}`,
    ];
    const versions = [
      "0.0.0",
      "0.5.0",
      "1.0.0",
      "1.0.5",
      "2.0.0",
      `${u64Max}.${u64Max}.${u64Max}`,
      "0.0.0-0",
      "1.0.0-beta.1",
    ];
    const satisfied: [version: string, range: string][] = [];
    for (const big of numbersAboveU64Max) {
      for (const range of rangesWith(big)) {
        for (const version of versions) {
          if (satisfies(version, range)) satisfied.push([version, range]);
        }
      }
    }
    expect(satisfied).toEqual([]);

    // A number after a wildcard has no effect on a range, as in node-semver: "1.x.<big>" is "1.x".
    for (const big of numbersAboveU64Max) {
      testSatisfies(`1.x.${big}`, "1.5.0", true);
      testSatisfies(`1.x.${big}`, "2.0.0", false);
      testSatisfies(`^1.x.${big}`, "1.5.0", true);
      testSatisfies(`~1.*.${big}`, "1.5.0", true);
      testSatisfies(`>=1.x.${big}`, "2.0.0", true);
      testSatisfies(`>=1.x.${big}`, "0.9.0", false);
      testSatisfies(`*.${big}`, "1.0.0", true);
      testSatisfies(`x.${big}.${big}`, "1.0.0", true);
      testSatisfies(`1.0.0 - 1.x.${big}`, "1.5.0", true);
      testSatisfies(`1.0.0 - 1.x.${big}`, "2.0.0", false);
      testSatisfies(`1.x.${big} - 3.0.0`, "2.5.0", true);
      testSatisfies(`1.x.${big} - 3.0.0`, "3.5.0", false);
      testSatisfies(`1.*.${big} || 3.0.0`, "3.0.0", true);
      testSatisfies(`1.*.${big} || 3.0.0`, "2.5.0", false);
      // The text after that number still belongs to the same comparator: "-2" is a
      // prerelease here, not the start of the hyphen range "1.x.<big> - 2".
      testSatisfies(`1.x.${big}-2`, "1.5.0", true);
      testSatisfies(`1.x.${big}-2`, "2.0.0", false);
      testSatisfies(`1.x.${big}-2`, "2.5.0", false);
      testSatisfies(`1.x.${big}-0`, "1.5.0", true);
      testSatisfies(`^1.x.${big}-2`, "2.5.0", false);
      testSatisfies(`>=1.x.${big}-2`, "2.5.0", true);
      testSatisfies(`>=1.x.${big}-2`, "0.9.0", false);
      testSatisfies(`1.x.${big}+2`, "1.5.0", true);
      testSatisfies(`1.x.${big}+2`, "2.5.0", false);
    }

    // u64::MAX itself still fits: the same shapes keep their meaning.
    testSatisfies(`<${u64Max}.0.0`, "1.0.0", true);
    testSatisfies(`<=1.0.${u64Max}`, "1.0.5", true);
    testSatisfies(`1.0.0 - ${u64Max}.0.0`, "2.0.0", true);
    testSatisfies(`1.0.0 || ${u64Max}.0.0`, "1.0.0", true);
    testSatisfies(`1.0.0 || ${u64Max}.0.0`, `${u64Max}.0.0`, true);
  });

  test("ranges", () => {
    testSatisfies("~1.2.3", "1.2.3", true);
    testSatisfies("~1.2", "1.2.0", true);
    testSatisfies("~1", "1.0.0", true);
    testSatisfies("~1", "1.2.0", true);
    testSatisfies("~1", "1.2.999", true);
    testSatisfies("~0.2.3", "0.2.3", true);
    testSatisfies("~0.2", "0.2.0", true);
    testSatisfies("~0.2", "0.2.1", true);
    testSatisfies("~0 ", "0.0.0", true);

    testSatisfies("~1.2.3", "1.3.0", false);
    testSatisfies("~1.2", "1.3.0", false);
    testSatisfies("~1", "2.0.0", false);
    testSatisfies("~0.2.3", "0.3.0", false);
    testSatisfies("~0.2.3", "1.0.0", false);
    testSatisfies("~0 ", "1.0.0", false);
    testSatisfies("~0.2", "0.1.0", false);
    testSatisfies("~0.2", "0.3.0", false);

    testSatisfies("~3.0.5", "3.3.0", false);

    testSatisfies("^1.1.4", "1.1.4", true);

    testSatisfies(">=3", "3.5.0", true);
    testSatisfies(">=3", "2.999.999", false);
    testSatisfies(">=3", "3.5.1", true);
    testSatisfies(">=3.x.x", "3.x.x", false);

    testSatisfies("<6 >= 5", "5.0.0", true);
    testSatisfies("<6 >= 5", "4.0.0", false);
    testSatisfies("<6 >= 5", "6.0.0", false);
    testSatisfies("<6 >= 5", "6.0.1", false);

    testSatisfies(">2", "3", false);
    testSatisfies(">2", "2.1", false);
    testSatisfies(">2", "2", false);
    testSatisfies(">2", "1.0", false);
    testSatisfies(">1.3", "1.3.1", false);
    testSatisfies(">1.3", "2.0.0", true);
    testSatisfies(">2.1.0", "2.2.0", true);
    testSatisfies("<=2.2.99999", "2.2.0", true);
    testSatisfies(">=2.1.99999", "2.2.0", true);
    testSatisfies("<2.2.99999", "2.2.0", true);
    testSatisfies(">2.1.99999", "2.2.0", true);
    testSatisfies(">1.0.0", "2.0.0", true);
    testSatisfies("1.0.0", "1.0.0", true);
    testSatisfies("1.0.0", "2.0.0", false);

    testSatisfies("1.0.0 || 2.0.0", "1.0.0", true);
    testSatisfies("2.0.0 || 1.0.0", "1.0.0", true);
    testSatisfies("1.0.0 || 2.0.0", "2.0.0", true);
    testSatisfies("2.0.0 || 1.0.0", "2.0.0", true);
    testSatisfies("2.0.0 || >1.0.0", "2.0.0", true);

    testSatisfies(">1.0.0 <2.0.0 <2.0.1 >1.0.1", "1.0.2", true);

    testSatisfies("2.x", "2.0.0", true);
    testSatisfies("2.x", "2.1.0", true);
    testSatisfies("2.x", "2.2.0", true);
    testSatisfies("2.x", "2.3.0", true);
    testSatisfies("2.x", "2.1.1", true);
    testSatisfies("2.x", "2.2.2", true);
    testSatisfies("2.x", "2.3.3", true);

    testSatisfies("<2.0.1 >1.0.0", "2.0.0", true);
    testSatisfies("<=2.0.1 >=1.0.0", "2.0.0", true);

    testSatisfies("^2", "2.0.0", true);
    testSatisfies("^2", "2.9.9", true);
    testSatisfies("~2", "2.0.0", true);
    testSatisfies("~2", "2.1.0", true);
    testSatisfies("~2.2", "2.2.1", true);

    testSatisfies("2.1.0 || > 2.2 || >3", "2.1.0", true);
    testSatisfies(" > 2.2 || >3 || 2.1.0", "2.1.0", true);
    testSatisfies(" > 2.2 || 2.1.0 || >3", "2.1.0", true);
    testSatisfies("> 2.2 || 2.1.0 || >3", "2.3.0", true);
    testSatisfies("> 2.2 || 2.1.0 || >3", "2.2.1", false);
    testSatisfies("> 2.2 || 2.1.0 || >3", "2.2.0", false);
    testSatisfies("> 2.2 || 2.1.0 || >3", "2.3.0", true);
    testSatisfies("> 2.2 || 2.1.0 || >3", "3.0.1", true);
    testSatisfies("~2", "2.0.0", true);
    testSatisfies("~2", "2.1.0", true);

    testSatisfies("1.2.0 - 1.3.0", "1.2.2", true);
    testSatisfies("1.2 - 1.3", "1.2.2", true);
    testSatisfies("1 - 1.3", "1.2.2", true);
    testSatisfies("1 - 1.3", "1.3.0", true);
    testSatisfies("1.2 - 1.3", "1.3.1", true);
    testSatisfies("1.2 - 1.3", "1.4.0", false);
    testSatisfies("1 - 1.3", "1.3.1", true);

    testSatisfies("1.2 - 1.3 || 5.0", "6.4.0", false);
    testSatisfies("1.2 - 1.3 || 5.0", "1.2.1", true);
    testSatisfies("5.0 || 1.2 - 1.3", "1.2.1", true);
    testSatisfies("1.2 - 1.3 || 5.0", "5.0", false);
    testSatisfies("5.0 || 1.2 - 1.3", "5.0", false);
    testSatisfies("1.2 - 1.3 || 5.0", "5.0.2", true);
    testSatisfies("5.0 || 1.2 - 1.3", "5.0.2", true);
    testSatisfies("1.2 - 1.3 || 5.0", "5.0.2", true);
    testSatisfies("5.0 || 1.2 - 1.3", "5.0.2", true);
    testSatisfies("5.0 || 1.2 - 1.3 || >8", "9.0.2", true);

    testSatisfies(">=0.34.0-next.3 <1.0.0", "0.34.0-next.8", true);
    testSatisfies("<1.0.0", "0.34.0-next.8", false);

    testSatisfies("<=7.0.0", "7.0.0-rc2", false);
    testSatisfies(">=7.0.0", "7.0.0-rc2", false);
    testSatisfies("<=7.0.0-rc2", "7.0.0-rc2", true);
    testSatisfies(">=7.0.0-rc2", "7.0.0-rc2", true);

    testSatisfies("^1.2.3-pr.1 || >=1.2.4-alpha", "1.2.4-alpha.notready", true);

    testSatisfies("^3.0.0-next.0||^3.0.0", "3.0.0-next.2", true);

    const notPassing = [
      "0.1.0",
      "0.10.0",
      "0.2.0",
      "0.2.1",
      "0.2.2",
      "0.3.0",
      "0.3.1",
      "0.3.2",
      "0.4.0",
      "0.4.1",
      "0.4.2",
      "0.5.0",
      "0.5.0-rc.1",
      "0.5.1",
      "0.5.2",
      "0.6.0",
      "0.6.1",
      "0.7.0",
      "0.8.0",
      "0.8.1",
      "0.8.2",
      "0.9.0",
      "0.9.1",
      "0.9.2",
      "1.0.0",
      "1.0.1",
      "1.0.2",
      "1.1.0",
      "1.1.1",
      "1.2.0",
      "1.2.1",
      "1.3.0",
      "1.3.1",
      "2.2.0",
      "2.2.1",
      "2.3.0",
      "1.0.0-rc.1",
      "1.0.0-rc.2",
      "1.0.0-rc.3",
    ];

    for (const item of notPassing) {
      testSatisfies("^2 <2.2 || > 2.3", item, false);
      testSatisfies("> 2.3 || ^2 <2.2", item, false);
    }

    const passing = [
      "2.4.0",
      "2.4.1",
      "3.0.0",
      "3.0.1",
      "3.1.0",
      "3.2.0",
      "3.3.0",
      "3.3.1",
      "3.4.0",
      "3.5.0",
      "3.6.0",
      "3.7.0",
      "2.4.2",
      "3.8.0",
      "3.9.0",
      "3.9.1",
      "3.9.2",
      "3.9.3",
      "3.10.0",
      "3.10.1",
      "4.0.0",
      "4.0.1",
      "4.1.0",
      "4.2.0",
      "4.2.1",
      "4.3.0",
      "4.4.0",
      "4.5.0",
      "4.5.1",
      "4.6.0",
      "4.6.1",
      "4.7.0",
      "4.8.0",
      "4.8.1",
      "4.8.2",
      "4.9.0",
      "4.10.0",
      "4.11.0",
      "4.11.1",
      "4.11.2",
      "4.12.0",
      "4.13.0",
      "4.13.1",
      "4.14.0",
      "4.14.1",
      "4.14.2",
      "4.15.0",
      "4.16.0",
      "4.16.1",
      "4.16.2",
      "4.16.3",
      "4.16.4",
      "4.16.5",
      "4.16.6",
      "4.17.0",
      "4.17.1",
      "4.17.2",
      "4.17.3",
      "4.17.4",
      "4.17.5",
      "4.17.9",
      "4.17.10",
      "4.17.11",
      "2.0.0",
      "2.1.0",
    ];

    for (const item of passing) {
      testSatisfies("^2 <2.2 || > 2.3", item, true);
      testSatisfies("> 2.3 || ^2 <2.2", item, true);
    }
  });

  describe("a wildcard major after < or >", () => {
    // node-semver's replaceXRange turns `<x` and `>x` into `<0.0.0-0`, which no version satisfies.
    // Every expectation but those of the last test is the answer of npm's semver 7.7.4 and 7.8.5.
    type Row = [range: string, version: string, expected: boolean];
    const check = (rows: Row[]) =>
      expect(rows.map(([range, version]) => [range, version, satisfies(version, range)])).toEqual(rows);

    test("is the empty set", () => {
      const ranges = [
        ...["<x", "<X", "<*", ">x", ">X", ">*"],
        ...["< x", ">  *", "<\tx", "<vx", ">v*"],
        ...["<x.x", ">x.x", "<x.x.x", ">x.x.x", "<*.*", ">*.*.*"],
        // a number or build metadata after the wildcard changes nothing
        ...["<x.1", ">x.1", "<x.1.2", ">x.1.2", "<x+build", ">x.x.x+build"],
      ];
      const versions = ["0.0.0", "1.0.0", "1.0.0-beta.1", "0.0.0-0"];
      check(ranges.flatMap(range => versions.map((version): Row => [range, version, false])));
    });

    test("empties an intersection and drops out of a union", () => {
      check([
        [">x <2", "1.2.3", false],
        ["<2 >x", "1.2.3", false],
        [">=1 <x", "1.2.3", false],
        ["<x >=1", "1.2.3", false],
        ["<=x <x", "1.2.3", false],
        ["^1.0.0 >*", "1.2.3", false],
        ["1.0.0 <x", "1.0.0", false],
        ["<x 1.0.0", "1.0.0", false],
        ["<x || 1.0.0", "1.0.0", true],
        ["<x || 1.0.0", "2.0.0", false],
        ["1.0.0 || >x", "1.0.0", true],
        ["1.0.0 || >x", "2.0.0", false],
        ["<x||1.0.0", "1.0.0", true],
        ["<x||1.0.0", "2.0.0", false],
        ["<* || ^2", "2.1.0", true],
        ["<* || ^2", "1.1.0", false],
        [">x || >=3", "3.0.0", true],
        [">x || >=3", "2.0.0", false],
        ["<x || >x", "1.0.0", false],
      ]);
    });

    test("every other operator still allows any version", () => {
      check([
        ...[">=x", "<=x", ">=*", "<=*", ">=x.x", "<=x.x.x", "<= x", ">= *"].map((range): Row => [range, "1.0.0", true]),
        ...["x", "*", "=x", "^x", "~x", "~>x"].map((range): Row => [range, "1.0.0", true]),
        [">=x <2", "1.2.3", true],
        [">=x <2", "2.0.0", false],
        // a wildcard after a number is a bound, not the empty set
        ["<1.x", "0.9.0", true],
        ["<1.x", "1.0.0", false],
        [">1.x", "2.0.0", true],
        [">1.x", "1.9.0", false],
        ["<1.2.x", "1.1.9", true],
        ["<1.2.x", "1.2.0", false],
        [">1.2.x", "1.3.0", true],
        [">1.2.x", "1.2.9", false],
      ]);
    });

    test("a wildcard major after ^ or ~ stays any version inside a union or an intersection", () => {
      check([
        ["^x || 1.0.0", "2.0.0", true],
        ["~x || 1.0.0", "2.0.0", true],
        ["^x.x || 1.0.0", "2.0.0", true],
        ["~x.x.x || 1.0.0", "2.0.0", true],
        ["^* || <1", "2.0.0", true],
        ["1.0.0 || ^x", "2.0.0", true],
        ["^x || <x", "1.0.0", true],
        ["<x || ^x", "1.0.0", true],
        ["~* || <*", "2.3.4", true],
        [">x || ~X", "2.3.4", true],
        ["^x >=3", "2.0.0", false],
        ["^x >=3", "3.0.0", true],
        [">=3 ~x", "2.0.0", false],
        [">=3 ~x", "3.1.0", true],
      ]);
    });

    test("an operator before text that is not a version keeps its reading", () => {
      // npm calls these ranges invalid. Bun reads the text as `*` after `<` or `>`, and the rows above do not change that.
      check([
        [">latest", "1.0.0", true],
        ["<foo", "1.0.0", true],
        ["< v", "1.0.0", true],
        [">^1.0.0", "2.0.0", true],
        // text that starts with a wildcard character is still text
        [">xenial", "1.0.0", true],
        ["<xstate", "1.0.0", true],
        [">*next", "1.0.0", true],
        [">x.1.2.3", "1.0.0", true],
        // after `^` the text adds no comparator
        ["^latest || 1.0.0", "2.0.0", false],
        ["^xenial || 1.0.0", "2.0.0", false],
      ]);
    });
  });

  test("range includes", () => {
    // https://github.com/npm/node-semver/blob/14d263faa156e408a033b9b12a2f87735c2df42c/test/fixtures/range-include.js#L3
    var tests = [
      ["1.0.0 - 2.0.0", "1.2.3"],
      ["^1.2.3+build", "1.2.3"],
      ["^1.2.3+build", "1.3.0"],
      ["1.2.3-pre+asdf - 2.4.3-pre+asdf", "1.2.3"],
      ["1.2.3pre+asdf - 2.4.3-pre+asdf", "1.2.3"],
      ["1.2.3-pre+asdf - 2.4.3pre+asdf", "1.2.3"],
      ["1.2.3pre+asdf - 2.4.3pre+asdf", "1.2.3"],
      ["1.2.3-pre+asdf - 2.4.3-pre+asdf", "1.2.3-pre.2"],
      ["1.2.3-pre+asdf - 2.4.3-pre+asdf", "2.4.3-alpha"],
      ["1.2.3+asdf - 2.4.3+asdf", "1.2.3"],
      ["1.0.0", "1.0.0"],
      [">=*", "0.2.4"],
      ["", "1.0.0"],
      ["*", "1.2.3"],
      ["*", "v1.2.3"],
      [">=1.0.0", "1.0.0"],
      [">=1.0.0", "1.0.1"],
      [">=1.0.0", "1.1.0"],
      [">1.0.0", "1.0.1"],
      [">1.0.0", "1.1.0"],
      ["<=2.0.0", "2.0.0"],
      ["<=2.0.0", "1.9999.9999"],
      ["<=2.0.0", "0.2.9"],
      ["<2.0.0", "1.9999.9999"],
      ["<2.0.0", "0.2.9"],
      [">= 1.0.0", "1.0.0"],
      [">=  1.0.0", "1.0.1"],
      [">=   1.0.0", "1.1.0"],
      ["> 1.0.0", "1.0.1"],
      [">  1.0.0", "1.1.0"],
      ["<=   2.0.0", "2.0.0"],
      ["<= 2.0.0", "1.9999.9999"],
      ["<=  2.0.0", "0.2.9"],
      ["<    2.0.0", "1.9999.9999"],
      ["<\t2.0.0", "0.2.9"],
      [">=0.1.97", "v0.1.97", true],
      [">=0.1.97", "0.1.97"],
      ["0.1.20 || 1.2.4", "1.2.4"],
      [">=0.2.3 || <0.0.1", "0.0.0"],
      [">=0.2.3 || <0.0.1", "0.2.3"],
      [">=0.2.3 || <0.0.1", "0.2.4"],
      ["||", "1.3.4"],
      ["2.x.x", "2.1.3"],
      ["1.2.x", "1.2.3"],
      ["1.2.x || 2.x", "2.1.3"],
      ["1.2.x || 2.x", "1.2.3"],
      ["x", "1.2.3"],
      ["2.*.*", "2.1.3"],
      ["1.2.*", "1.2.3"],
      ["1.2.* || 2.*", "2.1.3"],
      ["1.2.* || 2.*", "1.2.3"],
      ["*", "1.2.3"],
      ["2", "2.1.2"],
      ["2.3", "2.3.1"],
      ["~0.0.1", "0.0.1"],
      ["~0.0.1", "0.0.2"],
      ["~x", "0.0.9"], // >=2.4.0 <2.5.0
      ["~2", "2.0.9"], // >=2.4.0 <2.5.0
      ["~2.4", "2.4.0"], // >=2.4.0 <2.5.0
      ["~2.4", "2.4.5"],
      ["~>3.2.1", "3.2.2"], // >=3.2.1 <3.3.0,
      ["~1", "1.2.3"], // >=1.0.0 <2.0.0
      ["~>1", "1.2.3"],
      ["~> 1", "1.2.3"],
      ["~1.0", "1.0.2"], // >=1.0.0 <1.1.0,
      ["~ 1.0", "1.0.2"],
      ["~ 1.0.3", "1.0.12"],
      ["~ 1.0.3alpha", "1.0.12"],
      [">=1", "1.0.0"],
      [">= 1", "1.0.0"],
      ["<1.2", "1.1.1"],
      ["< 1.2", "1.1.1"],
      ["~v0.5.4-pre", "0.5.5"],
      ["~v0.5.4-pre", "0.5.4"],
      ["=0.7.x", "0.7.2"],
      ["<=0.7.x", "0.7.2"],
      [">=0.7.x", "0.7.2"],
      ["<=0.7.x", "0.6.2"],
      ["~1.2.1 >=1.2.3", "1.2.3"],
      ["~1.2.1 =1.2.3", "1.2.3"],
      ["~1.2.1 1.2.3", "1.2.3"],
      ["~1.2.1 >=1.2.3 1.2.3", "1.2.3"],
      ["~1.2.1 1.2.3 >=1.2.3", "1.2.3"],
      [">=1.2.1 1.2.3", "1.2.3"],
      ["1.2.3 >=1.2.1", "1.2.3"],
      [">=1.2.3 >=1.2.1", "1.2.3"],
      [">=1.2.1 >=1.2.3", "1.2.3"],
      [">=1.2", "1.2.8"],
      ["^1.2.3", "1.8.1"],
      ["^0.1.2", "0.1.2"],
      ["^0.1", "0.1.2"],
      ["^0.0.1", "0.0.1"],
      ["^1.2", "1.4.2"],
      ["^1.2 ^1", "1.4.2"],
      ["^1.2.3-alpha", "1.2.3-pre"],
      ["^1.2.0-alpha", "1.2.0-pre"],
      ["^0.0.1-alpha", "0.0.1-beta"],
      ["^0.0.1-alpha", "0.0.1"],
      ["^0.1.1-alpha", "0.1.1-beta"],
      ["^x", "1.2.3"],
      ["x - 1.0.0", "0.9.7"],
      ["x - 1.x", "0.9.7"],
      ["1.0.0 - x", "1.9.7"],
      ["1.0.0 - x", "1.0.7"],
      ["1.0.0 - 1.x", "1.0.7"],
      ["1.0.0 - 1.0.x", "1.0.7"],
      ["1.x - x", "1.9.7"],
      ["<=7.x", "7.9.9"],

      // ["2.x", "2.0.0-pre.0", { includePrerelease: true }],
      // ["2.x", "2.1.0-pre.0", { includePrerelease: true }],
      // ["1.1.x", "1.1.0-a", { includePrerelease: true }],
      // ["1.1.x", "1.1.1-a", { includePrerelease: true }],
      // ["*", "1.0.0-rc1", { includePrerelease: true }],
      // ["^1.0.0-0", "1.0.1-rc1", { includePrerelease: true }],
      // ["^1.0.0-rc2", "1.0.1-rc1", { includePrerelease: true }],
      // ["^1.0.0", "1.0.1-rc1", { includePrerelease: true }],
      // ["^1.0.0", "1.1.0-rc1", { includePrerelease: true }],
      // ["1 - 2", "2.0.0-pre", { includePrerelease: true }],
      // ["1 - 2", "1.0.0-pre", { includePrerelease: true }],
      // ["1.0 - 2", "1.0.0-pre", { includePrerelease: true }],

      // ["=0.7.x", "0.7.0-asdf", { includePrerelease: true }],
      // [">=0.7.x", "0.7.0-asdf", { includePrerelease: true }],
      // ["<=0.7.x", "0.7.0-asdf", { includePrerelease: true }],

      // [">=1.0.0 <=1.1.0", "1.1.0-pre", { includePrerelease: true }],

      // https://github.com/oven-sh/bun/issues/8040
      [">=3.3.0-beta.1 <3.4.0-beta.3", "3.3.1"],
      ["^3.3.0-beta.1", "3.4.0"],
    ];

    for (const [range, version] of tests) {
      expect(satisfies(version, range)).toBeTrue();
    }
  });

  test("range excludes", () => {
    // https://github.com/npm/node-semver/blob/14d263faa156e408a033b9b12a2f87735c2df42c/test/fixtures/range-exclude.js#L3
    const tests = [
      ["1.0.0 - 2.0.0", "2.2.3"],
      ["1.2.3+asdf - 2.4.3+asdf", "1.2.3-pre.2"],
      ["1.2.3+asdf - 2.4.3+asdf", "2.4.3-alpha"],
      ["^1.2.3+build", "2.0.0"],
      ["^1.2.3+build", "1.2.0"],
      ["^1.2.3", "1.2.3-pre"],
      ["^1.2", "1.2.0-pre"],
      [">1.2", "1.3.0-beta"],
      ["<=1.2.3", "1.2.3-beta"],
      ["^1.2.3", "1.2.3-beta"],
      ["=0.7.x", "0.7.0-asdf"],
      [">=0.7.x", "0.7.0-asdf"],
      ["<=0.7.x", "0.7.0-asdf"],
      ["1", "1.0.0beta"],
      ["<1", "1.0.0beta"],
      ["< 1", "1.0.0beta"],
      ["1.0.0", "1.0.1"],
      [">=1.0.0", "0.0.0"],
      [">=1.0.0", "0.0.1"],
      [">=1.0.0", "0.1.0"],
      [">1.0.0", "0.0.1"],
      [">1.0.0", "0.1.0"],
      ["<=2.0.0", "3.0.0"],
      ["<=2.0.0", "2.9999.9999"],
      ["<=2.0.0", "2.2.9"],
      ["<2.0.0", "2.9999.9999"],
      ["<2.0.0", "2.2.9"],
      [">=0.1.97", "v0.1.93"],
      [">=0.1.97", "0.1.93"],
      ["0.1.20 || 1.2.4", "1.2.3"],
      [">=0.2.3 || <0.0.1", "0.0.3"],
      [">=0.2.3 || <0.0.1", "0.2.2"],
      ["2.x.x", "1.1.3"],
      ["2.x.x", "3.1.3"],
      ["1.2.x", "1.3.3"],
      ["1.2.x || 2.x", "3.1.3"],
      ["1.2.x || 2.x", "1.1.3"],
      ["2.*.*", "1.1.3"],
      ["2.*.*", "3.1.3"],
      ["1.2.*", "1.3.3"],
      ["1.2.* || 2.*", "3.1.3"],
      ["1.2.* || 2.*", "1.1.3"],
      ["2", "1.1.2"],
      ["2.3", "2.4.1"],
      ["~0.0.1", "0.1.0-alpha"],
      ["~0.0.1", "0.1.0"],
      ["~2.4", "2.5.0"], // >=2.4.0 <2.5.0
      ["~2.4", "2.3.9"],
      ["~>3.2.1", "3.3.2"], // >=3.2.1 <3.3.0
      ["~>3.2.1", "3.2.0"], // >=3.2.1 <3.3.0
      ["~1", "0.2.3"], // >=1.0.0 <2.0.0
      ["~>1", "2.2.3"],
      ["~1.0", "1.1.0"], // >=1.0.0 <1.1.0
      ["<1", "1.0.0"],
      [">=1.2", "1.1.1"],
      ["1", "2.0.0beta"],
      ["~v0.5.4-beta", "0.5.4-alpha"],
      ["=0.7.x", "0.8.2"],
      [">=0.7.x", "0.6.2"],
      ["<0.7.x", "0.7.2"],
      ["<1.2.3", "1.2.3-beta"],
      ["=1.2.3", "1.2.3-beta"],
      [">1.2", "1.2.8"],
      ["^0.0.1", "0.0.2-alpha"],
      ["^0.0.1", "0.0.2"],
      ["^1.2.3", "2.0.0-alpha"],
      ["^1.2.3", "1.2.2"],
      ["^1.2", "1.1.9"],
      ["*", "v1.2.3-foo"],

      // invalid versions never satisfy, but shouldn't throw
      ["*", "not a version"],
      [">=2", "glorp"],
      [">=2", false],

      // ["2.x", "3.0.0-pre.0", { includePrerelease: true }],
      // ["^1.0.0", "1.0.0-rc1", { includePrerelease: true }],
      // ["^1.0.0", "2.0.0-rc1", { includePrerelease: true }],
      // ["^1.2.3-rc2", "2.0.0", { includePrerelease: true }],
      ["^1.0.0", "2.0.0-rc1"],

      // ["1 - 2", "3.0.0-pre", { includePrerelease: true }],
      ["1 - 2", "2.0.0-pre"],
      ["1 - 2", "1.0.0-pre"],
      ["1.0 - 2", "1.0.0-pre"],

      ["1.1.x", "1.0.0-a"],
      ["1.1.x", "1.1.0-a"],
      ["1.1.x", "1.2.0-a"],
      // ["1.1.x", "1.2.0-a", { includePrerelease: true }],
      // ["1.1.x", "1.0.0-a", { includePrerelease: true }],
      ["1.x", "1.0.0-a"],
      ["1.x", "1.1.0-a"],
      ["1.x", "1.2.0-a"],
      // ["1.x", "0.0.0-a", { includePrerelease: true }],
      // ["1.x", "2.0.0-a", { includePrerelease: true }],

      [">=1.0.0 <1.1.0", "1.1.0"],
      // [">=1.0.0 <1.1.0", "1.1.0", { includePrerelease: true }],
      [">=1.0.0 <1.1.0", "1.1.0-pre"],
      [">=1.0.0 <1.1.0-pre", "1.1.0-pre"],

      ["== 1.0.0 || foo", "2.0.0"],

      // https://github.com/oven-sh/bun/issues/8040
      [">=3.3.0-beta.1 <3.4.0-beta.3", "3.4.5"],
    ];

    for (const [range, version] of tests) {
      expect(satisfies(version, range)).toBeFalse();
    }
  });

  test("space-separated comparators are an intersection, not alternatives", () => {
    // Every expectation is node-semver 7's answer for the same input.
    testSatisfiesTable([
      ["2.5.0", "1.x 2.x", false],
      ["1.0.1", "<1.0.0 1.x", false],
      ["1.2.3", ">=2.0.0 1.2.3", false],
      ["1.2.3", "1.2.3 4.5.6", false],
      ["4.5.6", "1.2.3 4.5.6", false],
      ["1.2.3", ">=2.0.0 =1.2.3", false],
      ["1.2.3", ">=2.0.0 v1.2.3", false],
      ["1.0.0", ">=2.0.0 *", false],
      ["1.0.0", ">=2.0.0 x", false],
      ["1.0.0", ">=2.0.0 x.x.x", false],
      ["1.5.0", ">=1.0.0 1.x <1.4.0", false],
      ["4.5.6", "4.5.6 7.8.9 || 1.2.3", false],
      // fstream@1.0.12 declares "mkdirp": ">=0.5 0"
      ["0.4.2", ">=0.5 0", false],
      ["1.0.0", ">=0.5 0", false],
      ["3.0.1", ">=0.5 0", false],
      ["0.5.6", ">=0.5 0", true],
      ["3.0.1", ">=0.5 v0", false],
      ["3.0.1", ">=0.5 = 0", false],
      ["3.0.1", " >=0.5   0 ", false],
      ["0.5.6", " >=0.5   0 ", true],
      ["9.9.9", "~1.0.0 x", false],
      ["1.0.5", "~1.0.0 x", true],
      ["0.1.0", ">=1.0.0 <2.0.0 x", false],
      // the intersection holds, or an "||" alternative holds
      ["1.3.0", ">=1.0.0 1.x <1.4.0", true],
      ["2.5.0", "1.x || 2.x", true],
      ["1.0.1", "<1.0.0 || 1.x", true],
      ["1.2.3", ">=2.0.0 || 1.2.3", true],
      ["1.2.3", "1.2.3 4.5.6 || 1.2.3", true],
      ["1.2.3", "~1.2.1 1.2.3", true],
      ["1.2.3", "~1.2.1 =1.2.3", true],
      ["1.2.3", ">=1.2.1 1.2.3", true],
      ["1.2.3", "1.2.3 >=1.2.1", true],
      ["1.2.3-beta", "1.2.3-beta 1.x", true],
      ["1.5.0", "1.2.3-beta 1.x", false],
    ]);
  });

  test("malformed text next to a comparator still starts an alternative", () => {
    // Packages publish ranges like these: adaptableblotter-react-aggrid@4.2.0 has the peer range "=>16.8.0".
    testSatisfiesTable([
      ["18.2.0", "=>16.8.0", true],
      ["18.2.0", "=> 16.0.0", true],
      ["18.2.0", ">=18.0.0 - <19.0.0", true],
      ["5.0.0", ">=1.0.0 1.2.3.4", true],
      ["1.5.0", "^2 1.2.3 - 2.3.4", true],
      ["4.5.6", "1.2.3 - 2.3.4 4.5.6", true],
      ["4.5.6", "1.2.3 foo 4.5.6", true],
      ["4.5.6", "1.2.3-beta|4.5.6", true],
      ["1.0.0", "*1.0.0", true],
    ]);
  });

  test("a '-' in build metadata does not make a prerelease", () => {
    // Every expectation is node-semver 7's answer for the same input.
    testSatisfiesTable([
      ["1.0.0+build-1", "^1.0.0", true],
      ["1.0.0+build-1", "1.0.0", true],
      ["1.0.0+build-1", "*", true],
      ["1.0.0+a-b", ">=1.0.0 <2.0.0", true],
      ["1.0.0+a.b-c", "1.x", true],
      ["1.0.0+build-1", "1.0.0-1", false],
      ["1.0.0+build-1", "^2.0.0", false],
      ["1.0.0-rc.1+build-1", "^1.0.0-rc.0", true],
      ["1.0.0-rc.1+build-1", "^1.0.0", false],
      ["1.0.0-a-b+c-d", "1.0.0-a-b", true],
      // in the range
      ["1.2.0", "^1.0.0+build-1", true],
      ["1.0.0", "1.0.0+build-1", true],
      ["1.0.0", "=1.0.0+a-b", true],
      ["1.5.0", ">=1.0.0+a-b <2.0.0+c-d", true],
      ["1.5.0", "1.0.0+a-b - 2.0.0+c-d", true],
      ["1.0.0-1", "1.0.0+build-1", false],
      ["1.0.0-1", ">=1.0.0+build-1", false],
    ]);
  });

  test("build metadata after a bare major isn't a second range", () => {
    // Every expectation is node-semver 7.8's answer for the same input. "2+1" used to be "2 || 1" and "2+x" any version.
    testSatisfiesTable([
      ["2.5.0", "2+1", true],
      ["1.5.0", "2+1", false],
      ["3.5.0", "3+0", true],
      ["0.5.0", "3+0", false],
      ["2.5.0", "2+x", true],
      ["1.5.0", "2+x", false],
      ["3.5.0", "2+X", false],
      ["1.5.0", "2+1.5.0", false],
      ["2.5.0", "2+-", true],
      ["2.5.0", "2+build", true],
      ["3.5.0", "2+build", false],
      ["2.5.0", "v2+1", true],
      ["1.5.0", "=2+1", false],
      ["3.5.0", "^2+x", false],
      ["1.5.0", "~2+x", false],
      ["1.5.0", ">=2+x", false],
      ["3.5.0", ">=2+x", true],
      ["2.5.0", ">2+1", false],
      ["1.5.0", "<2+1", true],
      ["2.5.0", "<2+1", false],
      ["2.5.0", "<=2+1", true],
      // next to other comparators
      ["2.1.0", "2+1 <2.4", true],
      ["2.5.0", "2+1 <2.4", false],
      ["1.5.0", "2+1 <2.4", false],
      ["3.5.0", "2+1 - 3", true],
      ["1.5.0", "2+1 - 3", false],
      ["3.5.0", "1 - 2+3", false],
      ["3.5.0", "2+1||3", true],
      ["1.5.0", "2+1 || 3", false],
    ]);
  });

  test("a comparator that means >=0.0.0 doesn't exclude a prerelease of 0.0.0", () => {
    // Every expectation is node-semver 7.8's answer for the same input: it reads such a comparator as any version.
    testSatisfiesTable([
      ...[
        "*",
        "x",
        "^x",
        "~x",
        "~>*",
        "0.x",
        "0",
        "0.0.x",
        "0.0",
        ">=0",
        ">=0.0.0",
        "^0",
        "~0",
        "~>0",
        "^0.0",
        "~0.0",
      ].flatMap((any): [string, string, boolean][] => [
        ["0.0.0-b", `>=0.0.0-a ${any}`, true],
        ["0.0.0-b", `${any} >=0.0.0-b`, true],
        ["0.0.0-b", `<0.0.0-c ${any}`, true],
        ["0.0.0-b", `>=0.0.0-c ${any}`, false],
        ["0.0.1-b", `>=0.0.0-a ${any}`, false],
        ["0.0.0-b", any, false],
      ]),
      ["0.0.0-b", ">=0.0.0-a ^0.0.0", true],
      ["0.0.0-b", ">=0.0.0-a ~0.0.0", true],
      ["0.0.0-b", "0.0.0 - 0.0.0-c", true],
      ["0.0.0-d", "0.0.0 - 0.0.0-c", false],
      ["0.0.0-b", ">=0.0.0-a >0.0.0", false],
      ["0.0.0-b", ">=0.0.0-a 0.0.0", false],
      ["0.0.0-b", ">=0.0.0-a >=0.0.1", false],
      ["1.0.0-b", ">=1.0.0-a 1.x", false],
      ["1.0.0-b", ">=1.0.0-b *", true],
    ]);
  });

  test("spaces between < or > and = do not split the operator", () => {
    // Every expectation is node-semver 7's answer for the same input. "< =1" used to be "<1".
    testSatisfiesTable([
      ["1.0.0", "< =1.0.0", true],
      ["1.0.1", "< =1.0.0", false],
      ["1.0.0", "<  =1.0.0", true],
      ["1.0.0", "< =v1.0.0", true],
      ["1.9.0", "< =1", true],
      ["2.0.0", "< =1", false],
      ["1.2.9", "< =1.2.x", true],
      ["1.3.0", "< =1.2.x", false],
      ["1.0.0", "> =1.0.0", true],
      ["0.9.9", "> =1.0.0", false],
      ["1.0.0", "> =1", true],
      ["1.0.0", "> =1.0.0 < =1.0.0", true],
      ["1.0.1", "> =1.0.0 < =1.0.0", false],
      ["2.0.0", "3.0.0 || < =2.0.0", true],
      // "<x" is the empty set, "<=x" is any version
      ["1.0.0", "< =x", true],
      ["1.0.0", "> =*", true],
    ]);
  });

  test("a wildcard attached to a number is not a version", () => {
    testSatisfiesTable([
      ["1.2.3x", "1.2.3", false],
      ["1.2.3*", "*", false],
      ["1.2x", "*", false],
    ]);
    // npm calls these ranges invalid. Bun still reads "2x" as "2.x", but as malformed text that cannot narrow a range.
    testSatisfiesTable([
      ["2.5.0", "2x", true],
      ["3.0.0", "2x", false],
      ["1.2.9", "1.2x", true],
      ["2.5.0", "2x || 1", true],
      ["1.5.0", "2x || 1", true],
      ["1.5.0", ">=1 2x", true],
      ["1.5.0", ">=1 2.x", false],
    ]);
  });

  test("invalid versions never satisfy any range", () => {
    // node-semver: an unparseable version never satisfies anything. The version
    // argument used to be silently truncated ("1.2.3.4" -> 1.2.3) or coerced
    // ("" -> 0.0.0) and then matched against the range anyway.
    const invalid: [version: string, range: string][] = [
      ["1.2.3.4", "1.2.3"],
      ["1.2.3.4", "*"],
      ["1.2.3.4", ">=1.0.0"],
      ["", "*"],
      ["", ">=0.0.0"],
      ["", "0.x"],
      ["1.2.3 junk", "1.2.3"],
      ["1.2.3 || 1.2.4", "1.2.3"],
      ["1.2.3,", "1.2.3"],
      ["1.2.3-beta x", "1.2.3-beta"],
    ];
    expect(invalid.map(([version, range]) => ({ version, range, satisfies: satisfies(version, range) }))).toEqual(
      invalid.map(([version, range]) => ({ version, range, satisfies: false })),
    );

    // Versions node-semver accepts (leading "v", surrounding whitespace, build
    // metadata) and the deliberate "1.0.0rc1" npm-ism must keep matching.
    const valid: [version: string, range: string][] = [
      ["1.2.3", "1.2.3"],
      ["v1.2.3", "1.2.3"],
      [" 1.2.3 ", "1.2.3"],
      ["1.2.3\n", "1.2.3"],
      ["\t1.2.3", "^1.0.0"],
      ["1.2.3-beta.1", "1.2.3-beta.1"],
      ["1.2.3-beta.1+build.5", "1.2.3-beta.1"],
      ["1.2.3+build", ">=1.2.3"],
      ["1.0.0rc1", "1.0.0-rc1"],
    ];
    expect(valid.map(([version, range]) => ({ version, range, satisfies: satisfies(version, range) }))).toEqual(
      valid.map(([version, range]) => ({ version, range, satisfies: true })),
    );
  });

  test("pre-release snapshot", () => {
    expect(unsortedPrereleases.sort(Bun.semver.order)).toMatchSnapshot();
  });
});

test("bun install resolves a space-separated range as an intersection", async () => {
  // fstream@1.0.12 declares "mkdirp": ">=0.5 0", and npm installs mkdirp 0.5.6 for it.
  const range = ">=0.5 0";
  await using registry = Bun.serve({
    port: 0,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = pathname.slice(1);
      const versions: Record<string, object> =
        name === "parent"
          ? { "1.0.0": { dependencies: { transitive: range } } }
          : { "0.4.2": {}, "0.5.6": {}, "1.0.0": {}, "3.0.1": {} };
      return Response.json({
        name,
        "dist-tags": { latest: Object.keys(versions).at(-1) },
        versions: Object.fromEntries(
          Object.entries(versions).map(([version, manifest]) => [
            version,
            { name, version, ...manifest, dist: { tarball: `${origin}/${name}-${version}.tgz` } },
          ]),
        ),
      });
    },
  });
  using dir = tempDir("semver-space-range", {
    "package.json": JSON.stringify({
      name: "root",
      version: "1.0.0",
      dependencies: { direct: range, parent: "1.0.0" },
    }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.url.href}"\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect({
    direct: lockfile.match(/"direct@([^"]+)"/)?.[1],
    transitive: lockfile.match(/"transitive@([^"]+)"/)?.[1],
  }).toEqual({ direct: "0.5.6", transitive: "0.5.6" });
  expect(exitCode).toBe(0);
});

test("well-formed ranges give the same answers as node-semver (seeded differential)", () => {
  const { seed, next, pick, iterations } = seededRandom();

  const number = () => pick(["0", "0", "1", "1", "2", "3", "10"]);
  const prerelease = () =>
    pick(["", "", "", "", "-0", "-1", "-a", "-rc.0", "-rc.1", "-rc.10", "-alpha", "-beta.2", "-a.b", "-1a", "-a-b"]);
  const build = () => pick(["", "", "", "", "+b", "+b.1", "+001", "+a-b", "+build-1"]);
  const wildcard = ["x", "X", "*"];
  const operator = () =>
    pick([
      ...["", "", "", "^", "~", ">", ">=", "<", "<=", "=", "~>", "v", "=v", ">v"],
      ...["> ", ">= ", "< ", "<= ", "^ ", "~ ", "< =", "> ="],
    ]);

  const disagreements: object[] = [];
  for (let i = iterations(3000); i > 0; i--) {
    const tuples: string[][] = [];
    const tuple = () => {
      const numbers = [number(), number(), number()];
      tuples.push(numbers);
      return numbers;
    };
    const partial = () => {
      const [major, minor, patch] = tuple();
      switch (Math.floor(next() * 12)) {
        case 0:
          return major;
        case 1:
          return `${major}.${minor}`;
        case 2:
          return `${major}.${pick(wildcard)}`;
        case 3:
          return `${major}.${minor}.${pick(wildcard)}`;
        case 4:
          return `${major}.x.x`;
        case 5:
        case 6:
          return pick([...wildcard, "x.x", "*.*.*"]);
        default:
          return `${major}.${minor}.${patch}${prerelease()}${build()}`;
      }
    };
    const comparators = () =>
      Array.from({ length: pick([1, 1, 1, 2, 2, 3]) }, () => operator() + partial()).join(pick([" ", " ", "  "]));
    const alternative = () => (next() < 0.2 ? `${partial()} - ${partial()}` : comparators());
    const range = Array.from({ length: pick([1, 1, 1, 2, 2, 3]) }, alternative).join(
      pick([" || ", "||", " ||", "|| "]),
    );

    // Random numbers almost never land on a bound, so the version starts from a number of the range.
    let [major, minor, patch] = pick(tuples).map(Number);
    switch (Math.floor(next() * 5)) {
      case 0:
        [major, minor, patch] = [major + 1, 0, 0];
        break;
      case 1:
        [minor, patch] = [minor + 1, 0];
        break;
      case 2:
        patch += 1;
        break;
    }
    const version = `${major}.${minor}.${patch}${prerelease()}${build()}`;

    const parsed = new nodeSemver.Range(range);
    // node-semver drops a `>=0.0.0` comparator. A range with an alternative that is only that becomes `*`, which no
    // prerelease satisfies whatever the other alternatives say, and next to another comparator it stops excluding
    // the prereleases of 0.0.0. Bun keeps the comparator.
    if (nodeSemver.prerelease(version) && (parsed.range === "" || version.startsWith("0.0.0-"))) continue;
    const bun = satisfies(version, range);
    const node = parsed.test(version);
    if (bun !== node) disagreements.push({ satisfies: [version, range], bun, node });
  }
  expect({ seed, disagreements }).toEqual({ seed, disagreements: [] });
});

test("a range with a number above u64::MAX gives the same answers as node-semver (seeded differential)", () => {
  const { seed, next, pick, iterations } = seededRandom();

  const small = ["0", "1", "2", "10"];
  const wildcard = ["x", "X", "*"];
  const suffix = ["", "", "", "-2", "-0", "-beta.1", "+2"];
  const comparing = [">=", ">", "<", "<=", "^", "~"];
  const operator = ["", "", "=", "v", "~>", ...comparing];

  // One to three parts, exactly one of them above u64::MAX. Every shape here gives the same
  // answer in Bun and node-semver when the number is small. That leaves out a wildcard as the
  // first part (">x.1"), where they differ for any number.
  const partial = () => {
    // The number after a wildcard has no effect, and the text after it stays in the same comparator.
    if (next() < 0.3) {
      return `${pick(small)}.${pick(wildcard)}.${pick(numbersAboveU64Max)}${pick(suffix)}`;
    }
    const length = 1 + Math.floor(next() * 3);
    const bigAt = Math.floor(next() * length);
    const parts: string[] = [];
    for (let i = 0; i < length; i++) {
      if (i === bigAt) parts.push(pick(numbersAboveU64Max));
      else if (i > 0 && next() < 0.3) parts.push(pick(wildcard));
      else parts.push(pick(small));
    }
    return parts.join(".") + (length === 3 ? pick(suffix) : "");
  };
  const plain = () => `${pick(small)}.${pick(small)}.${pick(small)}`;
  const range = () => {
    switch (Math.floor(next() * 8)) {
      case 0:
        return `${pick(operator)}${partial()} || ${pick(operator)}${plain()}`;
      case 1:
        return `${pick(operator)}${plain()} || ${pick(operator)}${partial()}`;
      case 2:
        return `>=${plain()} ${pick(comparing)}${partial()}`;
      case 3:
        return `${pick(comparing)}${partial()} <${plain()}`;
      case 4:
        return `${plain()} - ${partial()}`;
      case 5:
        return `${partial()} - ${plain()}`;
      default:
        return pick(operator) + partial();
    }
  };

  const versions = ["0.0.0", "0.1.0", "1.0.0", "1.2.10", "2.0.0", "10.10.10"];
  const disagreements: object[] = [];
  for (let i = iterations(500); i > 0; i--) {
    const r = range();
    // Does what nodeSemver.satisfies() does, with the range parsed once for all versions.
    let parsed: InstanceType<typeof nodeSemver.Range> | undefined;
    try {
      parsed = new nodeSemver.Range(r);
    } catch {}
    for (const v of versions) {
      const bun = satisfies(v, r);
      const node = parsed !== undefined && parsed.test(v);
      if (bun !== node) disagreements.push({ satisfies: [v, r], bun, node });
    }
  }
  expect({ seed, disagreements }).toEqual({ seed, disagreements: [] });
});

// A registry where every package has the same versions. It serves manifests and no tarball.
function manifestRegistry(versions: string[], requested: string[] = []) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      requested.push(pathname);
      if (pathname.endsWith(".tgz")) return new Response("not found", { status: 404 });
      const name = pathname.slice(1);
      return Response.json({
        name,
        "dist-tags": { latest: versions.at(-1) },
        versions: Object.fromEntries(
          versions.map(version => [
            version,
            { name, version, dist: { tarball: new URL(`/${name}-${version}.tgz`, req.url).href } },
          ]),
        ),
      });
    },
  });
}

test.concurrent("bun install doesn't read build metadata after a bare major as a second range", async () => {
  // "latest" is 1.5.0, which used to be installed for both.
  const packages = {
    "digit-after-plus": { declared: "2+1", resolved: "2.5.0" },
    "x-after-plus": { declared: "^2+x", resolved: "2.5.0" },
  };
  await using registry = manifestRegistry(["0.5.0", "2.5.0", "3.5.0", "1.5.0"]);
  using dir = tempDir("semver-build-behind-major", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: Object.fromEntries(Object.entries(packages).map(([name, { declared }]) => [name, declared])),
    }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.url}"\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  const lockfile = Bun.JSONC.parse(await Bun.file(join(String(dir), "bun.lock")).text()) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  expect(Object.fromEntries(Object.keys(packages).map(name => [name, lockfile.packages[name]?.[0]]))).toEqual(
    Object.fromEntries(Object.entries(packages).map(([name, { resolved }]) => [name, `${name}@${resolved}`])),
  );
  expect(exitCode).toBe(0);
});

describe.concurrent("a number above u64::MAX in the package manager", () => {
  test("bun install does not resolve a dependency range that has one", async () => {
    // "^99999999999999999999" used to be read as "^0", so this installed foo@0.5.0.
    const requested: string[] = [];
    await using registry = manifestRegistry(["0.5.0", "1.0.0"], requested);
    using dir = tempDir("semver-number-above-u64-max", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { foo: "^99999999999999999999" },
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.url}"\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      'error: No version matching "^99999999999999999999" found for specifier "foo" (but package exists)',
    );
    expect(requested).toEqual(["/foo"]);
    expect(exitCode).toBe(1);
  });

  test("bun install does not apply an override whose selector has one", async () => {
    // Every rule sets 0.5.0, so a package resolves to 0.5.0 when its rule applies.
    const packages = {
      // No version satisfies these selectors, so the rule never applies. They used to be read as "^0".
      "no-lower-bound": { declared: "<2.0.0", selector: "^99999999999999999999", resolved: "1.0.0" },
      "no-lower-bound-inclusive": { declared: "<=1.0.0", selector: "^99999999999999999999", resolved: "1.0.0" },
      "any-version": { declared: "*", selector: "^99999999999999999999", resolved: "2.0.0" },
      "one-alternative": { declared: "^1.0.0", selector: "^1.0.0 || ^99999999999999999999", resolved: "1.0.0" },
      // A selector that fits still applies.
      "selector-fits": { declared: "<2.0.0", selector: "^1.0.0", resolved: "0.5.0" },
    };
    await using registry = manifestRegistry(["0.5.0", "1.0.0", "2.0.0"]);
    using dir = tempDir("semver-override-selector", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: Object.fromEntries(Object.entries(packages).map(([name, { declared }]) => [name, declared])),
        overrides: Object.fromEntries(
          Object.entries(packages).map(([name, { selector }]) => [`${name}@${selector}`, "0.5.0"]),
        ),
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.url}"\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) expect(stderr).toBe("");
    const lockfile = Bun.JSONC.parse(await Bun.file(join(String(dir), "bun.lock")).text()) as {
      packages: Record<string, [string, ...unknown[]]>;
    };
    expect(Object.fromEntries(Object.keys(packages).map(name => [name, lockfile.packages[name]?.[0]]))).toEqual(
      Object.fromEntries(Object.entries(packages).map(([name, { resolved }]) => [name, `${name}@${resolved}`])),
    );
    expect(exitCode).toBe(0);
  });

  // The parser used to read such a number as 0, so `patch` on "1.0.18446744073709551616" printed v1.0.1.
  test.each([
    {
      where: "in package.json",
      version: "1.0.18446744073709551616",
      arg: "patch",
      stderr: 'error: Current version "1.0.18446744073709551616" is not a valid semver\n',
    },
    {
      where: "as the argument",
      version: "1.0.0",
      arg: "1.0.18446744073709551616",
      stderr:
        'error: Invalid version argument: "1.0.18446744073709551616"\n' +
        "note: Valid options: patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific semver version\n",
    },
  ])("bun pm version rejects one $where", async ({ version, arg, stderr }) => {
    using dir = tempDir("semver-pm-version", {
      "package.json": JSON.stringify({ name: "app", version }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "version", arg, "--no-git-tag-version"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const after = (await Bun.file(join(String(dir), "package.json")).json()).version;
    expect({ stdout, stderr: stderrText, exitCode, after }).toEqual({
      stdout: "",
      stderr,
      exitCode: 1,
      after: version,
    });
  });
});

// `Group::intersects` (src/semver/intersects.rs) decides whether a ranged `overrides` key applies to a dependency edge.
// `*` (which `>=0.0.0` also parses to) meets everything. Between two ranges it compares the bounds by semver
// order and does not model the prerelease rule, so the rows here avoid a prerelease bound on both sides. An
// exact version, alone or as one `||` branch, meets a range when it satisfies it. The table below this one
// checks that against `Bun.semver.satisfies` (#43138).
describe("range intersection", () => {
  const cases: [string, string, boolean][] = [
    // exact versions
    ["1.0.0", "1.0.0", true],
    ["1.0.0", "1.0.1", false],
    ["1.0.0", "^1.0.0", true],
    ["1.0.0", "~1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["1.0.0", ">=1.0.0", true],
    ["1.0.0", ">1.0.0", false],
    ["1.0.0", "<=1.0.0", true],
    ["1.0.0", "<1.0.0", false],
    ["1.0.0", "1.0.0 || 2.0.0", true],
    ["3.0.0", "1.0.0 || 2.0.0", false],
    ["1.2.3", "1", true],
    ["1.2.3", "1.2", true],
    ["1.2.3", "1.3", false],
    ["1.2.3", "1.x", true],
    ["1.2.3", "1.2.x", true],
    ["1.2.3", "1.3.x", false],
    ["1.2.3", "*", true],
    ["1.2.3", "1.0.0 - 2.0.0", true],
    ["2.0.0", "1.0.0 - 2.0.0", true],
    ["2.0.1", "1.0.0 - 2.0.0", false],
    ["0.9.9", "1.0.0 - 2.0.0", false],

    // caret
    ["^1.0.0", "^1.2.0", true],
    ["^1.0.0", "^2.0.0", false],
    ["^1.0.0", "^1.0.0", true],
    ["^0.1.0", "^0.2.0", false],
    ["^0.1.0", "^0.1.5", true],
    ["^0.0.1", "^0.0.2", false],
    ["^0.0.1", "^0.0.1", true],
    ["^1.2.3", "1.2.3", true],
    ["^1.2.3", "1.2.2", false],
    ["^1.2.3", "2.0.0", false],
    ["^1.2.3", "1.9.9", true],

    // tilde
    ["~1.2.0", "~1.3.0", false],
    ["~1.2.0", "~1.2.5", true],
    ["~1.2.0", "^1.0.0", true],
    ["~1.2.0", "1.3.0", false],
    ["~1.2.0", "1.2.9", true],
    ["~1.2", "~1.3", false],
    ["~1", "~1.9", true],
    ["~1", "~2", false],
    ["~0.1.0", "~0.2.0", false],

    // plain comparators
    [">=1.0.0 <2.0.0", ">=2.0.0", false],
    [">=1.0.0 <=2.0.0", ">=2.0.0", true],
    [">=1.0.0 <2.0.0", ">=1.9.0", true],
    [">1.0.0", "<1.0.0", false],
    [">1.0.0", "<=1.0.0", false],
    [">=1.0.0", "<=1.0.0", true],
    [">=1.0.0", "<1.0.0", false],
    ["<1.0.0", "<2.0.0", true],
    [">1", ">2", true],
    [">=1.0.0", ">=5.0.0", true],
    ["<1.0.0", ">=0.0.1", true],
    ["<1.0.0", ">=0.0.1 <0.5.0", true],
    [">=1.0.0 <1.5.0", ">=1.5.0 <2.0.0", false],
    [">=1.0.0 <=1.5.0", ">=1.5.0 <2.0.0", true],
    [">=1.0.0 <1.5.0", ">1.5.0 <2.0.0", false],
    [">1.0.0 <=1.0.1", "*", true],
    [">1.0.0 <=1.0.1", "1.0.1", true],
    [">1.0.0 <1.0.1", "1.0.0", false],
    [">1.0.0 <1.0.1", "1.0.1", false],
    [">=1.0.0 <1.0.0", "*", false],
    [">=1.0.0 <1.0.0", "1.0.0", false],
    ["<1.0.0 >=1.0.0", ">=0.0.0", false],
    [">2.0.0 <1.0.0", "* || ^1.0.0", false],

    // partial versions after a comparator: `>3` is `>3.MAX.MAX`, `<=1` is `<=1.MAX.MAX`
    [">3", "3.5.0", false],
    [">3", "4.0.0", true],
    [">3", "^4", true],
    [">3.0", "^3.0", true],
    [">3.0", "3.1.0", true],
    [">3.0", "3.0.9", false],
    [">3.0", "~3.1", true],
    [">1 <3", "^2", true],
    [">1 <=2", "*", true],
    ["<=1", "^1", true],
    ["<=1", "^2", false],
    ["<=1", "2.0.0-0", false],
    ["<1", "^1", false],
    ["<1", "^0.9", true],
    [">=1", "^1", true],
    [">=2", "^1", false],

    // x-ranges and wildcards
    ["1.x", "2.x", false],
    ["1.x", "1.2.x", true],
    ["1.2.x", "1.3.x", false],
    ["1.2.x", "1.2.x", true],
    ["1", "1.2.3", true],
    ["1", "2.0.0", false],
    ["1", "2", false],
    ["1", "1.2", true],
    ["*", "1.0.0", true],
    ["*", "^3.0.0", true],
    ["*", "*", true],
    ["*", "2.0.0-0", true],
    [">=0.0.0", "2.0.0-0", true],
    [">=0.0.0-0", "1.0.0-rc.1", false],
    [">=0.0.0-0", "0.0.0-1", true],
    ["* || ^1.0.0", "2.0.0-beta.0", true],
    [">=0.0.0 || 1.0.0", "2.0.0-beta.0", true],
    ["1.0.0-rc.1 || *", "<1.0.0", true],
    ["x", "2.x", true],
    ["1.X", "1.2.3", true],
    ["1.*", "2.0.0", false],

    // hyphen ranges
    ["1.0.0 - 2.0.0", "2.0.0", true],
    ["1.0.0 - 2.0.0", "2.0.1", false],
    ["1.0.0 - 1.5.0", "1.6.0 - 2.0.0", false],
    ["1.0.0 - 1.5.0", "1.5.0 - 2.0.0", true],
    ["1.0.0 - 1.5.0", "^1.5.0", true],
    ["1.0.0 - 1.5.0", "^1.5.1", false],
    ["1.0.0 - 1.5.0", "~1.4.0", true],
    ["1.0.0 - 1.5.0", "~1.6.0", false],
    ["1.2 - 1.4", "1.4.9", true],
    ["1.2 - 1.4", "1.5.0", false],
    ["1.2 - 1.4", "1.1.9", false],

    // || lists
    ["1.0.0 || 2.0.0", "2.0.0", true],
    ["1.0.0 || 2.0.0", "3.0.0", false],
    ["^1 || ^2", "^3", false],
    ["^1 || ^3", "^2 || ^3", true],
    ["^1 || ^3", "^2 || ^4", false],
    ["<1 || >3", "^2", false],
    ["<1 || >3", ">=3", true],
    ["<1 || >3", "^1 || ^4", true],
    ["1.0.0 || 1.0.1", "1.0.1 || 1.0.2", true],
    ["1.0.0 || 1.0.1", "1.0.2 || 1.0.3", false],
    ["^1.0.0 || ^2.0.0", ">=1.5.0 <2.5.0", true],
    ["^1.0.0 || ^3.0.0", ">=2.0.0 <3.0.0", false],

    // exact prerelease versions
    ["1.0.0-rc.1", "1.0.0-rc.1", true],
    ["1.0.0-rc.1", "1.0.0-rc.2", false],
    ["1.0.0-rc.1", "1.0.0", false],
    ["1.0.0-rc.1", ">=1.0.0-rc.1", true],
    ["1.0.0-rc.1", ">1.0.0-rc.1", false],
    ["1.0.0-rc.1", ">=1.0.0-rc.0", true],
    ["1.0.0-rc.1", "<1.0.0-rc.1", false],
    ["1.0.0-rc.1", "<=1.0.0-rc.1", true],
    ["1.0.0-rc.1", "<1.0.0", false],
    ["1.0.0-rc.1", "^1.0.0", false],
    ["1.0.0-rc.1", "^1.0.0-rc.0", true],
    ["1.0.0-rc.1", "^1.0.0-rc.2", false],
    ["1.0.0-rc.1", "^0.9.0", false],
    ["1.0.0-rc.1", "*", true],
    ["1.0.0-rc.1", ">=0.0.0", true],
    ["2.0.0-beta", "^2.0.0", false],
    ["2.0.0-beta", "^2.0.0-alpha", true],
    ["2.0.0-beta", "^1.0.0 || ^2.0.0-alpha", true],
    ["2.0.0-beta", "^1.0.0 || ^2.0.0", false],
    ["1.0.0-alpha.1", "1.0.0-alpha.1 || 1.0.0-alpha.2", true],
    ["1.0.0-alpha.3", "1.0.0-alpha.1 || 1.0.0-alpha.2", false],
    ["1.0.0-alpha", "1.0.0-alpha.1", false],
    ["1.0.0-alpha", ">=1.0.0-alpha <1.0.0-alpha.1", true],

    // an exact version inside a || list is held to the same rule as a lone one
    ["9.0.0-beta.0 || 9.0.0-beta.1", "<9.0.0", false],
    ["9.0.0-beta.0 || 9.0.0", "<9.0.1", true],
    ["1.0.0-rc.1 || 1.0.0", ">=1.0.0-0 <1.0.0", true],
    ["^1.0.0 || 2.0.0-beta", "<2.0.0", true],
    ["^2.0.0 || 1.0.0-rc.1", ">=0.9.0 <1.0.0", false],
    ["^2.0.0 || 1.0.0-rc.1", ">=1.0.0-rc.0 <1.0.0", true],
    ["3.0.0-pre || ^1.0.0", "^3.0.0 || ^4.0.0", false],
    ["3.0.0-pre || ^1.0.0", "^3.0.0-0 || ^4.0.0", true],
  ];

  test.each(cases)("%s and %s: %p", (left, right, expected) => {
    expect(semverIntersects(left, right)).toBe(expected);
    expect(semverIntersects(right, left)).toBe(expected);
  });

  type Row = [left: string, right: string, expected: boolean];
  const bothWays = (rows: Row[]) =>
    rows.flatMap(([left, right, expected]): Row[] => [
      [left, right, expected],
      [right, left, expected],
    ]);
  const check = (rows: Row[]) =>
    expect(bothWays(rows).map(([left, right]) => [left, right, semverIntersects(left, right)])).toEqual(bothWays(rows));

  test("every spelling of any version meets an exact prerelease", () => {
    const any = [
      ...["*", "x", "X", "x.x.x", "=x", ">=*", "<=*", ">=x.x", "<= x", "^x", "~x", "~>*"],
      ...[">=0.0.0", ">=0", ">=x.1.2"],
    ];
    check(any.flatMap(range => ["3.0.2-a", "0.0.0-0", "1.0.0"].map((version): Row => [range, version, true])));
    check(any.map(range => [`${range} || 5.0.0`, "3.0.2-a", true]));
    // a lower bound that names a prerelease is a bound, not any version
    check([[">=0.0.0-0", "3.0.2-a", false]]);
  });

  test("a derived bound is the bound node-semver derives", () => {
    check([
      // `^4.0.1` ends at `<5.0.0-0` (#41371)
      [">=5.0.0-alpha.0 <8.0.0", "^4.0.1", false],
      [">=5.0.0-alpha.0 <8.0.0", ">=4.0.1 <5.0.0", true],
      [">=1.3.0-0", "~1.2.3", false],
      [">=0.0.2-0", "^0.0.1", false],
      [">=2.0.0-0", "1.x", false],
      [">=2.0.0-0", "<2", false],
      [">=2.0.0-0", "<=1", false],
      [">=1.3.0-0", "<=1.2", false],
      [">=2.0.0-0", "0.5.0 - 1", false],
      // `>1` starts at `>=2.0.0`
      [">1", "^1.0.0", false],
      [">1", "<2.0.0", false],
      [">1", "<=2.0.0-rc.1", false],
      [">1", "<=2.0.0", true],
      [">1.2", "~1.2.0", false],
      [">1.2", "<=1.3.0", true],
    ]);
  });

  test("the empty set meets nothing", () => {
    const [big] = numbersAboveU64Max;
    const empty = ["<x", ">*", "<0.0.0-0", `>${u64Max}`, `>${u64Max}.${u64Max}`, `^${big}`, `* || <${big}`];
    const ranges = ["*", "<2", "<=1.0.0", ">=0.0.0-0", "^1.0.0", "1.0.0", "0.0.0-0", "<x"];
    check(empty.flatMap(left => ranges.map((right): Row => [left, right, false])));
    check([
      ["<x || 1", "^1.0.0", true],
      ["<=0.0.0-0", "<1", true],
      ["<0.0.0-1", "<1", true],
    ]);
  });

  // An exact version is a range with one member, so intersecting it with a range is `satisfies`. A prerelease
  // version therefore satisfies `<x` or `>=x` only through a comparator that names a prerelease of its own
  // major.minor.patch. node-semver tests an exact version against each comparator on its own, which differs
  // for a key like `>=1.0.0-0 <1.0.0`: `satisfies` admits `1.0.0-rc.1`, node-semver's `intersects` does not.
  // Bun follows `satisfies` so that an override key means what `Bun.semver.satisfies` says. `*` is not in
  // this list: it meets every version, and `satisfies` rejects a prerelease against it.
  const versions = [
    "0.0.0",
    "0.0.1",
    "0.1.0",
    "0.9.9",
    "1.0.0",
    "1.0.1",
    "1.2.3",
    "1.9.9",
    "2.0.0",
    "2.0.1",
    "3.0.0",
    "1.0.0-0",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-beta",
    "1.0.0-rc.1",
    "1.2.3-beta.2",
    "2.0.0-0",
    "2.0.0-alpha.0",
    "2.0.0-rc.1",
    "3.0.0-pre",
  ];
  const ranges = [
    "1",
    "1.2",
    "1.x",
    "1.2.x",
    "^1.0.0",
    "^1.2.3",
    "^0.1.0",
    "^0.0.1",
    "~1.2.3",
    "~1.0.0",
    "~0.1.0",
    ">=1.0.0",
    ">1.0.0",
    "<2.0.0",
    "<=2.0.0",
    ">=1.0.0 <2.0.0",
    ">1.0.0 <=2.0.0",
    "1.0.0 - 2.0.0",
    "1.0.0 || 2.0.0",
    "^1 || ^3",
    "<1 || >=2",
    ">=1.0.0-0 <2",
    ">=1.0.0-alpha <1.0.0",
    ">=1.0.0-alpha.1 <1.0.0-beta",
    ">=1.0.0-beta <=2.0.0-rc.1",
    "^1.0.0-alpha",
    "^1.0.0-rc.1",
    "~1.2.3-beta.1",
    "^2.0.0-0",
    ">=2.0.0-alpha.0 <3",
    ">=2.0.0-rc.1",
    "<2.0.0-rc.1",
    ">1",
    ">1 <3",
    "<=1",
    ">0.9 <2.0.0-rc.1",
    "1.0.0-alpha || 2.0.0-rc.1",
    "2.0.0-0",
    "1.0.0-alpha",
  ];
  test.each(versions)("an exact version %s intersects a range when it satisfies it", version => {
    const got = Object.fromEntries(
      ranges.map(range => [range, [semverIntersects(version, range), semverIntersects(range, version)]]),
    );
    const want = Object.fromEntries(
      ranges.map(range => [range, [satisfies(version, range), satisfies(version, range)]]),
    );
    expect(got).toEqual(want);
  });
});

test("a version range with >=256 || comparators does not abort", async () => {
  const range = Array(300).fill("1.0.0").join(" || ");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(String(Bun.semver.satisfies("1.0.0", ${JSON.stringify(range)})))`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(stdout).toBe("true");
  expect(exitCode).toBe(0);
}, 30_000);

test("a range with a dangling '-' after a skipped tag does not crash the parser", async () => {
  // Found by fuzzing: a "-" that follows a skipped garbage token (or "||") used to
  // reach `unreachable!()` in the range parser once at least one comparator had
  // already been parsed, crashing the process.
  const fuzzed = "> > > > > > > `{" + "`${".repeat(34) + "- - - 1e-323-alpha.1";
  const cases = [
    // "" is not a valid version, so it never satisfies anything
    ["", fuzzed],
    ["1.0.0", fuzzed],
    ["", "1 || -"],
    ["1.0.0", "1 || -"],
    ["2.0.0", "1 || -"],
    ["1.0.0", "1 a - b"],
    // the skipped "-q" chunk must not swallow the "||", so "^2" still matches
    ["2.5.0", "^1 || -q ^2"],
  ];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdout.write(JSON.stringify(${JSON.stringify(cases)}.map(([version, range]) => Bun.semver.satisfies(version, range))))`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([false, true, false, true, false, true, true]);
  expect(exitCode).toBe(0);
});

test("a version range made of hundreds of thousands of 'v' or '= ' prefix characters evaluates promptly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const n = 1000000;
        const vRun = Buffer.alloc(n, "v").toString();
        const eqRun = Buffer.alloc(n, "= ").toString();
        process.stdout.write(
          JSON.stringify([
            Bun.semver.satisfies("1.0.0", vRun),
            Bun.semver.satisfies("1.0.0", eqRun),
          ]),
        );
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([true, true]);
  expect(exitCode).toBe(0);
}, 30_000);

test("a version range with hundreds of thousands of '||' or AND-ed comparators evaluates without crashing", async () => {
  // Ranges are stored as linked lists: one node per "||" alternative and one
  // node per space-separated AND comparator. Walking a very long chain must be
  // iterative; a recursive traversal overflows the thread stack on a ~750KB
  // range string and the child process dies with SIGSEGV instead of returning
  // an answer. The chains are built inside the spawned script because a string
  // this large cannot be passed as a single argv entry on Linux.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const n = 250000;
        const orChain = Array(n).fill("1").join("||");
        const andChain = Array(n).fill(">1").join(" ");
        process.stdout.write(
          JSON.stringify([
            // "2.0.0" matches none of the "1" alternatives, so every OR node is visited
            Bun.semver.satisfies("2.0.0", orChain),
            // a match at the very end of the OR chain is still found
            Bun.semver.satisfies("2.0.0", orChain + "||2"),
            // every AND-ed ">1" comparator matches, so every AND node is visited
            Bun.semver.satisfies("2.0.0", andChain),
            // the first AND comparator fails, so this short-circuits
            Bun.semver.satisfies("1.0.0", andChain),
          ]),
        );
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([false, true, true, false]);
  expect(exitCode).toBe(0);
}, 30_000);
