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
function filler(len: number, offset: number, ctor: { new (n: number): Uint8Array | Uint16Array } = Uint8Array) {
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

// The kernels of node:path (src/node_path/tidy.rs).
describe("kernels for paths", () => {
  const SLASH = 0x2f;
  const DOT = 0x2e;
  const slashOrDot = enc("/.");
  const isUntidyPartAt = (p: Uint8Array, at: number) =>
    p[at] === SLASH ||
    (p[at] === DOT &&
      (at + 1 === p.length ||
        p[at + 1] === SLASH ||
        (p[at + 1] === DOT && (at + 2 === p.length || p[at + 2] === SLASH))));
  function refIndexOfUntidySlash(p: Uint8Array) {
    for (let i = 0; i + 1 < p.length; i++) if (p[i] === SLASH && isUntidyPartAt(p, i + 1)) return i;
    return p.length;
  }
  function refCommonPrefixLength(a: Uint8Array, b: Uint8Array) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
  /** A copy that ends where its buffer ends, so that ASAN sees a read past it. */
  const exact = (p: Uint8Array) => new Uint8Array(p);
  // The runner of CI has a collection follow every expect(), and these tests compare over 100,000 times.
  // So a test lists what is wrong and has one expect().
  let wrong: string[] = [];
  function compare(kernel: string, found: number, expected: number, at: () => string) {
    if (found !== expected) wrong.push(`${kernel} ${at()}: ${found}, not ${expected}`);
  }
  function expectNothingWrong() {
    const found = wrong;
    wrong = [];
    expect(found.slice(0, 20)).toEqual([]);
  }
  function check(p: Uint8Array, at: () => string) {
    p = exact(p);
    compare("indexOfUntidySlash", hw("indexOfUntidySlash", p, 0), refIndexOfUntidySlash(p), at);
    compare("lastIndexOfSlash", hw("lastIndexOfSlash", p, 0), refLastIndexOf(p, SLASH), at);
    compare("lastIndexOfSlashOrDot", hw("lastIndexOfSlashOrDot", p, 0), refLastIndexOfAny(p, slashOrDot), at);
    compare("countSlashes", hw("countSlashes", p, 0), refCount(p, SLASH), at);
  }

  it("every text of up to 8 characters over '/', '.' and 'a'", () => {
    const alphabet = enc("/.a");
    for (let len = 0; len <= 8; len++) {
      const p = new Uint8Array(len);
      for (let k = 0; k < 3 ** len; k++) {
        for (let i = 0, rest = k; i < len; i++, rest = Math.floor(rest / 3)) p[i] = alphabet[rest % 3];
        check(p, () => new TextDecoder().decode(p));
      }
    }
    expectNothingWrong();
  });

  it("one untidy part at every position of a path of every length up to 100", () => {
    for (let len = 1; len <= 100; len++) {
      const tidy = new Uint8Array(len);
      for (let i = 0; i < len; i++) tidy[i] = i % 7 === 0 ? SLASH : i % 7 === 1 ? DOT : 0x61 + (i % 5);
      // "/.abcd" is a name that starts with a dot.
      if (len % 7 === 2) tidy[len - 1] = 0x61;
      if (len % 7 === 1) tidy[len - 1] = 0x61;
      check(tidy, () => `len=${len}`);
      compare("indexOfUntidySlash", hw("indexOfUntidySlash", exact(tidy), 0), len, () => `len=${len}`);
      for (const part of ["//", "/./", "/../", "/.", "/.."]) {
        const planted = enc(part);
        for (let pos = 0; pos + planted.length <= len; pos++) {
          // One that does not end with a slash is a whole part only at the end.
          if (!part.endsWith("/") && pos + planted.length !== len) continue;
          const p = tidy.slice();
          p.set(planted, pos);
          check(p, () => `len=${len} part=${part} pos=${pos}`);
        }
      }
    }
    expectNothingWrong();
  });

  it("bytes that differ from '/' and '.' in one bit are neither", () => {
    for (const len of [9, 17, 33, 34, 65, 70]) {
      for (let bit = 0; bit < 8; bit++) {
        for (let pos = 0; pos + 1 < len; pos++) {
          for (const [first, second] of [
            [SLASH ^ (1 << bit), SLASH],
            [SLASH, SLASH ^ (1 << bit)],
            [SLASH, DOT ^ (1 << bit)],
          ]) {
            const p = new Uint8Array(len).fill(0x61);
            p[pos] = first;
            p[pos + 1] = second;
            check(p, () => `len=${len} pos=${pos} bytes=${first},${second}`);
          }
        }
      }
    }
    expectNothingWrong();
  });

  it("commonPrefixLength: the first difference at every position, and none", () => {
    for (let len = 0; len <= 70; len++) {
      const a = filler(len, 1);
      const found = (b: Uint8Array) => hw("commonPrefixLength", exact(a), exact(b));
      compare("commonPrefixLength", found(a), len, () => `len=${len}`);
      compare("commonPrefixLength", found(a.subarray(0, len >> 1)), len >> 1, () => `len=${len} and its half`);
      for (let pos = 0; pos < len; pos++) {
        const b = a.slice();
        b[pos] ^= 1 << (pos & 7);
        if (pos + 3 < len) b[pos + 3] ^= 0x80;
        compare("commonPrefixLength", found(b), refCommonPrefixLength(a, b), () => `len=${len} pos=${pos}`);
      }
    }
    expectNothingWrong();
  });
});

describe("scannerRunStops", () => {
  const isNameByte = (b: number) =>
    (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x24;
  // One per bitmap, in the kernel's order.
  const STOPS = [
    (b: number) => !isNameByte(b),
    (b: number) => b !== 0x20 && b !== 0x09,
    (b: number) => b === 0x22 || b === 0x27 || b === 0x60 || b === 0x24 || b === 0x5c || b < 0x20 || b >= 0x80,
  ];

  function expectStops(text: Uint8Array, at: string) {
    const planeLen = Math.ceil(text.length / 64) * 8;
    const expected = new Uint8Array(planeLen * 3);
    STOPS.forEach((stops, plane) => {
      for (let i = 0; i < planeLen * 8; i++) {
        // The end of the text stops every run.
        if (i >= text.length || stops(text[i])) expected[plane * planeLen + (i >> 3)] |= 1 << (i & 7);
      }
    });
    const out = new Uint8Array(planeLen * 3);
    expect(hw("scannerRunStops", text, out), at).toBe(0);
    expect(out.toHex(), at).toBe(expected.toHex());
  }

  it("classifies every byte value in every lane", () => {
    for (let shift = 0; shift < 64; shift++) {
      expectStops(
        Uint8Array.from({ length: 256 + shift }, (_, i) => (i + 256 - shift) & 0xff),
        `shift=${shift}`,
      );
    }
  });

  it("sets the bits past the end of the text", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        for (const byte of [0x61, 0x20, 0x22, 0x00, 0xff]) {
          expectStops(new Uint8Array(len + off).fill(byte).subarray(off), `len=${len} off=${off} byte=${byte}`);
        }
      }
    }
  });

  it("finds one stop at every interesting position", () => {
    for (const len of LENGTHS) {
      for (const pos of positions(len)) {
        for (const [run, stop] of [
          [0x61, 0x2e],
          [0x24, 0xc3],
          [0x20, 0x61],
          [0x09, 0x0a],
          [0x2d, 0x27],
          [0x7f, 0x5c],
          [0x5f, 0x60],
        ]) {
          const text = new Uint8Array(len + 1).fill(run).subarray(1);
          text[pos] = stop;
          expectStops(text, `len=${len} pos=${pos} run=${run} stop=${stop}`);
        }
      }
    }
  });

  it("rejects a buffer that is too small", () => {
    expect(() => hw("scannerRunStops", new Uint8Array(65), new Uint8Array(3 * 8))).toThrow(RangeError);
  });
});

