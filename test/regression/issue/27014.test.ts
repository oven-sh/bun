import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/27014
// Bun.stripANSI() hangs on strings with control characters in 0x10-0x1F
// that are not actual ANSI escape introducers (e.g. 0x16 SYN, 0x19 EM).
test("stripANSI does not hang on non-escape control characters", () => {
  // This input contains 0x16, 0x19, 0x13, 0x14 which are in the 0x10-0x1F
  // range but are NOT ANSI escape introducers.
  const s = "\u0016zo\u00BAd\u0019\u00E8\u00E0\u0013?\u00C1+\u0014d\u00D3\u00E9";
  const result = Bun.stripANSI(s);
  expect(result).toBe(s);
});

test("stripANSI still strips real ANSI escape sequences", () => {
  // ESC [ 31m = red color, ESC [ 0m = reset
  const input = "\x1b[31mhello\x1b[0m";
  expect(Bun.stripANSI(input)).toBe("hello");
});

test("stripANSI handles mix of false-positive control chars and real escapes", () => {
  // 0x16 (SYN) should be preserved, but \x1b[31m should be stripped
  const input = "\x16before\x1b[31mcolored\x1b[0mafter\x19end";
  expect(Bun.stripANSI(input)).toBe("\x16beforecoloredafter\x19end");
});

test("stripANSI handles string of only non-escape control characters", () => {
  const input = "\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1c\x1d\x1e\x1f";
  expect(Bun.stripANSI(input)).toBe(input);
});

test("stripANSI finds real escape after false positives in same SIMD chunk", () => {
  // Place false-positive control chars followed by a real ESC within 16 bytes
  // so they land in the same SIMD chunk. The fix must scan past false positives
  // within a chunk to find the real escape character.
  const input = "\x10\x11\x12\x1b[31mred\x1b[0m";
  expect(Bun.stripANSI(input)).toBe("\x10\x11\x12red");
});

test("stripANSI handles many false positives followed by real escape in same chunk", () => {
  // Fill most of a 16-byte SIMD chunk with false positives, then a real escape
  // at the end of the chunk. This tests that the entire chunk is scanned.
  const input = "\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1c\x1d\x1b[1m!\x1b[0m";
  expect(Bun.stripANSI(input)).toBe("\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1c\x1d!");
});
