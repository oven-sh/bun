// Drives the runtime-dispatched byte-search kernels in
// src/jsc/bindings/highway_strings.cpp (the backend of `bun_core::strings`)
// directly, sweeping haystack lengths across vector-width boundaries and
// misaligned base pointers, and checks each against a scalar reference.

import { highwayStringsForTesting as hw } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";

// Lengths that straddle 16/32/64-byte lanes and the scalar tails on either side.
const LENGTHS = [0, 1, 2, 3, 8, 15, 16, 17, 31, 32, 33, 48, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1024, 1029];
// Misalign the base pointer so the unaligned-load and prefix/suffix paths run.
const OFFSETS = [0, 1, 13];

// Deterministic filler that never contains the bytes we plant (all >= 0x80).
function filler(len: number, offset: number): Uint8Array {
  const backing = new Uint8Array(len + offset + 16);
  let x = 0x9e3779b9 ^ len ^ (offset << 8);
  for (let i = 0; i < backing.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    backing[i] = 0x80 | (x >>> 24);
  }
  return backing.subarray(offset, offset + len);
}

const enc = (s: string) => new TextEncoder().encode(s);

function refIndexOf(h: Uint8Array, b: number) {
  const i = h.indexOf(b);
  return i === -1 ? h.length : i;
}
function refLastIndexOf(h: Uint8Array, b: number) {
  const i = h.lastIndexOf(b);
  return i === -1 ? h.length : i;
}
function refIndexOfNot(h: Uint8Array, b: number) {
  for (let i = 0; i < h.length; i++) if (h[i] !== b) return i;
  return h.length;
}
function refCount(h: Uint8Array, b: number) {
  let n = 0;
  for (let i = 0; i < h.length; i++) if (h[i] === b) n++;
  return n;
}
function refIndexOfAny(h: Uint8Array, set: Uint8Array) {
  for (let i = 0; i < h.length; i++) if (set.includes(h[i])) return i;
  return h.length;
}
function refLastIndexOfAny(h: Uint8Array, set: Uint8Array) {
  for (let i = h.length - 1; i >= 0; i--) if (set.includes(h[i])) return i;
  return h.length;
}
// Naive references (Buffer.indexOf/lastIndexOf are themselves served by these
// kernels, so they can't be the oracle).
function matchesAt(h: Uint8Array, n: Uint8Array, i: number) {
  for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) return false;
  return true;
}
function refMemmem(h: Uint8Array, n: Uint8Array) {
  if (n.length === 0) return 0;
  for (let i = 0; i + n.length <= h.length; i++) if (matchesAt(h, n, i)) return i;
  return -1;
}
function refMemrmem(h: Uint8Array, n: Uint8Array) {
  if (n.length === 0) return h.length;
  for (let i = h.length - n.length; i >= 0; i--) if (matchesAt(h, n, i)) return i;
  return -1;
}

