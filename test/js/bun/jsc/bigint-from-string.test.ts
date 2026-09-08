import { describe, expect, test } from "bun:test";

// StringToBigInt (BigInt(string), and a BigInt compared with a string through
// ==, <, <=, >, >=) accepts a sign or a radix prefix only when at least one
// digit follows it. The whitespace-only string is the one input with no digits
// that has a value (0n). JSC gave "+", "-" and "0x" followed by nothing but
// whitespace the value 0n too, so BigInt("-") was 0n and 0n == "-" was true.

const whitespace = ["", " ", "\t", "\n", "\r\n", "\u00a0", "\u2028", "\u3000", "\ufeff", " \t\n "];

/** `body` with each kind of whitespace before it, after it, and on both sides. */
function padded(body: string): string[] {
  const out = new Set<string>();
  for (const ws of whitespace) {
    out.add(ws + body);
    out.add(body + ws);
    out.add(ws + body + ws);
  }
  return [...out];
}

const noDigits = ["+", "-", "0x", "0X", "0b", "0B", "0o", "0O"].flatMap(padded);

const withDigits: [string, bigint][] = [
  ["0", 0n],
  ["+0", 0n],
  ["-0", 0n],
  ["7", 7n],
  ["+7", 7n],
  ["-7", -7n],
  ["007", 7n],
  ["-007", -7n],
  ["0x1f", 31n],
  ["0B101", 5n],
  ["0o17", 15n],
  ["123456789012345678901234567890", 123456789012345678901234567890n],
  ["-123456789012345678901234567890", -123456789012345678901234567890n],
];

describe("a sign or radix prefix with no digits", () => {
  test("BigInt() throws SyntaxError", () => {
    for (const string of noDigits) {
      expect(() => BigInt(string), JSON.stringify(string)).toThrow(SyntaxError);
    }
  });

  test("is never loosely equal to a BigInt", () => {
    for (const string of noDigits) {
      for (const bigint of [0n, 1n, -1n]) {
        // @ts-expect-error
        expect(bigint == string, `${bigint}n == ${JSON.stringify(string)}`).toBe(false);
        // @ts-expect-error
        expect(string == bigint, `${JSON.stringify(string)} == ${bigint}n`).toBe(false);
        // @ts-expect-error
        expect(bigint != string, `${bigint}n != ${JSON.stringify(string)}`).toBe(true);
      }
    }
  });

  test("compares as undefined (every relational operator is false)", () => {
    for (const string of noDigits) {
      for (const bigint of [0n, 1n, -1n, 2n ** 64n, -(2n ** 64n)]) {
        expect(
          [
            bigint < string,
            bigint <= string,
            bigint > string,
            bigint >= string,
            string < bigint,
            string <= bigint,
            string > bigint,
            string >= bigint,
          ],
          `${bigint}n vs ${JSON.stringify(string)}`,
        ).toEqual([false, false, false, false, false, false, false, false]);
      }
    }
  });

  test("other malformed signs and prefixes still throw", () => {
    for (const string of ["+ 1", "- 1", "0x 1", "+-", "-+", "++1", "--1", "+-1", "+0x1", "-0b1", "0x+1", "0b-1", "1+", "1-"]) {
      expect(() => BigInt(string), JSON.stringify(string)).toThrow(SyntaxError);
    }
  });
});

describe("controls", () => {
  test("whitespace alone is 0n", () => {
    for (const string of whitespace) {
      expect(BigInt(string), JSON.stringify(string)).toBe(0n);
      // @ts-expect-error
      expect(0n == string, `0n == ${JSON.stringify(string)}`).toBe(true);
      expect(1n > string, `1n > ${JSON.stringify(string)}`).toBe(true);
    }
  });

  test("digits with a sign or prefix parse with whitespace on either side", () => {
    for (const [body, expected] of withDigits) {
      for (const string of padded(body)) {
        expect(BigInt(string), JSON.stringify(string)).toBe(expected);
        // @ts-expect-error
        expect(expected == string, `${expected}n == ${JSON.stringify(string)}`).toBe(true);
        expect(expected + 1n > string, `${expected + 1n}n > ${JSON.stringify(string)}`).toBe(true);
        expect(expected - 1n < string, `${expected - 1n}n < ${JSON.stringify(string)}`).toBe(true);
      }
    }
  });
});
