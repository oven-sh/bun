// Drives the runtime-dispatched byte-search kernels in
// src/jsc/bindings/highway_strings.cpp (the backend of `bun_core::strings`)
// directly, sweeping haystack lengths across vector-width boundaries and
// misaligned base pointers.
//
// Every haystack is built so the answer is known by construction (filler that
// cannot contain the needle, with the needle planted at a chosen position), so
// no scalar reference is needed. A sweep records each wrong result as a string
// and one expect() per test asserts the list is empty: a matcher call is far
// more expensive than a kernel call (under the CI runner's
// BUN_GARBAGE_COLLECTOR_LEVEL=1 every matcher also triggers a GC), and a failure
// lists every bad (kernel, length, offset, position) instead of just the first.

import { highwayStringsForTesting as hw } from "bun:internal-for-testing";
import { afterEach, describe, expect, it } from "bun:test";

// Every op highway_strings_testing.cpp dispatches. The last test asserts the
// sweeps drove all of them, so a kernel silently dropping out of this file fails.
const KERNELS = [
  "countChar",
  "indexOfAny",
  "indexOfChar",
  "indexOfNotChar",
  "lastIndexOfAny",
  "lastIndexOfChar",
  "memmem",
  "memrmem",
] as const;
type Kernel = (typeof KERNELS)[number];
const driven: Partial<Record<Kernel, true>> = {};

// Lengths that straddle 16/32/64-byte lanes and the scalar tails on either side.
const LENGTHS = [0, 1, 2, 3, 8, 15, 16, 17, 31, 32, 33, 48, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1024, 1029];
// Misalign the base pointer so the unaligned-load and prefix/suffix paths run.
const OFFSETS = [0, 1, 13];
// Bytes outside the view on each side; a multiple of the widest vector so the
// view's alignment is still decided by the offset alone.
const PAD = 64;

const enc = (s: string) => new TextEncoder().encode(s);

// A `len`-byte view starting `off` bytes past an aligned point, filled with
// deterministic bytes >= 0x80 that never equal any needle byte planted by the
// tests (all < 0x80). The PAD bytes on both sides of the view repeat `outside`
// (the needle the test is about to search for; an empty needle leaves them
// zero), so a kernel that reads past either end of the view reports a hit the
// view does not contain.
function haystack(len: number, off: number, outside: ArrayLike<number>): Uint8Array {
  const backing = new Uint8Array(PAD + off + len + PAD);
  if (outside.length) for (let i = 0; i < backing.length; i++) backing[i] = outside[i % outside.length];
  const view = backing.subarray(PAD + off, PAD + off + len);
  let x = 0x9e3779b9 ^ len ^ (off << 8);
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    view[i] = 0x80 | (x >>> 24);
  }
  return view;
}

// Positions worth planting a needle at in a haystack of length `len`: both
// ends, the middle, and each side of every 16-byte boundary counted from the
// start (the forward kernels' lanes) and from the end (the reverse kernels
// step back from the end, so when `len` is not a multiple of the vector width
// their lane boundaries sit at len - k*N, not at k*N). Memoized: the sweeps ask
// for the same lengths repeatedly and the sort is slow on a debug build.
const positionsByLength = new Map<number, number[]>();
function positions(len: number): number[] {
  let ps = positionsByLength.get(len);
  if (ps) return ps;
  const set = new Set<number>();
  const add = (p: number) => {
    if (p >= 0 && p < len) set.add(p);
  };
  [0, 1, len >> 1, len - 2, len - 1].forEach(add);
  for (let lane = 16; lane < len + 16; lane += 16) {
    for (const d of [-1, 0, 1]) {
      add(lane + d);
      add(len - lane + d);
    }
  }
  ps = [...set].sort((a, b) => a - b);
  positionsByLength.set(len, ps);
  return ps;
}

// Wrong results recorded by the current test; asserted empty in afterEach, so
// every test in this file asserts whether or not it calls expect() itself.
let mismatches: string[] = [];

function record(what: string, got: number | boolean, want: number | boolean, at: string) {
  if (got !== want) mismatches.push(`${what} ${at}: got ${got}, want ${want}`);
}

function check(op: Kernel, h: Uint8Array, arg: number | Uint8Array, want: number, at: string) {
  driven[op] = true;
  record(op, hw(op, h, arg), want, at);
}

