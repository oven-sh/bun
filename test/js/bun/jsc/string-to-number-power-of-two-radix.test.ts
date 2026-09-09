import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import vm from "node:vm";
import { join } from "path";

// A string of binary, octal, base-4, hex or base-32 digits with more than 53
// significant bits must convert to the nearest double (ties to even), the way
// a decimal string does. One JSC function (parseIntOverflow, oven-sh/WebKit#597)
// does this for parseInt with a power-of-two radix, for ToNumber on "0x" /
// "0o" / "0b" strings, for numeric literals that JSC lexes itself (eval,
// new Function, node:vm), and, through Bun's lexers, for literals in
// transpiled files and in imported JSONC. Number(BigInt) is the reference:
// BigInt holds the digits exactly and its ToNumber rounds once.

const prefix: Record<number, string> = { 2: "0b", 8: "0o", 16: "0x" };

function nearestDouble(digits: string, radix: number): number {
  let value = 0n;
  for (const c of digits) value = value * BigInt(radix) + BigInt(parseInt(c, radix));
  return Number(value);
}

// Summing the digits in a double from the left gets the first group wrong and
// the second right. Summing from the right, as JSC did, is the other way round.
const wrongLeftToRight = ["2f32df6d0cf0355a", "a0761d6478bd642f", "ffffffffffffffff"];
const wrongRightToLeft = ["97b89d834f82bbef", "130000000000009", "16000000000000a"];

// What a source expression evaluates to after Bun's transpiler has lexed and
// printed it, rather than JSC.
const transpiler = new Bun.Transpiler({ loader: "js" });
function transpiledValue(expression: string): unknown {
  return new Function(transpiler.transformSync(`var value = ${expression};`) + "return value;")();
}

