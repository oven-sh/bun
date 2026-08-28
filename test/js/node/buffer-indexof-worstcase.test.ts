import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";

// Naive reference implementations for correctness cross-checks.
const refIndexOf = (hay: Uint8Array, ndl: Uint8Array, from = 0) => {
  if (ndl.length === 0) return Math.min(Math.max(from, 0), hay.length);
  outer: for (let i = Math.max(from, 0); i + ndl.length <= hay.length; i++) {
    for (let j = 0; j < ndl.length; j++) if (hay[i + j] !== ndl[j]) continue outer;
    return i;
  }
  return -1;
};
const refLastIndexOf = (hay: Uint8Array, ndl: Uint8Array, from = hay.length) => {
  if (ndl.length === 0) return Math.min(Math.max(from, 0), hay.length);
  const start = Math.min(from, hay.length - ndl.length);
  outer: for (let i = start; i >= 0; i--) {
    for (let j = 0; j < ndl.length; j++) if (hay[i + j] !== ndl[j]) continue outer;
    return i;
  }
  return -1;
};

describe("Buffer#indexOf / lastIndexOf adversarial worst case", () => {
  // The search should not degrade to O(haystack * needle) on inputs where the
  // needle's anchor bytes are the haystack's dominant byte. Node stays flat on
  // these; with a naive first-byte-only filter (or std::find_end) a 16x longer
  // needle costs ~16x more.

  // Debug/ASAN is ~50x slower at byte-by-byte loops; keep the haystack small
  // enough to finish quickly there while still making a naive search blow the
  // budget.
  const HAY = isASAN || isDebug ? 512 * 1024 : 4 * 1024 * 1024;
  const haystack = Buffer.alloc(HAY, 0x61);
  const budgetMs = isASAN || isDebug ? 3000 : 400;

  const fw = (m: number) => {
    const n = Buffer.alloc(m, 0x61);
    n[m - 1] = 0x62;
    return n; // 'a'*(m-1)+'b' — not present
  };
  const bw = (m: number) => {
    const n = Buffer.alloc(m, 0x61);
    n[0] = 0x62;
    return n; // 'b'+'a'*(m-1) — not present
  };
  const mid = (m: number) => {
    const n = Buffer.alloc(m, 0x61);
    n[m >> 1] = 0x62;
    return n; // 'a'*(m/2)+'b'+'a'*(m/2) — defeats a first+last-byte-only filter
  };

  for (const [name, shape] of [
    ["tail-mismatch", fw],
    ["head-mismatch", bw],
    ["mid-mismatch", mid],
  ] as const) {
    test(`indexOf stays sublinear in needle length (${name})`, () => {
      for (const m of [64, 256, 1024, 4096, 16384]) {
        const needle = shape(m);
        const t0 = performance.now();
        const r = haystack.indexOf(needle);
        const dt = performance.now() - t0;
        expect(r).toBe(-1);
        if (dt > budgetMs) {
          throw new Error(`indexOf ${name} m=${m}: ${dt.toFixed(0)}ms (> ${budgetMs}ms)`);
        }
      }
    });

    test(`lastIndexOf stays sublinear in needle length (${name})`, () => {
      for (const m of [64, 256, 1024, 4096, 16384]) {
        const needle = shape(m);
        const t0 = performance.now();
        const r = haystack.lastIndexOf(needle);
        const dt = performance.now() - t0;
        expect(r).toBe(-1);
        if (dt > budgetMs) {
          throw new Error(`lastIndexOf ${name} m=${m}: ${dt.toFixed(0)}ms (> ${budgetMs}ms)`);
        }
      }
    });
  }

  test("indexOf / lastIndexOf growth ratio is bounded", () => {
    const best = (f: () => void) => {
      let b = Infinity;
      for (let i = 0; i < 3; i++) {
        const s = performance.now();
        f();
        b = Math.min(b, performance.now() - s);
      }
      return b;
    };
    // On a linear algorithm the 16x longer needle should not cost >4x more.
    const i250 = best(() => haystack.indexOf(fw(250)));
    const i4000 = best(() => haystack.indexOf(fw(4000)));
    const l250 = best(() => haystack.lastIndexOf(bw(250)));
    const l4000 = best(() => haystack.lastIndexOf(bw(4000)));
    expect(i4000 / Math.max(i250, 0.1)).toBeLessThan(4);
    expect(l4000 / Math.max(l250, 0.1)).toBeLessThan(4);
  });

  test("includes on adversarial needle", () => {
    const needle = mid(8192);
    const t0 = performance.now();
    expect(haystack.includes(needle)).toBe(false);
    const dt = performance.now() - t0;
    if (dt > budgetMs) throw new Error(`includes m=8192: ${dt.toFixed(0)}ms (> ${budgetMs}ms)`);
  });

  test("uniform-byte needle forces the Two-Way fallback", () => {
    // Needle is one repeated byte so both SIMD anchors are that byte; haystack
    // repeats (m-1 of it + one other) so the filter fires almost everywhere and
    // every memcmp fails, tripping the budget into the Two-Way search. With
    // m >> 250 this stays linear where Node's capped Boyer-Moore does not.
    for (const m of [257, 4096]) {
      const unit = Buffer.alloc(m, 0x61);
      unit[m - 1] = 0x62;
      const hay = Buffer.alloc(unit.length * (isASAN || isDebug ? 128 : 1024), 0x61);
      for (let i = 0; i < hay.length; i += unit.length) unit.copy(hay, i);
      const needle = Buffer.alloc(m, 0x61);

      for (const fn of ["indexOf", "lastIndexOf"] as const) {
        const t0 = performance.now();
        const r = hay[fn](needle);
        const dt = performance.now() - t0;
        expect(r).toBe(-1);
        if (dt > budgetMs) throw new Error(`${fn} fallback m=${m}: ${dt.toFixed(0)}ms (> ${budgetMs}ms)`);
      }
    }
  });

  test("SIMD anchors defeated, Two-Way periodic branch", () => {
    // haystack 'abab…' with one 'c' every `m` bytes, needle 'abab…' of length
    // m: anchors are 'a'/'b' (flat histogram) and fire at every aligned
    // position, memcmp fails near the 'c', budget trips into Two-Way's
    // periodic case.
    const m = 2048;
    const hay = Buffer.alloc(m * (isASAN || isDebug ? 128 : 1024));
    for (let i = 0; i < hay.length; i++) hay[i] = 0x61 + (i & 1);
    for (let i = m - 2; i < hay.length; i += m) hay[i] = 0x63;
    const needle = Buffer.alloc(m);
    for (let i = 0; i < m; i++) needle[i] = 0x61 + (i & 1);

    for (const fn of ["indexOf", "lastIndexOf"] as const) {
      const t0 = performance.now();
      const r = hay[fn](needle);
      const dt = performance.now() - t0;
      expect(r).toBe(-1);
      if (dt > budgetMs) throw new Error(`${fn} periodic m=${m}: ${dt.toFixed(0)}ms (> ${budgetMs}ms)`);
    }
  });
});