describe("lineStarts", () => {
  function expectLineStarts(text: Uint8Array, at: string) {
    const expected: number[] = [];
    text.forEach((byte, i) => byte === 0x0a && expected.push(i + 1));
    // One more than there are line feeds, to see that the kernel stops.
    const out = new Uint32Array(expected.length + 1).fill(0xdeadbeef);
    expect(hw("lineStarts", text, new Uint8Array(out.buffer)), at).toBe(expected.length);
    expect([...out], at).toEqual([...expected, 0xdeadbeef]);
  }

  it("no line feed, and nothing but line feeds", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        // The others differ from a line feed in one bit, or are what the last block is padded with.
        for (const byte of [0x0a, 0x61, 0x00, 0x0b, 0x08, 0x0d, 0x1a, 0x2a, 0x8a]) {
          expectLineStarts(new Uint8Array(len + off).fill(byte).subarray(off), `len=${len} off=${off} byte=${byte}`);
        }
      }
    }
  });

  it("one line feed at every interesting position", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        for (const pos of positions(len)) {
          const text = filler(len, off);
          text[pos] = 0x0a;
          expectLineStarts(text, `len=${len} off=${off} pos=${pos}`);
        }
      }
    }
  });

  it("lines of every length up to 130", () => {
    const lines = Array.from({ length: 131 }, (_, length) => Buffer.alloc(length, "a").toString() + "\n");
    expectLineStarts(enc(lines.join("")), "ascending");
    expectLineStarts(enc(lines.reverse().join("") + "no line feed at the end"), "descending");
  });

  it("rejects a buffer that is too small", () => {
    expect(() => hw("lineStarts", enc("a\nb\n"), new Uint8Array(4))).toThrow(RangeError);
  });
});

