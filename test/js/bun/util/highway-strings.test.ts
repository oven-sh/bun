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

// Deterministic filler that never contains the values we plant (top bit set).
function filler(len: number, offset: number): Uint8Array;
function filler<T extends Uint8Array | Uint16Array>(len: number, offset: number, ctor: { new (n: number): T }): T;
function filler(len: number, offset: number, ctor: Uint8ArrayConstructor | Uint16ArrayConstructor = Uint8Array) {
  const backing = new ctor(len + offset + 16);
  const bits = backing.BYTES_PER_ELEMENT * 8;
  let x = 0x9e3779b9 ^ len ^ (offset << 8);
  for (let i = 0; i < backing.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    backing[i] = (1 << (bits - 1)) | (x >>> (33 - bits));
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
type Units = ArrayLike<number>;
function matchesAt(h: Units, n: Units, i: number) {
  for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) return false;
  return true;
}
function refMemmem(h: Units, n: Units) {
  if (n.length === 0) return 0;
  for (let i = 0; i + n.length <= h.length; i++) if (matchesAt(h, n, i)) return i;
  return -1;
}
function refMemrmem(h: Units, n: Units) {
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

  // UTF-16 code-unit search (utf16le Buffer.indexOf / lastIndexOf). Lengths,
  // positions and results are in code units. `byteOff` = 1 hands the kernel an
  // odd base pointer, as Buffer.from(ab, 1).indexOf(s, "utf16le") does.
  function view16(h: Uint16Array, byteOff: number): Uint8Array {
    const out = new Uint8Array(h.byteLength + byteOff);
    out.set(new Uint8Array(h.buffer, h.byteOffset, h.byteLength), byteOff);
    return out.subarray(byteOff);
  }
  const u16 = (units: number[]) => view16(new Uint16Array(units), 0);

  it("memmem16 / memrmem16: needle lengths 1, 2, 5 and 17 code units, planted across boundaries", () => {
    const needles = [[0x3131], [0x3131, 0x0132], [7, 7, 7, 7, 8], Array.from({ length: 17 }, (_, i) => 0x100 + i)];
    for (const n of needles) {
      const nb = u16(n);
      // 1024 dropped: 1029 covers the long case and this sweep is the slowest in the file.
      for (const len of LENGTHS.filter(l => l !== 1024)) {
        for (const [off, byteOff] of [
          [0, 0],
          [3, 1],
        ]) {
          const none = filler(len, off, Uint16Array);
          const at0 = `needle=${n.length} len=${len} off=${off} byteOff=${byteOff}`;
          expect(hw("memmem16", view16(none, byteOff), nb), at0).toBe(-1);
          expect(hw("memrmem16", view16(none, byteOff), nb), at0).toBe(-1);
          if (n.length > len) continue;
          const starts = len - n.length + 1;
          // Long haystacks: both ends, the middle, and a few lane edges are enough.
          const planted = positions(starts).filter(
            (p, i, all) => starts <= 300 || i < 4 || i >= all.length - 4 || Math.abs(p - (starts >> 1)) <= 17,
          );
          for (const pos of planted) {
            const h = filler(len, off, Uint16Array);
            h.set(n, pos);
            const at = `${at0} pos=${pos}`;
            expect(hw("memmem16", view16(h, byteOff), nb), at).toBe(pos);
            expect(hw("memrmem16", view16(h, byteOff), nb), at).toBe(pos);
            const later = len - n.length;
            if (later >= pos + n.length) {
              h.set(n, later);
              expect(hw("memmem16", view16(h, byteOff), nb), at).toBe(pos);
              expect(hw("memrmem16", view16(h, byteOff), nb), at).toBe(later);
            }
          }
        }
      }
    }
  });

  it("memmem16 / memrmem16: anchor-passing decoys are rejected by full-unit verification", () => {
    // Short needle (first == last unit) over a haystack of that unit: every start
    // passes the two-anchor filter and fails verify, which also spends the
    // false-positive budget and finishes in the two-way fallback. Long needle
    // (> 16 units, anchors ranked by low byte): decoys keep every low byte and
    // both anchor units and flip one high byte in the middle.
    const short = [0x0141, 0x0142, 0x0143, 0x0141];
    const long = Array.from({ length: 20 }, (_, i) => 0x0161 + i);
    const longDecoy = long.map((u, i) => (i === 9 ? u ^ 0x0300 : u));
    const cases: [number[], (len: number) => Uint16Array][] = [
      [short, len => new Uint16Array(len).fill(short[0])],
      [
        long,
        len => {
          const h = filler(len, 0, Uint16Array);
          for (let i = 0; i + longDecoy.length <= len; i += longDecoy.length) h.set(longDecoy, i);
          return h;
        },
      ],
    ];
    for (const [n, make] of cases) {
      const nb = u16(n);
      for (const len of [n.length, 33, 65, 130, 1030]) {
        const h = make(len);
        const at = `needle=${n.length} len=${len}`;
        expect(hw("memmem16", view16(h, 0), nb), at).toBe(-1);
        expect(hw("memrmem16", view16(h, 0), nb), at).toBe(-1);
        if (len >= 3 * n.length) {
          // Real copies near both ends, decoys between: first/last must be exact.
          h.set(n, 1);
          h.set(n, len - n.length - 1);
          expect(hw("memmem16", view16(h, 0), nb), at).toBe(1);
          expect(hw("memrmem16", view16(h, 0), nb), at).toBe(len - n.length - 1);
          expect(refMemmem(h, n), at).toBe(1);
          expect(refMemrmem(h, n), at).toBe(len - n.length - 1);
        }
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