describe("Buffer#indexOf / lastIndexOf correctness", () => {
  test("randomized cross-check vs naive", () => {
    let seed = 0x1234_5678;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed;
    };
    const randByte = (alphabet: number) => 0x61 + (rand() % alphabet);

    for (let trial = 0; trial < 1500; trial++) {
      const alphabet = 1 + (rand() % 4); // 1..4 distinct bytes → lots of partial matches
      const hayLen = rand() % 200;
      const ndlLen = rand() % 24;
      const hay = Buffer.alloc(hayLen);
      for (let i = 0; i < hayLen; i++) hay[i] = randByte(alphabet);
      let ndl: Buffer;
      if (ndlLen > 0 && hayLen >= ndlLen && rand() % 3 === 0) {
        // Guaranteed-present needle: copy a slice of the haystack.
        const start = rand() % (hayLen - ndlLen + 1);
        ndl = Buffer.from(hay.subarray(start, start + ndlLen));
      } else {
        ndl = Buffer.alloc(ndlLen);
        for (let i = 0; i < ndlLen; i++) ndl[i] = randByte(alphabet);
      }
      const from = (rand() % (hayLen + 4)) - 2;

      const io = hay.indexOf(ndl, from);
      const lo = hay.lastIndexOf(ndl, from);
      const refI = refIndexOf(hay, ndl, from < 0 ? Math.max(hayLen + from, 0) : from);
      const refL = refLastIndexOf(hay, ndl, from < 0 ? hayLen + from : from);
      if (io !== refI || lo !== refL) {
        throw new Error(
          `trial=${trial} hay=${hay.toString("hex")} ndl=${ndl.toString("hex")} from=${from} ` +
            `indexOf=${io} ref=${refI} lastIndexOf=${lo} ref=${refL}`,
        );
      }
    }
  });

  test("match at every boundary", () => {
    // Exercise the SIMD-loop / scalar-remainder handoff for every match offset
    // across a few needle lengths.
    for (const m of [2, 3, 7, 8, 9, 31, 32, 33, 63, 64, 65]) {
      const needle = Buffer.alloc(m, 0x62);
      for (let pos = 0; pos <= 80; pos++) {
        const hay = Buffer.alloc(pos + m + 80, 0x61);
        needle.copy(hay, pos);
        expect(hay.indexOf(needle)).toBe(pos);
        expect(hay.lastIndexOf(needle)).toBe(pos);
        expect(hay.includes(needle)).toBe(true);
      }
    }
  });

  test("utf16le indexOf / lastIndexOf still correct", () => {
    const hay = Buffer.from(
      Buffer.alloc(1000, "a").toString() + "needle" + Buffer.alloc(1000, "a").toString(),
      "utf16le",
    );
    const miss = Buffer.alloc(20, "x").toString();
    // indexOfBuffer → indexOf16 / lastIndexOf16
    const ndl = Buffer.from("needle", "utf16le");
    expect(hay.indexOf(ndl, 0, "utf16le")).toBe(1000 * 2);
    expect(hay.lastIndexOf(ndl, hay.length, "utf16le")).toBe(1000 * 2);
    expect(hay.indexOf(Buffer.from(miss, "utf16le"), 0, "utf16le")).toBe(-1);
    expect(hay.lastIndexOf(Buffer.from(miss, "utf16le"), hay.length, "utf16le")).toBe(-1);
    // indexOfString → indexOf16 / lastIndexOf16
    expect(hay.indexOf("needle", 0, "utf16le")).toBe(1000 * 2);
    expect(hay.lastIndexOf("needle", hay.length, "utf16le")).toBe(1000 * 2);
    expect(hay.indexOf(miss, 0, "utf16le")).toBe(-1);
    expect(hay.lastIndexOf(miss, hay.length, "utf16le")).toBe(-1);
  });

  test("adversarial needle that is present", () => {
    const m = 500;
    const hay = Buffer.alloc(64 * 1024, 0x61);
    const needle = Buffer.alloc(m, 0x61);
    needle[m >> 1] = 0x62;
    const at = 40000;
    hay[at + (m >> 1)] = 0x62;
    expect(hay.indexOf(needle)).toBe(at);
    expect(hay.lastIndexOf(needle)).toBe(at);
  });
});
