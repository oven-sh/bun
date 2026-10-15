// The forward substring search with caller-chosen filter offsets
// (highway_memmem_anchored in src/jsc/bindings/highway_strings.cpp, behind
// `bun_core::strings::index_of_anchored`). The offsets only decide which two
// bytes of the needle the SIMD filter compares first, so every pair must give
// the result of the plain search. The plain kernels are covered in
// highway-strings.test.ts.

import { highwayStringsForTesting as hw } from "bun:internal-for-testing";
import { expect, it } from "bun:test";

const enc = (s: string) => new TextEncoder().encode(s);

// Deterministic filler with the top bit set, so it never holds a needle byte.
function filler(len: number, offset: number) {
  const backing = new Uint8Array(len + offset + 16);
  let x = 0x9e3779b9 ^ len ^ (offset << 8);
  for (let i = 0; i < backing.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    backing[i] = 0x80 | (x >>> 25);
  }
  return backing.subarray(offset, offset + len);
}

// Buffer.indexOf runs the same kernels, so the reference is a plain loop.
function refMemmem(h: Uint8Array, n: Uint8Array) {
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

it("every pair of filter offsets finds what the plain search finds", () => {
  const needles = [
    "a",
    "ab",
    "abcab",
    "\r\n--boundary",
    "needle-longer-17b",
    "\r\n------WebKitFormBoundary7MA4YWxk",
  ].map(enc);
  for (const n of needles) {
    const haystacks: Uint8Array[] = [];
    // Lengths on both sides of the 16, 32 and 64-byte lanes, and shorter than the needle.
    for (const len of [n.length - 1, n.length, 17, 33, 64, 130, 1029]) {
      haystacks.push(filler(len, 3));
      if (len < n.length) continue;
      for (const pos of [0, (len - n.length) >> 1, len - n.length]) {
        const h = filler(len, 3);
        h.set(n, pos);
        haystacks.push(h);
        // A copy with its last byte changed, in front of the match. It passes
        // the filter for every pair that does not compare that byte.
        if (pos >= n.length && n.length > 1) {
          const decoy = h.slice();
          decoy.set(n, 0);
          decoy[n.length - 1] ^= 1;
          haystacks.push(decoy);
        }
      }
    }
    const wrong: string[] = [];
    for (const h of haystacks) {
      const expected = refMemmem(h, n);
      for (let first = 0; first < n.length; first++) {
        for (let second = 0; second < n.length; second++) {
          const got = hw("memmemAnchored", h, n, first, second);
          if (got !== expected)
            wrong.push(`needle=${n.length} len=${h.length} first=${first} second=${second}: ${got}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }
});

it("a haystack of near matches runs out of budget and still finds the match", () => {
  // Every position passes a filter on two of the leading bytes, so the search
  // falls back to its linear worst-case path before the match at the end.
  const n = enc("aaaaaaaaaaaaaaaab");
  const h = new Uint8Array(1024 + n.length).fill(0x61);
  h.set(n, 1024);
  for (const [first, second] of [
    [0, 1],
    [1, 0],
    [15, 0],
    [16, 0],
    [16, 16],
  ]) {
    expect(hw("memmemAnchored", h, n, first, second), `first=${first} second=${second}`).toBe(1024);
  }
  expect(hw("memmemAnchored", h.subarray(0, 1024), n, 0, 1)).toBe(-1);
});

it("an offset outside the needle throws", () => {
  expect(() => hw("memmemAnchored", enc("abc"), enc("bc"), 2, 0)).toThrow(RangeError);
  expect(() => hw("memmemAnchored", enc("abc"), enc("bc"), 0, 2)).toThrow(RangeError);
});
