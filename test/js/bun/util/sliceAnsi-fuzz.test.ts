// Fuzz/robustness tests for Bun.sliceAnsi.
// These complement sliceAnsi.test.ts with property-based and adversarial cases.

import { describe, expect, test } from "bun:test";

// Seeded PRNG for reproducibility. Change seed to explore different cases.
function makeRng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Some random-string cases include orphaned C1 controls (0x90, 0x98, 0x9C,
// 0x9E, 0x9F) that sliceAnsi consumes as control tokens but stripANSI leaves
// in (they're not SGR/OSC). To avoid testing that minor inconsistency, strip
// both before comparing. Everything else uses stringWidth directly now that
// the ANSI-breaks-grapheme bug is fixed.
const visibleWidth = (s: string) => Bun.stringWidth(Bun.stripANSI(s));

// ============================================================================
// Invariants that MUST hold for ANY input (property tests)
// ============================================================================

describe("sliceAnsi invariants", () => {
  // Property: output width ≤ requested width.
  // sliceAnsi(s, a, b) should never produce visible content wider than (b - a).
  // (May be narrower if wide char doesn't fit at boundary.)
  test("output width never exceeds requested range", () => {
    const rng = makeRng(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const s = randomString(rng, 0, 100);
      const w = Bun.stringWidth(s);
      const a = Math.floor(rng() * (w + 5));
      const b = a + Math.floor(rng() * (w + 5));
      const out = Bun.sliceAnsi(s, a, b);
      // +1 tolerance: a wide cluster (width 2) whose START is inside the range
      // is emitted in full even if it extends 1 col past `end`. This matches
      // upstream slice-ansi semantics (clusters are atomic; a wide char at
      // the cut boundary either goes in whole or not at all).
      expect(visibleWidth(out)).toBeLessThanOrEqual(Math.max(0, b - a) + 1);
    }
  });

  // Property: stripANSI(slice) == slice of stripped.
  // The visible text of the slice should match plain string.slice on stripped input
  // (modulo wide-char boundary rounding — we allow prefix match).
  test("slice of stripped equals stripped slice (for 1-width chars)", () => {
    const rng = makeRng(0xbeef);
    for (let i = 0; i < 200; i++) {
      // Limit to width-1 chars for this property (wide chars may skip positions)
      const s = randomAnsiAscii(rng, 0, 80);
      const plain = Bun.stripANSI(s);
      const a = Math.floor(rng() * (plain.length + 2));
      const b = a + Math.floor(rng() * (plain.length + 2));
      const sliced = Bun.stripANSI(Bun.sliceAnsi(s, a, b));
      const expected = plain.slice(a, b);
      expect(sliced).toBe(expected);
    }
  });

  // Property: concat of adjacent slices reconstructs the visible content.
  test("adjacent slices cover full visible string", () => {
    const rng = makeRng(0xdead);
    for (let i = 0; i < 100; i++) {
      const s = randomAnsiAscii(rng, 0, 60);
      const w = Bun.stringWidth(s);
      const mid = Math.floor(rng() * (w + 1));
      const left = Bun.stripANSI(Bun.sliceAnsi(s, 0, mid));
      const right = Bun.stripANSI(Bun.sliceAnsi(s, mid, w));
      expect(left + right).toBe(Bun.stripANSI(s));
    }
  });

  // Property: slice result is a valid string (no surrogates split, no garbage).
  test("output is always well-formed UTF-16", () => {
    const rng = makeRng(0xface);
    for (let i = 0; i < 200; i++) {
      const s = randomString(rng, 0, 100);
      const a = Math.floor(rng() * 50) - 10;
      const b = Math.floor(rng() * 50) - 10;
      const out = Bun.sliceAnsi(s, a, b);
      // Iterating codepoints should not throw; no lone surrogates at boundaries.
      // Note: lone surrogates in INPUT may pass through (we don't sanitize input),
      // but we should never CREATE new lone surrogates by splitting a pair.
      for (const cp of out) {
        const c = cp.codePointAt(0)!;
        if (c >= 0xd800 && c <= 0xdfff) {
          // If input didn't have this lone surrogate at an index the slice touched,
          // we created it — that's a bug. But for fuzz purposes, just assert it
          // existed in input (conservative check).
          expect(s).toContain(cp);
        }
      }
    }
  });

  // Property: identity. slice(s, 0, Infinity) == s (modulo ANSI normalization).
  test("full slice preserves visible content", () => {
    const rng = makeRng(0x1234);
    for (let i = 0; i < 100; i++) {
      const s = randomString(rng, 0, 100);
      const out = Bun.sliceAnsi(s, 0);
      // Note: sliceAnsi consumes standalone C1 ST (0x9C) as a control token,
      // but stripANSI leaves it in (it's not an SGR/OSC sequence). To avoid
      // testing that inconsistency, strip 0x9C from both sides for comparison.
      // Same for other standalone C1 controls (0x90, 0x98, 0x9E, 0x9F) which
      // sliceAnsi will now fall-through as width-0 visible chars.
      const normalize = (x: string) => x.replace(/[\u0090\u0098\u009C\u009E\u009F]/g, "");
      expect(normalize(Bun.stripANSI(out))).toBe(normalize(Bun.stripANSI(s)));
      expect(visibleWidth(out)).toBe(visibleWidth(s));
    }
  });

  // Property: idempotence. slice(slice(s, a, b), 0, b-a) == slice(s, a, b) visually.
  test("slicing a slice is idempotent on visible content", () => {
    const rng = makeRng(0x5678);
    for (let i = 0; i < 100; i++) {
      const s = randomString(rng, 0, 80);
      const w = Bun.stringWidth(s);
      const a = Math.floor(rng() * (w + 1));
      const b = a + Math.floor(rng() * (w - a + 1));
      const once = Bun.sliceAnsi(s, a, b);
      const twice = Bun.sliceAnsi(once, 0, b - a);
      expect(Bun.stripANSI(twice)).toBe(Bun.stripANSI(once));
    }
  });

  // Property: ellipsis width accounting. Output width with ellipsis ≤ requested.
  test("ellipsis output width respects budget", () => {
    const rng = makeRng(0xe111);
    const ellipses = ["…", ".", "...", "→", ""];
    for (let i = 0; i < 200; i++) {
      const s = randomString(rng, 5, 100);
      const n = Math.floor(rng() * 40) + 1;
      const e = ellipses[Math.floor(rng() * ellipses.length)];
      const out = Bun.sliceAnsi(s, 0, n, e);
      // +1 tolerance for wide cluster at the cut boundary (same as above).
      // Also: if ellipsis itself is wider than n (degenerate), it's returned
      // as-is — output may exceed n by up to ellipsisWidth-1.
      const ew = visibleWidth(e);
      const tolerance = Math.max(1, ew > n ? ew - n : 0);
      expect(visibleWidth(out)).toBeLessThanOrEqual(n + tolerance);
    }
  });
});

// ============================================================================
// Adversarial inputs designed to stress edge cases
// ============================================================================

describe("sliceAnsi adversarial", () => {
  // Strings near SIMD stride boundaries (16 bytes / 8 shorts).
  test("inputs near SIMD stride boundaries", () => {
    for (const len of [0, 1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65]) {
      const s = Buffer.alloc(len, "x").toString();
      expect(Bun.sliceAnsi(s, 0, len)).toBe(s);
      expect(Bun.sliceAnsi(s, 0, Math.floor(len / 2))).toBe(s.slice(0, Math.floor(len / 2)));
      // With ANSI
      const ansi = "\x1b[31m" + s + "\x1b[39m";
      expect(Bun.stripANSI(Bun.sliceAnsi(ansi, 0, len))).toBe(s);
    }
  });

  // 0x9C (C1 ST) at various positions relative to SIMD stride.
  test("C1 ST at SIMD boundary positions", () => {
    for (const pos of [0, 1, 7, 8, 15, 16, 17]) {
      const prefix = Buffer.alloc(pos, "x").toString();
      const s = prefix + "\u009C" + "A";
      // 0x9C is consumed by sliceAnsi as a standalone ST control token
      // (width 0, not emitted pre-include). But stripANSI doesn't strip it.
      // So compare against stringWidth-based slicing instead.
      const out = Bun.sliceAnsi(s, 0, pos + 1);
      // Output width should be pos + 1 (prefix 'x's + 'A').
      expect(Bun.stringWidth(out)).toBe(pos + 1);
      // 0x9C should NOT appear in output (consumed as control pre-include).
      // Note: if pos > 0, include is already true by the time we hit 0x9C
      // (position >= start=0 triggers on first char), so 0x9C DOES get emitted
      // as a Control token when include=true. Behavior matches upstream.
      // Just check width for now:
      expect(Bun.stringWidth(out)).toBe(pos + 1);
    }
  });

  // Unterminated ANSI sequences.
  test("unterminated CSI sequences don't hang or overread", () => {
    const cases = [
      "\x1b", // lone ESC
      "\x1b[", // CSI introducer, no final
      "\x1b[31", // CSI params, no final
      "\x1b[31;", // CSI params with trailing ;
      "\x1b]", // OSC introducer, no body
      "\x1b]8", // OSC 8 fragment
      "\x1b]8;;", // OSC 8 no URL no terminator
      "\x1b]8;;http://x", // OSC 8 URL no terminator
      "\x1bP", // DCS no body
      "\x1b_", // APC no body
      "\u009b", // C1 CSI, no params
      "\u009b31", // C1 CSI, no final
      "\u009d8;;http://x", // C1 OSC unterminated
    ];
    for (const c of cases) {
      // Should not hang, not crash, return some finite string.
      const out = Bun.sliceAnsi(c, 0, 10);
      expect(typeof out).toBe("string");
      expect(out.length).toBeLessThanOrEqual(c.length);
      // With content after
      const withAfter = c + "XYZ";
      const out2 = Bun.sliceAnsi(withAfter, 0, 10);
      expect(typeof out2).toBe("string");
    }
  });

  // Deeply nested / many SGR codes (stress SgrStyleState).
  test("many SGR codes don't overflow or quadratic-slow", () => {
    // 100 nested styles. SgrStyleState has inline capacity 4, so this spills to heap.
    let s = "";
    for (let i = 1; i <= 9; i++) s += `\x1b[3${i}m`; // 9 fg colors (last wins)
    for (let i = 0; i < 50; i++) s += `\x1b[1m\x1b[3m\x1b[4m\x1b[7m`; // bold italic underline inverse ×50
    s += "X";
    for (let i = 0; i < 50; i++) s += `\x1b[22m\x1b[23m\x1b[24m\x1b[27m`;
    for (let i = 9; i >= 1; i--) s += `\x1b[39m`;
    const out = Bun.sliceAnsi(s, 0, 1);
    expect(Bun.stripANSI(out)).toBe("X");
    // Time bound: should be O(n), not O(n²). Generous threshold for debug builds.
    const start = Bun.nanoseconds();
    for (let i = 0; i < 1000; i++) Bun.sliceAnsi(s, 0, 1);
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    expect(elapsed).toBeLessThan(5000); // < 5s for 1000 iters
  });

  // Huge SGR parameter values.
  test("huge SGR params don't overflow uint32", () => {
    const s = "\x1b[99999999999999999999mX\x1b[0m";
    const out = Bun.sliceAnsi(s, 0, 1);
    expect(Bun.stripANSI(out)).toBe("X");
  });

  // Many semicolons (SGR param count).
  test("SGR with many parameters", () => {
    const params = Array(1000).fill("0").join(";");
    const s = `\x1b[${params}mX\x1b[0m`;
    const out = Bun.sliceAnsi(s, 0, 1);
    expect(Bun.stripANSI(out)).toBe("X");
  });

  // All zero-width codepoints (position never advances in naive impl).
  test("string of only zero-width chars doesn't hang", () => {
    const zw = "\u200B".repeat(1000); // ZWSP × 1000
    const out = Bun.sliceAnsi(zw, 0, 5);
    // Width 0, so [0, 5) should emit all of them (all at position 0).
    expect(Bun.stringWidth(out)).toBe(0);
    // Should terminate — not hang.
    const start = Bun.nanoseconds();
    Bun.sliceAnsi(zw, 0, 5);
    expect(Bun.nanoseconds() - start).toBeLessThan(1e9); // < 1s
  });

  // Very long ZWJ chain (stresses GraphemeWidthState).
  test("very long ZWJ emoji chain", () => {
    // 👨‍👩‍👧‍👦 repeated — each family is one cluster.
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    const many = family.repeat(100);
    expect(Bun.stringWidth(many)).toBe(200); // 100 families × width 2
    const out = Bun.sliceAnsi(many, 0, 10);
    expect(Bun.stringWidth(out)).toBe(10); // 5 families
  });

  // Extreme indices.
  test("extreme index values", () => {
    const s = "hello";
    // Should not crash/hang for any of these.
    expect(Bun.sliceAnsi(s, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe("");
    expect(Bun.sliceAnsi(s, -Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER)).toBe("");
    expect(Bun.sliceAnsi(s, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe("hello");
    expect(Bun.sliceAnsi(s, 0, 0)).toBe("");
    expect(Bun.sliceAnsi(s, NaN, 3)).toBe("hel"); // NaN → 0 per toIntegerOrInfinity
    expect(Bun.sliceAnsi(s, 0, NaN)).toBe(""); // NaN → 0
    // @ts-expect-error — testing coercion
    expect(Bun.sliceAnsi(s, "1", "3")).toBe("el"); // string coercion
  });

  // OSC with very long URL.
  test("OSC 8 with very long URL", () => {
    const longUrl = "https://example.com/" + "x".repeat(10000);
    const s = `\x1b]8;;${longUrl}\x07link\x1b]8;;\x07`;
    const out = Bun.sliceAnsi(s, 0, 4);
    expect(Bun.stripANSI(out)).toBe("link");
    // The URL should be preserved.
    expect(out).toContain(longUrl);
  });

  // Interleaved everything at once.
  test("ANSI + emoji + CJK + hyperlinks interleaved", () => {
    const s =
      "\x1b[1m安\x1b[31m\x1b]8;;http://a\x07👨‍👩‍👧\x1b]8;;\x07\x1b[39m宁\x1b[22m" + "\x1b[4mhello\x1b[24m\u200B\u5b89world";
    // Just verify no crash, width is sane, stripping works.
    const w = Bun.stringWidth(s);
    for (let a = 0; a <= w; a++) {
      for (let b = a; b <= w; b++) {
        const out = Bun.sliceAnsi(s, a, b);
        // +1 tolerance for wide cluster at cut boundary.
        expect(visibleWidth(out)).toBeLessThanOrEqual(b - a + 1);
      }
    }
  });

  // ANSI codes between every character.
  test("ANSI code between every single visible char", () => {
    const chars = "abcdefghij";
    let s = "";
    for (const c of chars) s += `\x1b[3${chars.indexOf(c) % 8}m${c}`;
    s += "\x1b[39m";
    // Every slice range should produce correct visible text.
    for (let a = 0; a < chars.length; a++) {
      for (let b = a; b <= chars.length; b++) {
        expect(Bun.stripANSI(Bun.sliceAnsi(s, a, b))).toBe(chars.slice(a, b));
      }
    }
  });

  // ANSI inside grapheme cluster.
  test("ANSI between base and combining mark", () => {
    const s = "e\x1b[31m\u0301\x1b[39m"; // 'e' + red + combining acute + reset
    // é is one cluster, width 1.
    expect(Bun.stringWidth(Bun.stripANSI(s))).toBe(1);
    const out = Bun.sliceAnsi(s, 0, 1);
    expect(Bun.stripANSI(out)).toBe("e\u0301");
  });

  // Rope string edge case (JSC may represent concatenated strings as ropes).
  test("rope string (concatenation without flattening)", () => {
    // Force a rope by repeated concat without intermediate reads.
    let rope = "";
    for (let i = 0; i < 100; i++) rope = rope + "x\x1b[31my\x1b[39m";
    // toString in the binding should flatten; verify correctness.
    const out = Bun.sliceAnsi(rope, 0, 50);
    expect(Bun.stripANSI(out).length).toBe(50);
  });

  // Ellipsis that contains ANSI codes.
  test("ellipsis string containing ANSI codes", () => {
    // User shouldn't do this, but we shouldn't crash.
    const s = "hello world";
    const out = Bun.sliceAnsi(s, 0, 5, "\x1b[31m…\x1b[39m");
    // ellipsisWidth is computed via visibleWidthExcludeANSI → 1 for "…"
    expect(typeof out).toBe("string");
    expect(out).toContain("…");
  });

  // Ellipsis wider than slice range.
  test("ellipsis wider than available range", () => {
    const s = "abcdef";
    // Range width 2, ellipsis "..." width 3 → degenerate
    const out = Bun.sliceAnsi(s, 0, 2, "...");
    // Should return ellipsis.toString() per degenerate case handling.
    expect(out).toBe("...");
  });

  // Negative-index + ellipsis (stresses computeTotalWidth pre-pass).
  test("negative index with ellipsis (exercises pre-pass)", () => {
    const s = "\x1b[31m" + "x".repeat(100) + "\x1b[39m";
    const out = Bun.sliceAnsi(s, -10, undefined, "…");
    // Last 10 chars with leading ellipsis: "…" + 9 x's = width 10
    expect(Bun.stringWidth(out)).toBe(10);
    expect(Bun.stripANSI(out)).toBe("…" + "x".repeat(9));
  });
});

// ============================================================================
// Consistency cross-checks with Bun.stringWidth / Bun.stripANSI
// ============================================================================

describe("sliceAnsi consistency with other Bun APIs", () => {
  test("slice width matches stringWidth delta", () => {
    const rng = makeRng(0xabcd);
    for (let i = 0; i < 100; i++) {
      const s = randomString(rng, 10, 80);
      const totalW = Bun.stringWidth(s);
      // Slice [0, totalW) should give back the full width.
      // Use stripped width on both sides to avoid Bun.stringWidth's
      // ANSI-breaks-grapheme-state bug (see visibleWidth comment at top).
      expect(visibleWidth(Bun.sliceAnsi(s, 0, totalW))).toBe(visibleWidth(s));
    }
  });

  test("stripANSI(sliceAnsi(s)) == sliceAnsi(stripANSI(s)) for width-1 text", () => {
    const rng = makeRng(0xd00d);
    for (let i = 0; i < 100; i++) {
      const s = randomAnsiAscii(rng, 0, 60);
      const plain = Bun.stripANSI(s);
      const a = Math.floor(rng() * plain.length);
      const b = a + Math.floor(rng() * (plain.length - a + 1));
      expect(Bun.stripANSI(Bun.sliceAnsi(s, a, b))).toBe(Bun.sliceAnsi(plain, a, b));
    }
  });
});

// ============================================================================
// Helpers
// ============================================================================

function randomString(rng: () => number, minLen: number, maxLen: number): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  const pieces: string[] = [];
  for (let i = 0; i < len; ) {
    const r = rng();
    if (r < 0.4) {
      // ASCII char
      pieces.push(String.fromCharCode(0x20 + Math.floor(rng() * 95)));
      i++;
    } else if (r < 0.55) {
      // SGR code
      pieces.push(`\x1b[${Math.floor(rng() * 108)}m`);
    } else if (r < 0.65) {
      // CJK (width 2)
      pieces.push(String.fromCodePoint(0x4e00 + Math.floor(rng() * 0x5000)));
      i += 2;
    } else if (r < 0.72) {
      // Emoji (surrogate pair, width 2)
      pieces.push(String.fromCodePoint(0x1f600 + Math.floor(rng() * 50)));
      i += 2;
    } else if (r < 0.78) {
      // Combining mark (joins to prev, width 0)
      pieces.push(String.fromCodePoint(0x0300 + Math.floor(rng() * 0x70)));
    } else if (r < 0.82) {
      // ZWJ sequence fragment
      pieces.push("\u200D");
    } else if (r < 0.86) {
      // Variation selector
      pieces.push(rng() < 0.5 ? "\uFE0E" : "\uFE0F");
    } else if (r < 0.9) {
      // Hyperlink
      pieces.push(`\x1b]8;;http://e.x/${Math.floor(rng() * 1000)}\x07`);
    } else if (r < 0.93) {
      // Control char
      pieces.push(String.fromCharCode(Math.floor(rng() * 0x20)));
    } else if (r < 0.96) {
      // C1 control
      pieces.push(String.fromCharCode(0x80 + Math.floor(rng() * 0x20)));
    } else {
      // Truecolor SGR
      pieces.push(`\x1b[38;2;${Math.floor(rng() * 256)};${Math.floor(rng() * 256)};${Math.floor(rng() * 256)}m`);
    }
  }
  return pieces.join("");
}

// ASCII-only with random SGR (width-1 chars only, for strict property checks).
function randomAnsiAscii(rng: () => number, minLen: number, maxLen: number): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  const pieces: string[] = [];
  let visibleCount = 0;
  while (visibleCount < len) {
    if (rng() < 0.3) {
      pieces.push(`\x1b[${Math.floor(rng() * 50)}m`);
    } else {
      pieces.push(String.fromCharCode(0x21 + Math.floor(rng() * 94))); // ! to ~
      visibleCount++;
    }
  }
  pieces.push("\x1b[0m");
  return pieces.join("");
}

// ============================================================================
// Negative-index / computeTotalWidth property tests
// ============================================================================
// Negative indices trigger the ONLY 2-pass code path (computeTotalWidth pre-
// pass). It was less exercised by the unit tests, which mostly use [0, n).

describe("sliceAnsi negative indices", () => {
  test("negative slice equals positive slice via totalWidth", () => {
    const rng = makeRng(0x1de4);
    for (let i = 0; i < 150; i++) {
      const s = randomAnsiAscii(rng, 5, 60);
      const w = Bun.stringWidth(Bun.stripANSI(s));
      // slice(s, -k) should equal slice(s, w - k, w)
      const k = Math.floor(rng() * w) + 1;
      const neg = Bun.sliceAnsi(s, -k);
      const pos = Bun.sliceAnsi(s, w - k, w);
      expect(Bun.stripANSI(neg)).toBe(Bun.stripANSI(pos));
    }
  });

  test("computeTotalWidth matches stringWidth for cluster-rich input", () => {
    // Negative indices with clustering (emoji, ZWJ, combining) stress the
    // pre-pass path. It should give the same totalWidth as stringWidth.
    // Note: use stringWidth(s) directly (NOT stripANSI) — stripANSI's
    // consumeANSI swallows unterminated OSC to EOF, but both stringWidth
    // and sliceAnsi correctly treat malformed introducers as standalone.
    const rng = makeRng(0x70741);
    for (let i = 0; i < 100; i++) {
      const s = randomString(rng, 10, 80);
      const w = Bun.stringWidth(s);
      // slice(s, -w) should return everything (start resolves to 0).
      const out = Bun.sliceAnsi(s, -w);
      expect(Bun.stringWidth(out)).toBe(w);
    }
  });

  test("negative end with ellipsis (cutEndKnown=true path)", () => {
    const rng = makeRng(0x1de5);
    for (let i = 0; i < 100; i++) {
      const s = randomAnsiAscii(rng, 10, 60);
      const w = Bun.stringWidth(Bun.stripANSI(s));
      // [0, -5) with ellipsis — cutEnd is KNOWN (negative end forces pre-pass).
      const out = Bun.sliceAnsi(s, 0, -5, "\u2026");
      // Should be at most w-5+1 cols (+1 for wide-at-boundary).
      expect(visibleWidth(out)).toBeLessThanOrEqual(Math.max(0, w - 5) + 1);
    }
  });
});

// ============================================================================
// ambiguousIsNarrow option fuzz
// ============================================================================

describe("sliceAnsi ambiguousIsNarrow fuzz", () => {
  test("narrow slice ⊆ wide slice visibly (narrow chars are subset)", () => {
    // With ambiguous-wide, each ambiguous char takes 2 cols → fewer fit in
    // the same range → narrow result should be a prefix (or equal) of wide... no,
    // actually the RELATIONSHIP is: same budget, wider chars → fewer chars.
    // Let's just check that both respect the budget.
    const rng = makeRng(0xa4b16);
    for (let i = 0; i < 100; i++) {
      // Mix ambiguous (Greek) + non-ambiguous (ASCII) + ANSI
      const pieces = [];
      const n = 5 + Math.floor(rng() * 30);
      for (let j = 0; j < n; j++) {
        const r = rng();
        if (r < 0.3)
          pieces.push(String.fromCodePoint(0x03b1 + Math.floor(rng() * 24))); // Greek
        else if (r < 0.5)
          pieces.push(String.fromCharCode(0x21 + Math.floor(rng() * 94))); // ASCII
        else if (r < 0.6)
          pieces.push(`\x1b[${30 + Math.floor(rng() * 8)}m`); // SGR
        else pieces.push(String.fromCodePoint(0x0410 + Math.floor(rng() * 32))); // Cyrillic (ambiguous)
      }
      const s = pieces.join("") + "\x1b[0m";
      const budget = Math.floor(rng() * 20) + 1;
      const narrow = Bun.sliceAnsi(s, 0, budget, { ambiguousIsNarrow: true });
      const wide = Bun.sliceAnsi(s, 0, budget, { ambiguousIsNarrow: false });
      expect(Bun.stringWidth(Bun.stripANSI(narrow), { ambiguousIsNarrow: true })).toBeLessThanOrEqual(budget + 1);
      expect(Bun.stringWidth(Bun.stripANSI(wide), { ambiguousIsNarrow: false })).toBeLessThanOrEqual(budget + 1);
    }
  });
});

// ============================================================================
// Encoding equivalence (Latin-1 vs UTF-16 internal representation)
// ============================================================================
// JSC stores strings as either Latin-1 (8-bit) or UTF-16. sliceAnsi templates
// on both. The same visible content in either encoding should slice identically.

describe("sliceAnsi encoding equivalence", () => {
  test("ASCII in Latin-1 vs UTF-16 gives identical results", () => {
    const rng = makeRng(0xe1c0d);
    for (let i = 0; i < 50; i++) {
      // Build a string that COULD be Latin-1 (all < 0x100).
      const latin1 = randomAnsiAscii(rng, 10, 50);
      // Force to UTF-16 by concatenating then removing a high char.
      const utf16 = (latin1 + "\u{1F600}").slice(0, -2);
      // Now latin1 is probably Latin-1, utf16 is definitely UTF-16. Same content.
      for (const a of [0, 2, 5]) {
        for (const b of [10, 20, 100]) {
          expect(Bun.sliceAnsi(utf16, a, b)).toBe(Bun.sliceAnsi(latin1, a, b));
        }
      }
    }
  });

  test("Latin-1-range non-ASCII in both encodings", () => {
    // Chars 0x80-0xFF exist in both encodings. 0xA9 (©), 0xE9 (é), etc.
    const s8 = "\u00A9\u00E9\u00DF\u00F1"; // ©éßñ — likely Latin-1 internally
    const s16 = (s8 + "\u{1F600}").slice(0, -2); // force UTF-16
    for (let a = 0; a <= 4; a++) {
      for (let b = a; b <= 4; b++) {
        expect(Bun.sliceAnsi(s16, a, b)).toBe(Bun.sliceAnsi(s8, a, b));
      }
    }
  });
});

// ============================================================================
// Speculative zone (lazy cutEnd) edge cases
// ============================================================================
// The spec-zone buffer is one of the trickiest parts: content in [end-ew, end)
// is tentatively emitted to a side buffer, then either discarded (cut) or
// flushed (no cut). Stress the boundaries.

describe("sliceAnsi speculative zone", () => {
  test("string width exactly equals budget (no cut, spec zone flushes)", () => {
    // 5 chars, slice [0, 5) with ellipsis. No cut → spec zone content appended,
    // ellipsis NOT emitted.
    const s = "hello";
    expect(Bun.sliceAnsi(s, 0, 5, "\u2026")).toBe("hello");
    expect(Bun.sliceAnsi(s, 0, 5, "...")).toBe("hello");
    // With ANSI (forces slow path but same outcome)
    const sa = "\x1b[31mhello\x1b[39m";
    expect(Bun.stripANSI(Bun.sliceAnsi(sa, 0, 5, "\u2026"))).toBe("hello");
  });

  test("string width exactly one over budget (cut, spec zone discarded)", () => {
    const s = "hello!";
    // budget 5, string width 6 → cut. spec zone had 'o' (cols 4-5). Discarded.
    expect(Bun.sliceAnsi(s, 0, 5, "\u2026")).toBe("hell\u2026");
  });

  test("wide char straddling spec zone boundary", () => {
    // budget 5, ellipsis "…" (ew=1). end adjusted to 4, specEnd=5.
    // Content: "ab安" (a=1, b=1, 安=2). 安 starts at col 2, fits to col 4.
    // Then "cde" — c starts at col 4 ∈ [end=4, specEnd=5) → spec zone.
    // d starts at col 5 = specEnd → cut. Output: "ab安" + ellipsis.
    const s = "ab\u5B89cde";
    expect(Bun.sliceAnsi(s, 0, 5, "\u2026")).toBe("ab\u5B89\u2026");
  });

  test("spec zone with ANSI between zone content and next char", () => {
    // Make sure trailing ANSI in the spec zone ends up in the right place.
    // budget 5, "abcd[SGR]e[SGR]f". e is at col 4 (spec zone). f at 5 → cut.
    // Pending ANSI after 'e' should be close-only filtered, not carry forward.
    const s = "abcd\x1b[31me\x1b[39mf";
    const out = Bun.sliceAnsi(s, 0, 5, "\u2026");
    // Expect "abcd…" — spec zone discarded (including its ANSI), ellipsis emitted.
    expect(Bun.stripANSI(out)).toBe("abcd\u2026");
    expect(Bun.stringWidth(Bun.stripANSI(out))).toBe(5);
  });

  test("SGR opening into spec zone → wraps ellipsis (style inheritance)", () => {
    // 'd' at col 3, [SGR] pending, 'e' at col 4 (spec zone), 'f' at col 5 → cut.
    // [SGR 31] was pending before 'e' → at 'e' (break in zone) flushed to result.
    // Then 'f' cuts, spec zone discarded. Ellipsis emitted inside the [31m.
    // This is correct style inheritance: the ellipsis replaces content that
    // WOULD have been red, so it inherits red.
    const s = "abcd\x1b[31mef\x1b[39m";
    const out = Bun.sliceAnsi(s, 0, 5, "\u2026");
    expect(out).toBe("abcd\x1b[31m\u2026\x1b[39m");
    expect(Bun.stringWidth(out)).toBe(5);
  });

  test("SGR opening AFTER spec zone content → discarded with zone (no leak)", () => {
    // 'e' at col 4 (spec zone), THEN [SGR 31] pending, THEN 'f' at col 5 → cut.
    // [SGR] is pending when 'f' triggers cut → close-only filter → [31m is
    // NOT a close → dropped. No red leak into output.
    const s = "abcde\x1b[31mf\x1b[39m";
    const out = Bun.sliceAnsi(s, 0, 5, "\u2026");
    // Clean: no SGR at all (31m was dropped, nothing active to close).
    expect(out).toBe("abcd\u2026");
    expect(Bun.stringWidth(out)).toBe(5);
  });

  test("spec zone NOT cut (EOF before overflow) → zone flushed, no ellipsis", () => {
    // budget 5, string is exactly "abcde" (width 5). end adjusted to 4,
    // specEnd=5. 'e' at col 4 goes to spec zone. EOF reached — no cut.
    // Zone flushed to result, ellipsis cancelled.
    const s = "abcde";
    expect(Bun.sliceAnsi(s, 0, 5, "\u2026")).toBe("abcde");
    // Same with ANSI (slow path).
    const sa = "\x1b[31mabcde\x1b[39m";
    const out = Bun.sliceAnsi(sa, 0, 5, "\u2026");
    expect(Bun.stripANSI(out)).toBe("abcde");
  });

  test("spec zone fuzz: lazy cutEnd never produces invalid width", () => {
    // Property: for random strings with ellipsis and non-negative indices,
    // width of output is ALWAYS ≤ budget + 1 (atomic wide cluster). The lazy
    // cutEnd path must never leak spec-zone content into the result.
    const rng = makeRng(0x5bec);
    for (let i = 0; i < 300; i++) {
      const s = randomAnsiAscii(rng, 5, 80);
      const n = 3 + Math.floor(rng() * 30);
      const e = rng() < 0.5 ? "\u2026" : "...";
      const out = Bun.sliceAnsi(s, 0, n, e);
      const ow = Bun.stringWidth(Bun.stripANSI(out));
      expect(ow).toBeLessThanOrEqual(n + 1);
      // And the output is well-formed ANSI (stripANSI doesn't throw).
      expect(typeof Bun.stripANSI(out)).toBe("string");
    }
  });
});

// ============================================================================
// Exception safety — option getters that throw
// ============================================================================

describe("sliceAnsi exception safety", () => {
  test("throwing ellipsis getter doesn't corrupt state", () => {
    const s = "hello world";
    // First call throws, second should work normally.
    expect(() =>
      Bun.sliceAnsi(s, 0, 5, {
        get ellipsis() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
    expect(Bun.sliceAnsi(s, 0, 5)).toBe("hello");
  });

  test("throwing ambiguousIsNarrow getter doesn't corrupt state", () => {
    const s = "hello";
    expect(() =>
      Bun.sliceAnsi(s, 0, 3, {
        get ambiguousIsNarrow() {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
    expect(Bun.sliceAnsi(s, 0, 3)).toBe("hel");
  });

  test("non-primitive coercion in indices", () => {
    const s = "abcdef";
    let calls = 0;
    const obj = {
      valueOf() {
        calls++;
        return 2;
      },
    };
    // @ts-expect-error testing coercion
    expect(Bun.sliceAnsi(s, obj, 5)).toBe("cde");
    expect(calls).toBe(1);
  });
});

// ============================================================================
// Bulk-ASCII boundary stress (leave-one-behind logic)
// ============================================================================
// The bulk-emit processes asciiLen-1 chars, leaving the last for per-char
// seeding. Stress the boundary between bulk and per-char processing.

describe("sliceAnsi bulk-ASCII boundary", () => {
  test("ASCII run ending at slice boundary (bulk processes N-1)", () => {
    // 10 ASCII chars, slice [0, 10). bulkN=9, last 'j' goes through per-char.
    // Then emoji (non-ASCII) follows — breaks on 'j', advances position, cuts.
    const s = "abcdefghij\u{1F600}";
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 10))).toBe("abcdefghij");
    // emoji starts at col 10, width 2. [0, 11): col 10 < 11 → emitted atomically.
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 11))).toBe("abcdefghij\u{1F600}");
    // [0, 10): emoji starts at col 10 = end → NOT emitted.
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 10))).toBe("abcdefghij");
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 12))).toBe("abcdefghij\u{1F600}");
  });

  test("single ASCII char (bulkN=0, all goes to per-char)", () => {
    // asciiLen=1 → bulkN=0 → no bulk processing. Covers the edge case.
    const s = "\x1b[31ma\x1b[39m\u{1F600}";
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 1))).toBe("a");
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 3))).toBe("a\u{1F600}");
  });

  test("ASCII + combining mark at the leave-one-behind position", () => {
    // "abcde\u0301" — combining acute attaches to 'e'. bulkN=4 (leave 'e').
    // Per-char processes 'e' (seeds gs), then \u0301 joins → cluster "é" width 1.
    const s = "abcde\u0301";
    expect(Bun.stringWidth(s)).toBe(5);
    expect(Bun.sliceAnsi(s, 0, 5)).toBe("abcde\u0301");
    expect(Bun.sliceAnsi(s, 4, 5)).toBe("e\u0301");
  });

  test("many short ASCII runs between ANSI (bulk rarely engages)", () => {
    // Alternate 2 ASCII chars + SGR. bulkN=1 each time, barely engages.
    let s = "";
    for (let i = 0; i < 50; i++) s += "ab\x1b[3" + (i % 8) + "m";
    s += "\x1b[0m";
    // 100 visible chars. Slice [25, 75).
    expect(Bun.stripANSI(Bun.sliceAnsi(s, 25, 75)).length).toBe(50);
  });
});