describe("power-of-two radix strings above 2^53 round to the nearest double", () => {
  test("parseInt", () => {
    // The reported values. Each came out one ulp too high.
    expect(parseInt("97b89d834f82bbef", 16)).toBe(10932661282742122496);
    expect(parseInt("0x97b89d834f82bbef")).toBe(10932661282742122496);
    expect(parseInt("1700774500551360345014", 8)).toBe(17311718268872018432);
    expect(parseInt("1kqg9a599t95", 32)).toBe(59479501168768296);

    // 2^55 + 2^53 + 5: accumulating the digits in a double rounds twice and
    // lands on ...960. The nearest double is ...968.
    const cases: [string, number][] = [
      ["10100000000000000000000000000000000000000000000000000101", 2],
      ["2200000000000000000000000011", 4],
      ["3500000000000000005", 8],
      ["130000000000009", 16],
      ["16000000000000a", 16],
      ["2f32df6d0cf0355a", 16],
      ["1i000000000r", 32],
      // Ties at 2^53 and carries into the next power of two.
      ["20000000000001", 16],
      ["20000000000003", 16],
      ["20000000000001000000000001", 16],
      ["ffffffffffffffff", 16],
      ["1777777777777777777777", 8],
      ["vvvvvvvvvvvvv", 32],
    ];
    for (const [digits, radix] of cases) {
      const want = nearestDouble(digits, radix);
      expect(parseInt(digits, radix)).toBe(want);
      expect(parseInt("-" + digits, radix)).toBe(-want);
      expect(parseInt("0000000000" + digits, radix)).toBe(want);
      // A 16-bit string takes the char16_t instantiation.
      expect(parseInt("\u3000" + digits + "\u{1F600}", radix)).toBe(want);
    }
    expect(parseInt("10100000000000000000000000000000000000000000000000000101", 2)).toBe(45035996273704968);
  });

  test("Number() and ToNumber on 0x / 0o / 0b strings", () => {
    expect(Number("0x97b89d834f82bbef")).toBe(10932661282742122496);
    expect(Number("0o1700774500551360345014")).toBe(17311718268872018432);
    expect(Number("0b10100000000000000000000000000000000000000000000000000101")).toBe(45035996273704968);
    expect(Number("0X16000000000000A")).toBe(99079191802150928);
    expect(+"0x130000000000009").toBe(nearestDouble("130000000000009", 16));
    // @ts-expect-error arithmetic on a string is the point
    expect("0o3500000000000000005" - 0).toBe(nearestDouble("3500000000000000005", 8));
    expect(Number(" 0x97b89d834f82bbef\u3000")).toBe(10932661282742122496);
  });

  test("literals that JSC lexes at runtime", () => {
    expect(eval("0x97b89d834f82bbef")).toBe(10932661282742122496);
    expect(eval("0x97b8_9d83_4f82_bbef")).toBe(10932661282742122496);
    expect(eval("0o1700774500551360345014")).toBe(17311718268872018432);
    expect(eval("0b10100000000000000000000000000000000000000000000000000101")).toBe(45035996273704968);
    expect(new Function("return 0x16000000000000a;")()).toBe(99079191802150928);
    expect(vm.runInNewContext("0x97b89d834f82bbef")).toBe(10932661282742122496);
    expect(vm.runInNewContext("01700774500551360345014")).toBe(17311718268872018432); // legacy octal
    // A 16-bit source string.
    expect(eval("'\u3000', 0x130000000000009")).toBe(nearestDouble("130000000000009", 16));
    for (const digits of [...wrongLeftToRight, ...wrongRightToLeft]) {
      expect(eval("0x" + digits)).toBe(nearestDouble(digits, 16));
    }
  });

  test("literals in a transpiled file", () => {
    // This file goes through Bun's lexer, which hands a literal of 2^53 or more
    // to the same JSC function, so these hex literals and eval() must agree with
    // the decimal literals and with BigInt.
    expect(0x2f32df6d0cf0355a).toBe(3401026328079644160);
    expect(0x2f32df6d0cf0355a).toBe(Number(0x2f32df6d0cf0355an));
    expect(0x2f32df6d0cf0355a).toBe(eval("0x2f32df6d0cf0355a"));
    expect(0xa0761d6478bd642f).toBe(11562461410679941120);
    expect(0xa076_1d64_78bd_642f).toBe(11562461410679941120);
    expect(0xffffffffffffffff).toBe(18446744073709551616);
    expect(0x97b89d834f82bbef).toBe(10932661282742122496);
    expect(0o274626766641474032532).toBe(3401026328079644160);
    expect(0b1010000001110110000111010110010001111000101111010110010000101111).toBe(11562461410679941120);
    expect(0b1010000001110110000111010110010001111000101111010110010000101111).toBe(0xa0761d6478bd642f);

    for (const digits of [...wrongLeftToRight, ...wrongRightToLeft]) {
      const want = nearestDouble(digits, 16);
      for (const literal of [
        "0x" + digits,
        "0X" + digits.toUpperCase(),
        "0x" + digits.replace(/(....)(?=.)/g, "$1_"),
        "0o" + BigInt("0x" + digits).toString(8),
        "0" + BigInt("0x" + digits).toString(8), // legacy octal
        "0b" + BigInt("0x" + digits).toString(2),
      ]) {
        expect({ literal, value: transpiledValue(literal) }).toEqual({ literal, value: want });
      }
    }
    // Infinity and the largest double still print as something that evaluates back.
    expect(transpiledValue("0x1" + "0".repeat(256))).toBe(Infinity);
    expect(transpiledValue("-0b1" + "0".repeat(1024))).toBe(-Infinity);
    expect(transpiledValue("0xfffffffffffff8" + "0".repeat(242))).toBe(Number.MAX_VALUE);
  });

  test("hex and octal numbers in JSONC", async () => {
    using dir = tempDir("pow2-radix-jsonc", {
      "values.jsonc": `{
        // JSONC takes JS number syntax
        "a": 0x2f32df6d0cf0355a, "b": 0xa076_1d64_78bd_642f, "c": 0x97b89d834f82bbef, "d": 0o274626766641474032532,
        "big": 0x1${"0".repeat(256)}, "small": [0x1fffffffffffff, 0XA, 017]
      }`,
    });
    const { default: jsonc } = await import(join(String(dir), "values.jsonc"));
    expect(jsonc).toEqual({
      a: 3401026328079644160,
      b: 11562461410679941120,
      c: 10932661282742122496,
      d: 3401026328079644160,
      big: Infinity,
      small: [2 ** 53 - 1, 10, 15],
    });
    expect(Bun.JSONC.parse("[0x2f32df6d0cf0355a, 0xa0761d6478bd642f, 0x97b89d834f82bbef]")).toEqual([
      3401026328079644160, 11562461410679941120, 10932661282742122496,
    ]);
  });

  test("the Number.MAX_VALUE / Infinity boundary", () => {
    // (2^53 - 1) * 2^971 is the largest double. The midpoint to 2^1024 ties to
    // even, which is up, to Infinity. One below the midpoint is still finite.
    expect(parseInt("fffffffffffff8" + "0".repeat(242), 16)).toBe(Number.MAX_VALUE);
    expect(parseInt("fffffffffffffb" + "f".repeat(242), 16)).toBe(Number.MAX_VALUE);
    expect(parseInt("fffffffffffffc" + "0".repeat(242), 16)).toBe(Infinity);
    expect(Number("0x1" + "0".repeat(256))).toBe(Infinity);
    expect(parseInt("-1" + "0".repeat(1024), 2)).toBe(-Infinity);
    expect(eval("0x" + "0".repeat(300) + "1fffffffffffff" + "0".repeat(10))).toBe(2 ** 93 - 2 ** 40);
  });

  test("a sweep of 64-bit values agrees with Number(BigInt) in every power-of-two radix", () => {
    let state = 12345;
    const random32 = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    const mismatches: string[] = [];
    const literals: string[] = [];
    const wanted: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const value = (BigInt((random32() | 0x80000000) >>> 0) << 32n) | BigInt(random32());
      const want = Number(value);
      for (const radix of [2, 4, 8, 16, 32]) {
        const digits = value.toString(radix);
        if (parseInt(digits, radix) !== want) mismatches.push(`parseInt("${digits}", ${radix})`);
        if (radix in prefix && Number(prefix[radix] + digits) !== want)
          mismatches.push(`Number("${prefix[radix]}${digits}")`);
      }
      if (i % 10 === 0) {
        literals.push(prefix[[2, 8, 16][i % 3]] + value.toString([2, 8, 16][i % 3]));
        wanted.push(want);
      }
    }
    const source = "[" + literals.join(", ") + "]";
    const lexedByJSC: number[] = (0, eval)(source);
    const lexedByBun = transpiledValue(source) as number[];
    for (let i = 0; i < wanted.length; i++) {
      if (lexedByJSC[i] !== wanted[i]) mismatches.push(`eval("${literals[i]}")`);
      if (lexedByBun[i] !== wanted[i]) mismatches.push(`transpiled ${literals[i]}`);
    }
    expect(mismatches).toEqual([]);
  });
});
