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

import { bunEnv, bunExe, tempDir } from "harness";
import nodeSemver from "semver";
import { unsortedPrereleases } from "./semver-fixture.js";
const { satisfies, order } = Bun.semver;

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

describe("Bun.semver.order()", () => {
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
});

describe("Bun.semver.satisfies()", () => {
  test("expected errors", () => {
    expect(satisfies).toBeInstanceOf(Function);
    expect(() => {
      // @ts-expect-error
      satisfies();
    }).toThrow("Expected two arguments");
    expect(() => {
      // @ts-expect-error
      satisfies("1.2.3");
    }).toThrow("Expected two arguments");
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

  test("a version with a number above u64::MAX satisfies nothing", () => {
    // These used to read the number as 0, so "1.0.18446744073709551616" satisfied "1.0.0".
    // node-semver returns false: the version is invalid.
    const ranges = ["*", "", "x", ">=0.0.0", `<=${u64Max}.${u64Max}.${u64Max}`, "1.0.0", "^1.0.0", "1.x", ">=1.0.0-0"];
    for (const big of numbersAboveU64Max) {
      for (const version of versionsWith(big)) {
        for (const range of ranges) {
          testSatisfies(range, version, false);
        }
        testSatisfies(version, version, false);
      }
    }
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
    for (const big of numbersAboveU64Max) {
      for (const range of rangesWith(big)) {
        for (const version of versions) {
          testSatisfies(range, version, false);
        }
      }
    }

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

  test("pre-release snapshot", () => {
    expect(unsortedPrereleases.sort(Bun.semver.order)).toMatchSnapshot();
  });
});

test("a number above u64::MAX gives the same answers as node-semver (seeded differential)", () => {
  // Replay a failure with BUN_SEMVER_FUZZ_SEED=<seed>. Soak with BUN_SEMVER_FUZZ_ITERS=<n>.
  const seed = Number(process.env.BUN_SEMVER_FUZZ_SEED ?? 0x73656d76) >>> 0;
  const iterations = Number(process.env.BUN_SEMVER_FUZZ_ITERS ?? 100);
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];

  const small = ["0", "1", "2", "10"];
  const wildcard = ["x", "X", "*"];
  const suffix = ["", "", "", "-2", "-0", "-beta.1", "+2"];
  const comparing = [">=", ">", "<", "<=", "^", "~"];
  const operator = ["", "", "=", "v", "~>", ...comparing];

  // One to three parts, exactly one of them above u64::MAX. Every shape here gives the same
  // answer in Bun and node-semver when the number is small. That leaves out two shapes where
  // they differ for any number: a wildcard as the first part (">x.1"), and a comparator with
  // no operator inside an intersection (">=1.0.0 2.x").
  const partial = (wildcards: boolean) => {
    // The number after a wildcard has no effect, and the text after it stays in the same comparator.
    if (wildcards && next() < 0.3) {
      return `${pick(small)}.${pick(wildcard)}.${pick(numbersAboveU64Max)}${pick(suffix)}`;
    }
    const length = 1 + Math.floor(next() * 3);
    const bigAt = Math.floor(next() * length);
    const parts: string[] = [];
    for (let i = 0; i < length; i++) {
      if (i === bigAt) parts.push(pick(numbersAboveU64Max));
      else if (wildcards && i > 0 && next() < 0.3) parts.push(pick(wildcard));
      else parts.push(pick(small));
    }
    return parts.join(".") + (length === 3 ? pick(suffix) : "");
  };
  const plain = () => `${pick(small)}.${pick(small)}.${pick(small)}`;
  const range = () => {
    switch (Math.floor(next() * 8)) {
      case 0:
        return `${pick(operator)}${partial(true)} || ${pick(operator)}${plain()}`;
      case 1:
        return `${pick(operator)}${plain()} || ${pick(operator)}${partial(true)}`;
      case 2:
        return `>=${plain()} ${pick(comparing)}${partial(true)}`;
      case 3:
        return `${pick(comparing)}${partial(true)} <${plain()}`;
      case 4:
        return `${plain()} - ${partial(true)}`;
      case 5:
        return `${partial(true)} - ${plain()}`;
      default:
        return pick(operator) + partial(true);
    }
  };

  const versions = ["0.0.0", "0.1.0", "1.0.0", "1.2.10", "2.0.0", "10.10.10"];
  const attempt = (fn: () => number) => {
    try {
      return fn();
    } catch {
      return "throws";
    }
  };
  const disagreements: object[] = [];
  for (let i = 0; i < iterations; i++) {
    const r = range();
    for (const v of versions) {
      const bun = satisfies(v, r);
      const node = nodeSemver.satisfies(v, r);
      if (bun !== node) disagreements.push({ satisfies: [v, r], bun, node });
    }

    const version = partial(false);
    const bun = attempt(() => order(version, "1.0.0"));
    const node = attempt(() => nodeSemver.compare(version, "1.0.0"));
    if (bun !== node) disagreements.push({ order: [version, "1.0.0"], bun, node });
    if (satisfies(version, "*") !== nodeSemver.satisfies(version, "*")) {
      disagreements.push({ satisfies: [version, "*"], bun: satisfies(version, "*") });
    }
  }
  expect({ seed, disagreements }).toEqual({ seed, disagreements: [] });
});

test("bun install does not resolve a dependency range that has a number above u64::MAX", async () => {
  // "^99999999999999999999" used to be read as "^0", so this installed foo@0.5.0.
  const requested: string[] = [];
  await using registry = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      requested.push(pathname);
      if (pathname !== "/foo") return new Response("not found", { status: 404 });
      return Response.json({
        name: "foo",
        "dist-tags": { latest: "1.0.0" },
        versions: Object.fromEntries(
          ["0.5.0", "1.0.0"].map(version => [
            version,
            { name: "foo", version, dist: { tarball: new URL(`/foo-${version}.tgz`, req.url).href } },
          ]),
        ),
      });
    },
  });
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
  expect(JSON.parse(stdout)).toEqual([true, true, false, true, false, true, true]);
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