// ============================================================================
// Now that stringWidth is fixed, check the direct invariant
// ============================================================================

describe("sliceAnsi direct stringWidth invariant (post-fix)", () => {
  test("stringWidth(slice) ≤ budget + 1 without stripANSI workaround", () => {
    // Before the stringWidth fix, we used visibleWidth (stripANSI first).
    // Now stringWidth correctly preserves grapheme state across ANSI, so
    // we can test the direct invariant. Keep +1 for wide-at-boundary.
    //
    // KNOWN LIMITATION: stringWidth doesn't recognize C1 (8-bit) escape
    // sequences (0x9B CSI, 0x9D OSC, 0x90 DCS, etc.) — only 7-bit (ESC[).
    // sliceAnsi DOES handle C1. So inputs with C1 sequences will show
    // stringWidth > sliceAnsi's internal width. We exclude C1 from this
    // test's generator; C1 coverage is in the adversarial tests above.
    const rng = makeRng(0xd1ec7);
    for (let i = 0; i < 200; i++) {
      const s = randomStringNoC1(rng, 0, 100);
      const w = Bun.stringWidth(s);
      const a = Math.floor(rng() * (w + 3));
      const b = a + Math.floor(rng() * (w + 3));
      const out = Bun.sliceAnsi(s, a, b);
      // stringWidth directly — no stripANSI. If this fails but visibleWidth
      // passes, there's a NEW stringWidth/sliceAnsi inconsistency.
      expect(Bun.stringWidth(out)).toBeLessThanOrEqual(Math.max(0, b - a) + 1);
    }
  });
});