// Positions worth planting a needle at for a haystack of length `len`: both
// ends, each side of every 16-byte lane boundary, and the middle.
function positions(len: number): number[] {
  const set = new Set<number>();
  for (const p of [0, 1, len >> 1, len - 2, len - 1]) if (p >= 0 && p < len) set.add(p);
  for (let lane = 16; lane < len + 16; lane += 16) {
    for (const p of [lane - 1, lane, lane + 1]) if (p >= 0 && p < len) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

describe("highway byte-search kernels", () => {
  it("indexOfChar / lastIndexOfChar / countChar: absent needle", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        const h = filler(len, off);
        const at = `len=${len} off=${off}`;
        expect(hw("indexOfChar", h, 0x2c), at).toBe(len);
        expect(hw("lastIndexOfChar", h, 0x2c), at).toBe(len);
        expect(hw("countChar", h, 0x2c), at).toBe(0);
      }
    }
  });

  it("indexOfChar / lastIndexOfChar: single planted needle at every interesting position", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        for (const pos of positions(len)) {
          const h = filler(len, off);
          h[pos] = 0x2c;
          const at = `len=${len} off=${off} pos=${pos}`;
          expect(hw("indexOfChar", h, 0x2c), at).toBe(pos);
          expect(hw("lastIndexOfChar", h, 0x2c), at).toBe(pos);
          expect(hw("countChar", h, 0x2c), at).toBe(1);
        }
      }
    }
  });

  it("indexOfChar / lastIndexOfChar / countChar: two needles pick first / last", () => {
    for (const len of LENGTHS) {
      const ps = positions(len);
      for (let i = 0; i < ps.length; i++) {
        const h = filler(len, 1);
        h[ps[i]] = 0x0a;
        h[ps[ps.length - 1 - i]] = 0x0a;
        const at = `len=${len} pos=${ps[i]},${ps[ps.length - 1 - i]}`;
        expect(hw("indexOfChar", h, 0x0a), at).toBe(refIndexOf(h, 0x0a));
        expect(hw("lastIndexOfChar", h, 0x0a), at).toBe(refLastIndexOf(h, 0x0a));
        expect(hw("countChar", h, 0x0a), at).toBe(refCount(h, 0x0a));
      }
    }
  });

  it("countChar: dense input", () => {
    for (const len of LENGTHS) {
      const h = new Uint8Array(len).fill(0x61);
      const at = `len=${len}`;
      expect(hw("countChar", h, 0x61), at).toBe(len);
      for (let i = 0; i < len; i += 3) h[i] = 0x62;
      expect(hw("countChar", h, 0x61), at).toBe(refCount(h, 0x61));
      expect(hw("countChar", h, 0x62), at).toBe(refCount(h, 0x62));
    }
  });

  it("indexOfNotChar: leading run lengths across lane boundaries", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        const all = new Uint8Array(len + off).subarray(off).fill(0x2f);
        expect(hw("indexOfNotChar", all, 0x2f), `len=${len} off=${off}`).toBe(len);
        for (const run of positions(len)) {
          const h = new Uint8Array(len + off).subarray(off).fill(0x2f);
          h[run] = 0x61;
          expect(hw("indexOfNotChar", h, 0x2f), `len=${len} off=${off} run=${run}`).toBe(refIndexOfNot(h, 0x2f));
        }
      }
    }
  });

  it("indexOfAny / lastIndexOfAny: 2, 3 and 16-byte sets", () => {
    const sets = [enc("\r\n"), enc("/\\:"), enc("0123456789abcdef")];
    for (const set of sets) {
      for (const len of LENGTHS) {
        for (const off of [0, 13]) {
          const none = filler(len, off);
          const at0 = `set=${set.length} len=${len} off=${off}`;
          expect(hw("indexOfAny", none, set), at0).toBe(len);
          expect(hw("lastIndexOfAny", none, set), at0).toBe(len);
          for (const pos of positions(len)) {
            const h = filler(len, off);
            // Alternate which member of the set is planted so every lane compare matters.
            h[pos] = set[pos % set.length];
            const at = `${at0} pos=${pos}`;
            expect(hw("indexOfAny", h, set), at).toBe(pos);
            expect(hw("lastIndexOfAny", h, set), at).toBe(pos);
            if (pos + 2 < len) {
              h[pos + 2] = set[(pos + 1) % set.length];
              expect(hw("indexOfAny", h, set), at).toBe(refIndexOfAny(h, set));
              expect(hw("lastIndexOfAny", h, set), at).toBe(refLastIndexOfAny(h, set));
            }
          }
        }
      }
    }
  });

  it("memmem / memrmem: needle lengths 0..5 and 17, planted across boundaries", () => {
    const needles = ["", "a", "ab", "abc", "abcab", "needle-longer-17b"].map(enc);
    for (const n of needles) {
      for (const len of LENGTHS) {
        const none = filler(len, 3);
        const at0 = `needle=${n.length} len=${len}`;
        expect(hw("memmem", none, n), at0).toBe(refMemmem(none, n));
        expect(hw("memrmem", none, n), at0).toBe(refMemrmem(none, n));
        if (n.length === 0 || n.length > len) continue;
        for (const pos of positions(len - n.length + 1)) {
          const h = filler(len, 3);
          h.set(n, pos);
          const at = `${at0} pos=${pos}`;
          expect(hw("memmem", h, n), at).toBe(pos);
          expect(hw("memrmem", h, n), at).toBe(pos);
          // A second copy later on: memmem keeps the first, memrmem takes the last.
          const later = len - n.length;
          if (later >= pos + n.length) {
            h.set(n, later);
            expect(hw("memmem", h, n), at).toBe(refMemmem(h, n));
            expect(hw("memrmem", h, n), at).toBe(refMemrmem(h, n));
          }
        }
      }
    }
  });

  it("memmem / memrmem: partial-prefix decoys do not match", () => {
    const n = enc("abcd");
    for (const len of [8, 16, 17, 33, 64, 130]) {
      const h = filler(len, 0);
      // "abc" decoys everywhere, one real "abcd".
      for (let i = 0; i + 3 <= len; i += 5) h.set(enc("abc"), i);
      expect(hw("memmem", h, n)).toBe(refMemmem(h, n));
      expect(hw("memrmem", h, n)).toBe(refMemrmem(h, n));
      if (len >= 24) {
        h.set(n, 19);
        expect(hw("memmem", h, n)).toBe(refMemmem(h, n));
        expect(hw("memrmem", h, n)).toBe(refMemrmem(h, n));
      }
    }
  });

  it("Buffer.indexOf / lastIndexOf / includes(byte) through the public API", () => {
    // These go through JSBuffer.cpp's indexOfNumber (offset/end plumbing) into
    // the same kernels; assert against the planted positions, not a Buffer
    // method (which would be the code under test).
    for (const len of LENGTHS) {
      for (const pos of positions(len)) {
        const buf = Buffer.from(filler(len, 0));
        const last = pos + 16 < len ? pos + 16 : pos;
        buf[pos] = 0x21;
        buf[last] = 0x21;
        const at = `len=${len} pos=${pos} last=${last}`;
        expect(buf.indexOf(0x21), at).toBe(pos);
        expect(buf.lastIndexOf(0x21), at).toBe(last);
        expect(buf.includes(0x21), at).toBe(true);
        expect(buf.includes(0x22), at).toBe(false);
        expect(buf.lastIndexOf(Buffer.from("!"), last), at).toBe(last);
        if (last !== pos) {
          // byteOffset plumbing: start just past the first hit / just before the last one.
          expect(buf.indexOf(0x21, pos + 1), at).toBe(last);
          expect(buf.lastIndexOf(0x21, last - 1), at).toBe(pos);
        }
      }
    }
    expect(Buffer.alloc(0).indexOf(1)).toBe(-1);
    expect(Buffer.alloc(0).lastIndexOf(1)).toBe(-1);
  });
});