describe("highway byte-search kernels", () => {
  afterEach(() => {
    const found = mismatches;
    mismatches = [];
    expect(found.slice(0, 25), `mismatches: ${found.length}`).toEqual([]);
  });

  it("indexOfChar / lastIndexOfChar / countChar: absent needle", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        const h = haystack(len, off, [0x2c]);
        const at = `len=${len} off=${off}`;
        check("indexOfChar", h, 0x2c, len, at);
        check("lastIndexOfChar", h, 0x2c, len, at);
        check("countChar", h, 0x2c, 0, at);
      }
    }
  });

  it("indexOfChar / lastIndexOfChar / countChar: single needle planted at every interesting position", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        const h = haystack(len, off, [0x2c]);
        for (const pos of positions(len)) {
          const saved = h[pos];
          h[pos] = 0x2c;
          const at = `len=${len} off=${off} pos=${pos}`;
          check("indexOfChar", h, 0x2c, pos, at);
          check("lastIndexOfChar", h, 0x2c, pos, at);
          check("countChar", h, 0x2c, 1, at);
          h[pos] = saved;
        }
      }
    }
  });

  it("indexOfChar / lastIndexOfChar / countChar: two needles pick first / last", () => {
    for (const len of LENGTHS) {
      const h = haystack(len, 1, [0x0a]);
      const ps = positions(len);
      for (let i = 0; i < ps.length; i++) {
        // Mirror pairs: (first, last), (second, second to last), ... so the
        // two hits straddle every lane boundary in both orders.
        const p = ps[i];
        const q = ps[ps.length - 1 - i];
        const savedP = h[p];
        const savedQ = h[q];
        h[p] = 0x0a;
        h[q] = 0x0a;
        const at = `len=${len} pos=${p},${q}`;
        check("indexOfChar", h, 0x0a, Math.min(p, q), at);
        check("lastIndexOfChar", h, 0x0a, Math.max(p, q), at);
        check("countChar", h, 0x0a, p === q ? 1 : 2, at);
        h[p] = savedP;
        h[q] = savedQ;
      }
    }
  });

  it("countChar: dense input", () => {
    // CountCharImpl accumulates matches in per-lane u8 counters and flushes
    // them every 255 vectors; 256 vectors of the widest (64-byte) target plus a
    // scalar tail makes every target flush at least once mid-haystack.
    for (const len of [...LENGTHS, 256 * 64 + 7]) {
      const h = haystack(len, 0, [0x61, 0x62]).fill(0x61);
      const at = `len=${len}`;
      check("countChar", h, 0x61, len, at);
      for (let i = 0; i < len; i += 3) h[i] = 0x62;
      const planted = Math.ceil(len / 3);
      check("countChar", h, 0x62, planted, at);
      check("countChar", h, 0x61, len - planted, at);
    }
  });

  it("indexOfNotChar: leading run lengths across lane boundaries", () => {
    for (const len of LENGTHS) {
      for (const off of OFFSETS) {
        const h = haystack(len, off, [0x61]).fill(0x2f);
        check("indexOfNotChar", h, 0x2f, len, `len=${len} off=${off}`);
        for (const run of positions(len)) {
          h[run] = 0x61;
          check("indexOfNotChar", h, 0x2f, run, `len=${len} off=${off} run=${run}`);
          h[run] = 0x2f;
        }
      }
    }
  });

  it("indexOfAny / lastIndexOfAny: 2, 3 and 16-byte sets", () => {
    // 2-byte sets have their own kernel path; 16 is the largest set a single
    // call accepts (callers split bigger ones).
    const sets = [enc("\r\n"), enc("/\\:"), enc("0123456789abcdef")];
    for (const set of sets) {
      for (const len of LENGTHS) {
        for (const off of [0, 13]) {
          const h = haystack(len, off, set);
          const at0 = `set=${set.length} len=${len} off=${off}`;
          check("indexOfAny", h, set, len, at0);
          check("lastIndexOfAny", h, set, len, at0);
          for (const pos of positions(len)) {
            const at = `${at0} pos=${pos}`;
            const saved = h[pos];
            // Alternate which member of the set is planted so every lane compare matters.
            h[pos] = set[pos % set.length];
            check("indexOfAny", h, set, pos, at);
            check("lastIndexOfAny", h, set, pos, at);
            if (pos + 2 < len) {
              // A different member two bytes later: first stays, last moves.
              const at2 = `${at} second=${pos + 2}`;
              const saved2 = h[pos + 2];
              h[pos + 2] = set[(pos + 1) % set.length];
              check("indexOfAny", h, set, pos, at2);
              check("lastIndexOfAny", h, set, pos + 2, at2);
              h[pos + 2] = saved2;
            }
            h[pos] = saved;
          }
        }
      }
    }
  });

  it("memmem / memrmem: needle lengths 0..5 and 17, planted across boundaries", () => {
    // 1 byte delegates to the *IndexOfChar kernels, 2..16 anchor on the first
    // and last byte, 17 picks anchors from a byte histogram.
    const needles = ["", "a", "ab", "abc", "abcab", "needle-longer-17b"].map(enc);
    for (const n of needles) {
      for (const len of LENGTHS) {
        const at0 = `needle=${n.length} len=${len}`;
        // First copy only.
        const h = haystack(len, 3, n);
        check("memmem", h, n, n.length === 0 ? 0 : -1, at0);
        check("memrmem", h, n, n.length === 0 ? len : -1, at0);
        if (n.length === 0 || n.length > len) continue;
        // A second copy, fixed at the very end: memmem keeps the first,
        // memrmem takes the last.
        const later = len - n.length;
        const h2 = haystack(len, 3, n);
        h2.set(n, later);
        for (const pos of positions(len - n.length + 1)) {
          const at = `${at0} pos=${pos}`;
          const saved = h.slice(pos, pos + n.length);
          h.set(n, pos);
          check("memmem", h, n, pos, at);
          check("memrmem", h, n, pos, at);
          h.set(saved, pos);
          if (pos + n.length <= later) {
            const at2 = `${at} later=${later}`;
            h2.set(n, pos);
            check("memmem", h2, n, pos, at2);
            check("memrmem", h2, n, later, at2);
            h2.set(saved, pos);
          }
        }
      }
    }
  });

  it("memmem / memrmem: every start passes the two-anchor filter", () => {
    // The needle's first and last bytes are the fill byte, so both anchors
    // match at every start and only the memcmp rejects the decoys. Once more
    // than 2*len/needle + 32 candidates have been rejected the kernel hands the
    // rest of the haystack to the Two-Way fallback, so for the longer lengths
    // the copies planted late (memmem) / early (memrmem) are found by the
    // fallback and the others by the SIMD verify loop.
    const n = enc("aba");
    for (const len of LENGTHS) {
      if (len < n.length) continue;
      const h = haystack(len, 1, n).fill(0x61);
      const at0 = `len=${len}`;
      check("memmem", h, n, -1, at0);
      check("memrmem", h, n, -1, at0);
      for (const pos of positions(len - n.length + 1)) {
        h.set(n, pos);
        check("memmem", h, n, pos, `${at0} pos=${pos}`);
        check("memrmem", h, n, pos, `${at0} pos=${pos}`);
        h.fill(0x61, pos, pos + n.length);
      }
    }
  });

  it("memmem / memrmem: decoys do not match", () => {
    const n = enc("abcd");
    const decoys = [enc("abc"), enc("abxd")];
    for (const len of [8, 16, 17, 33, 64, 130, 1029]) {
      const h = haystack(len, 0, n);
      // Alternating decoys every 5 bytes: "abc" fails the anchor filter (no
      // 'd' where one is expected), "abxd" passes it and fails the memcmp.
      for (let i = 0; i + 4 <= len; i += 5) h.set(decoys[(i / 5) & 1], i);
      // The needle's first 3 bytes at the very end of the view, completed by a
      // 'd' in the padding right after it, must not count as a match.
      h.set(decoys[0], len - 3);
      new Uint8Array(h.buffer)[h.byteOffset + len] = 0x64;
      const at = `len=${len}`;
      check("memmem", h, n, -1, at);
      check("memrmem", h, n, -1, at);
      if (len >= 24) {
        h.set(n, 19);
        check("memmem", h, n, 19, at);
        check("memrmem", h, n, 19, at);
      }
    }
  });

  it("Buffer.indexOf / lastIndexOf / includes(byte) through the public API", () => {
    // These go through JSBuffer.cpp's indexOfNumber (byteOffset plumbing) into
    // the same kernels; the Buffer is a view over the haystack, so it also has
    // a non-zero byteOffset into its ArrayBuffer.
    const bang = Buffer.from("!");
    for (const len of LENGTHS) {
      const h = haystack(len, 0, bang);
      const buf = Buffer.from(h.buffer, h.byteOffset, h.length);
      for (const pos of positions(len)) {
        const last = pos + 16 < len ? pos + 16 : pos;
        const savedPos = buf[pos];
        const savedLast = buf[last];
        buf[pos] = 0x21;
        buf[last] = 0x21;
        const at = `len=${len} pos=${pos} last=${last}`;
        record("Buffer#indexOf", buf.indexOf(0x21), pos, at);
        record("Buffer#lastIndexOf", buf.lastIndexOf(0x21), last, at);
        record("Buffer#includes", buf.includes(0x21), true, at);
        record("Buffer#includes(absent)", buf.includes(0x22), false, at);
        record("Buffer#lastIndexOf(Buffer, last)", buf.lastIndexOf(bang, last), last, at);
        if (last !== pos) {
          // byteOffset plumbing: start just past the first hit / just before the last one.
          record("Buffer#indexOf(byte, pos + 1)", buf.indexOf(0x21, pos + 1), last, at);
          record("Buffer#lastIndexOf(byte, last - 1)", buf.lastIndexOf(0x21, last - 1), pos, at);
        }
        buf[pos] = savedPos;
        buf[last] = savedLast;
      }
    }
    expect(Buffer.alloc(0).indexOf(1)).toBe(-1);
    expect(Buffer.alloc(0).lastIndexOf(1)).toBe(-1);
  });

  it("the sweeps above drove every kernel the binding dispatches", () => {
    expect(Object.keys(driven).sort()).toEqual([...KERNELS]);
    expect(() => hw("notAKernel" as never, new Uint8Array(1), 0)).toThrow("unknown op");
  });
});