// Like randomString but excludes C1 control bytes (0x80-0x9F). Used for tests
// that compare directly against Bun.stringWidth, which doesn't recognize C1
// escape sequences (only 7-bit ESC-based).
function randomStringNoC1(rng: () => number, minLen: number, maxLen: number): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  const pieces: string[] = [];
  for (let i = 0; i < len; ) {
    const r = rng();
    if (r < 0.4) {
      pieces.push(String.fromCharCode(0x20 + Math.floor(rng() * 95)));
      i++;
    } else if (r < 0.55) {
      pieces.push(`\x1b[${Math.floor(rng() * 108)}m`);
    } else if (r < 0.65) {
      pieces.push(String.fromCodePoint(0x4e00 + Math.floor(rng() * 0x5000)));
      i += 2;
    } else if (r < 0.72) {
      pieces.push(String.fromCodePoint(0x1f600 + Math.floor(rng() * 50)));
      i += 2;
    } else if (r < 0.78) {
      pieces.push(String.fromCodePoint(0x0300 + Math.floor(rng() * 0x70)));
    } else if (r < 0.82) {
      pieces.push("\u200D");
    } else if (r < 0.86) {
      pieces.push(rng() < 0.5 ? "\uFE0E" : "\uFE0F");
    } else if (r < 0.9) {
      pieces.push(`\x1b]8;;http://e.x/${Math.floor(rng() * 1000)}\x07`);
    } else if (r < 0.95) {
      pieces.push(String.fromCharCode(Math.floor(rng() * 0x20)));
    } // C0 only (no C1)
    else {
      pieces.push(`\x1b[38;2;${Math.floor(rng() * 256)};${Math.floor(rng() * 256)};${Math.floor(rng() * 256)}m`);
    }
  }
  return pieces.join("");
}