describe("oddBlocks", () => {
  const isPlain = (b: number) => (b >= 0x20 && b <= 0x7e && b !== 0x5c) || b === 0x09 || b === 0x0a || b === 0x0d;
  // Both sides of a block of 64 bytes and of a word of 64 blocks.
  const LENGTHS = [0, 1, 63, 64, 65, 127, 128, 129, 4031, 4032, 4033, 4095, 4096, 4097, 4159, 4160, 4161, 8192, 9000];

  function expectOddBlocks(text: Uint8Array, at: string) {
    const words = Math.ceil(text.length / 4096);
    const expected = new BigUint64Array(words + 1);
    text.forEach((byte, i) => {
      if (!isPlain(byte)) expected[i >> 12] |= 1n << BigInt((i >> 6) & 63);
    });
    // One word more than the kernel may write, to see that it stops.
    expected[words] = 0xaaaaaaaaaaaaaaaan;
    const out = new BigUint64Array(words + 1).fill(0xaaaaaaaaaaaaaaaan);
    expect(hw("oddBlocks", text, new Uint8Array(out.buffer)), at).toBe(0);
    expect([...out], at).toEqual([...expected]);
  }

  it("classifies every byte value", () => {
    for (let byte = 0; byte < 256; byte++) {
      for (const pos of [0, 63, 64, 100, 129]) {
        const text = new Uint8Array(130).fill(0x61);
        text[pos] = byte;
        expectOddBlocks(text, `byte=${byte} pos=${pos}`);
      }
    }
  });

  it("marks the block of an odd byte, and no other", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        expectOddBlocks(new Uint8Array(len + off).fill(0x20).subarray(off), `len=${len} off=${off} plain`);
        expectOddBlocks(new Uint8Array(len + off).fill(0x5c).subarray(off), `len=${len} off=${off} odd`);
        for (const pos of [0, 1, 62, 63, 64, 65, 4031, 4032, 4095, 4096, 4097, len - 65, len - 64, len - 2, len - 1]) {
          if (pos < 0 || pos >= len) continue;
          const text = new Uint8Array(len + off).fill(0x7e).subarray(off);
          text[pos] = 0x7f;
          expectOddBlocks(text, `len=${len} off=${off} pos=${pos}`);
        }
      }
    }
  });

  it("rejects a buffer that is too small", () => {
    expect(() => hw("oddBlocks", new Uint8Array(4097), new Uint8Array(8))).toThrow(RangeError);
  });
});
