import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.JSONC exists", () => {
  expect(Bun.JSONC).toBeDefined();
  expect(typeof Bun.JSONC).toBe("object");
  expect(typeof Bun.JSONC.parse).toBe("function");
});

test("Bun.JSONC.parse handles basic JSON", () => {
  const result = Bun.JSONC.parse('{"name": "test", "value": 42}');
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles comments", () => {
  const jsonc = `{
    // This is a comment
    "name": "test",
    /* This is a block comment */
    "value": 42
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles a comment after a scalar on the same line", () => {
  // tsconfig.json's documented style: `"declaration": true /* note */,`.
  const jsonc = `{
    "a": 1 /* one */,
    "b": true /* yes */ ,
    "c": null // nothing
    , "d": -2.5 /* negative */
  }`;
  expect(Bun.JSONC.parse(jsonc)).toEqual({ a: 1, b: true, c: null, d: -2.5 });
});

test("Bun.JSONC.parse handles trailing commas", () => {
  const jsonc = `{
    "name": "test",
    "value": 42,
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles arrays with trailing commas", () => {
  const jsonc = `[
    1,
    2,
    3,
  ]`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual([1, 2, 3]);
});

test("Bun.JSONC.parse handles complex JSONC", () => {
  const jsonc = `{
    // Configuration object
    "name": "my-app",
    "version": "1.0.0",
    /* Dependencies section */
    "dependencies": {
      "react": "^18.0.0",
      "typescript": "^5.0.0", // Latest TypeScript
    },
    "scripts": [
      "build",
      "test",
      "lint", // Code formatting
    ],
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      react: "^18.0.0",
      typescript: "^5.0.0",
    },
    scripts: ["build", "test", "lint"],
  });
});

test("Bun.JSONC.parse handles nested objects", () => {
  const jsonc = `{
    "outer": {
      // Nested comment
      "inner": {
        "value": 123,
      }
    },
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    outer: {
      inner: {
        value: 123,
      },
    },
  });
});

test("Bun.JSONC.parse handles boolean and null values", () => {
  const jsonc = `{
    "enabled": true, // Boolean true
    "disabled": false, // Boolean false
    "nothing": null, // Null value
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    enabled: true,
    disabled: false,
    nothing: null,
  });
});

test("Bun.JSONC.parse throws on invalid JSON", () => {
  expect(() => {
    Bun.JSONC.parse("{ invalid json }");
  }).toThrow();
});

test("Bun.JSONC.parse handles empty object", () => {
  const result = Bun.JSONC.parse("{}");
  expect(result).toEqual({});
});

test("Bun.JSONC.parse handles empty array", () => {
  const result = Bun.JSONC.parse("[]");
  expect(result).toEqual([]);
});

test("Bun.JSONC.parse throws on deeply nested arrays instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack (largest of any
  // platform) at the smallest expected per-recursion frame size (~100 B in
  // release builds). Previously 25_000, which was sized for Zig's larger
  // frames (no LLVM lifetime annotations → frame is the union of all locals).
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth, "[").toString() + Buffer.alloc(depth, "]").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

test("Bun.JSONC.parse throws on deeply nested objects instead of crashing", () => {
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth * 5, '{"a":').toString() + "1" + Buffer.alloc(depth, "}").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

// The lenient JSONC parser recovers from errors, so a large malformed input
// can produce a diagnostic for nearly every token. Computing each
// diagnostic's line/column used to rescan the source from byte 0, which made
// error reporting quadratic — a ~250 KB input hung for minutes (found by
// fuzzing). Positions are now computed incrementally, so these inputs must
// parse (or fail) in linear time.
test("Bun.JSONC.parse handles pathological inputs in linear time", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // A number in object-key position is a parse error; this input used to
        // send the old parser into a quadratic recovery walk over the
        // remaining ~250 KB.
        {
          const input = "[{" + "-1" + Buffer.alloc(5 * 50_000, '"":[{').toString();
          let threw;
          try {
            Bun.JSONC.parse(input);
          } catch (e) {
            threw = e;
          }
          // The parser reports the first error and stops (it no longer walks the
          // remaining 250 KB logging an error per property), so this is a single
          // SyntaxError-like BuildMessage; with multiple log messages it is an
          // AggregateError. Either way it must throw and must do so in linear time.
          if (!threw) throw new Error("expected Bun.JSONC.parse to throw");
          console.log("OK malformed flood");
        }
        // Duplicate-key warnings compute a position per warning the same way;
        // a valid object with ~40k duplicate keys used to take >10 seconds.
        {
          const input = "{" + Buffer.alloc(6 * 40_000, '"a":1,').toString() + '"a":1}';
          const result = Bun.JSONC.parse(input);
          if (result.a !== 1) throw new Error("unexpected parse result");
          console.log("OK duplicate key flood");
        }
        console.log("DONE");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Generous kill switch: the fixed parser finishes in a few seconds even in
    // debug+ASAN builds, while the quadratic behavior took minutes.
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("OK malformed flood");
  expect(stdout).toContain("OK duplicate key flood");
  expect(stdout).toContain("DONE");
  expect(exitCode).toBe(0);
}, 90_000);

// ── Differential: Bun.JSONC.parse must agree with JSON.parse on valid JSON ──
//
// `Bun.JSONC.parse` is the JS-visible entry point of Bun's own JSON parser
// (src/parsers/json.rs — the same engine that parses package.json, registry
// manifests and tsconfig), so this differentially tests that engine against
// JavaScriptCore's JSON.parse using deterministic pseudo-random documents.

// Deterministic xorshift so failures reproduce.
function makeRng(seed: number) {
  let s0 = BigInt(seed) | 1n;
  return () => {
    s0 ^= (s0 << 13n) & 0xffffffffffffffffn;
    s0 ^= s0 >> 7n;
    s0 ^= (s0 << 17n) & 0xffffffffffffffffn;
    return Number(s0 & 0xffffffn) / 0x1000000;
  };
}

function generateJSON(rand: () => number, depth: number): string {
  const r = rand();
  if (depth > 3 || r < 0.12) return "null";
  if (r < 0.22) return rand() < 0.5 ? "true" : "false";
  if (r < 0.4) {
    const n = rand();
    if (n < 0.25) return String(Math.floor(rand() * 2 ** 31) * (rand() < 0.5 ? -1 : 1));
    if (n < 0.5) return (rand() * 1e9).toFixed(3);
    if (n < 0.75) return `${Math.floor(rand() * 1e6)}e${Math.floor(rand() * 40) - 20}`;
    return String(rand() * Number.MAX_SAFE_INTEGER);
  }
  if (r < 0.62) {
    let out = "";
    const len = Math.floor(rand() * 60);
    for (let i = 0; i < len; i++) {
      const c = rand();
      if (c < 0.06) out += '\\"';
      else if (c < 0.12) out += "\\\\";
      else if (c < 0.18) out += "\\n";
      else if (c < 0.24) out += "\\u00e9";
      else if (c < 0.3) out += "é";
      else if (c < 0.34) out += "🚀";
      else if (c < 0.38) out += "\\ud83d\\ude00";
      else if (c < 0.42) out += "\\t";
      else out += String.fromCharCode(97 + Math.floor(rand() * 26));
    }
    return `"${out}"`;
  }
  if (r < 0.8) {
    const n = Math.floor(rand() * 6);
    const items: string[] = [];
    for (let i = 0; i < n; i++) items.push(generateJSON(rand, depth + 1));
    return `[${items.join(",")}]`;
  }
  const n = Math.floor(rand() * 8);
  const props: string[] = [];
  for (let i = 0; i < n; i++) {
    props.push(`"k${i}_${Math.floor(rand() * 1000)}"${rand() < 0.2 ? " " : ""}:${generateJSON(rand, depth + 1)}`);
  }
  // Mix in pretty-printed shapes so the whitespace paths are covered too.
  return rand() < 0.3 ? `{\n  ${props.join(",\n  ")}\n}` : `{${props.join(",")}}`;
}

test("Bun.JSONC.parse matches JSON.parse on generated documents", () => {
  const rand = makeRng(0xc0ffee);
  for (let i = 0; i < 750; i++) {
    const doc = generateJSON(rand, 0);
    let expected: unknown;
    try {
      expected = JSON.parse(doc);
    } catch {
      // The generator only produces valid JSON; if JSON.parse rejects it the
      // generator is broken, not the parser.
      throw new Error(`generator produced invalid JSON: ${doc}`);
    }
    expect(Bun.JSONC.parse(doc)).toEqual(expected as any);
  }
});

test("Bun.JSONC.parse matches JSON.parse across 64-byte block boundaries", () => {
  // Strings/escapes straddling the SIMD block size and the buffer end.
  for (let pad = 40; pad <= 96; pad++) {
    const a = "a".repeat(pad);
    for (const doc of [
      `{"${a}": "x", "k": "${a}\\n"}`,
      `["${a}\\\\"]`,
      `[${" ".repeat(pad)}1]`,
      `{"k":"${a}"}`,
      `"${a}\\u00e9"`,
    ]) {
      expect(Bun.JSONC.parse(doc)).toEqual(JSON.parse(doc));
    }
  }
});

test("Bun.JSONC.parse matches JSON.parse on escape-heavy strings", () => {
  for (const doc of [
    String.raw`"\\\\\""`,
    String.raw`["\b\f\n\r\t\/\\"]`,
    '{"😀":"😀"}',
    '"' + "\\\\".repeat(63) + '"',
    '"' + "\\\\".repeat(64) + '"',
    '"' + "\\\\".repeat(65) + '"',
  ]) {
    expect(Bun.JSONC.parse(doc)).toEqual(JSON.parse(doc));
  }
});

test("Bun.JSONC.parse matches JSON.parse on lone and paired surrogate escapes", () => {
  // `\uD800`-style escapes that don't form a valid pair still decode to the
  // lone surrogate code unit (WTF-16), exactly like JSON.parse — not U+FFFD.
  for (const doc of [
    '"\\ud800"',
    '"a\\udfffz"',
    '"\\u00e9\\ud800x"',
    '"\\udfff\\ud800"',
    '"\\ud83d\\ude00"',
    '"\\ud800\\udc00"',
    '{"k\\ud800": "\\udc00v"}',
    '["\\ud800", "🚀\\udfff"]',
  ]) {
    const expected = JSON.parse(doc);
    const actual = Bun.JSONC.parse(doc);
    expect(actual).toEqual(expected);
    const flatten = (v: unknown): string[] =>
      typeof v === "string"
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(flatten)
          : Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...flatten(x)]);
    const codeUnits = (v: unknown) => flatten(v).map(s => Array.from(s, c => c.codePointAt(0)));
    expect(codeUnits(actual)).toEqual(codeUnits(expected));
  }
});

test("Bun.JSONC.parse accepts a BOM and exotic whitespace between tokens", () => {
  expect(Bun.JSONC.parse('﻿{"a": 1}')).toEqual({ a: 1 });
  expect(Bun.JSONC.parse('{ "a" : 1 }')).toEqual({ a: 1 });
  expect(Bun.JSONC.parse('{"a": 1 }')).toEqual({ a: 1 });
});

test("Bun.JSONC.parse rejects raw control characters and unterminated strings", () => {
  expect(() => Bun.JSONC.parse('{"a": "line1\nline2"}')).toThrow();
  expect(() => Bun.JSONC.parse('"ab\tcd"')).toThrow();
  expect(() => Bun.JSONC.parse('"abc')).toThrow();
  expect(() => Bun.JSONC.parse('{"a": 1')).toThrow();
  expect(() => Bun.JSONC.parse("[1, 2")).toThrow();
});

test("Bun.JSONC.parse accepts single-quoted strings like the previous parser", () => {
  expect(Bun.JSONC.parse(`{'a': 'b"c'}`)).toEqual({ a: 'b"c' });
});

test("Bun.JSONC.parse handles huge documents with every value type", () => {
  // Large enough to exercise many 64-byte blocks and the index growth path.
  const big: Record<string, unknown> = {};
  for (let i = 0; i < 5000; i++) {
    big["key_" + i] =
      i % 5 === 0
        ? { nested: [i, String(i), null, i % 2 === 0], deeper: { x: "é🚀" + i } }
        : i % 3 === 0
          ? 'value with "escapes" and \\ backslashes ' + i
          : i * 1.5;
  }
  const minified = JSON.stringify(big);
  const pretty = JSON.stringify(big, null, 2);
  // The structural indexer streams the document through an 8 KiB window;
  // both shapes must be large enough to force many window refills.
  expect(minified.length).toBeGreaterThan(16 * 8192);
  expect(Bun.JSONC.parse(minified)).toEqual(big as any);
  expect(Bun.JSONC.parse(pretty)).toEqual(big as any);
});

// The parser logs a recoverable diagnostic for a missing comma or colon and
// returns the partial document; `Bun.JSONC.parse` must report that as an error
// instead of silently dropping the rest of the container.
test("Bun.JSONC.parse throws on documents that only parse with error recovery", () => {
  for (const doc of ['{"a":1 "b":2}', '{"a" "b"}', "[1 true]", '["": 1]', '{"a":{"b":1 "c":2}}', '[{"a":1} {"b":2}]']) {
    expect(() => Bun.JSONC.parse(doc), doc).toThrow();
    expect(() => JSON.parse(doc), doc).toThrow();
  }
});

// ── Structural index window seams ──────────────────────────────────────────
//
// The structural indexer (src/parsers/json_index.rs) streams the source
// through an 8 KiB refill window (`REFILL_INPUT = 8 * 1024`) and the SIMD
// kernel processes 64-byte blocks within it. Every document here is pure
// ASCII, so JS string indices equal UTF-8 byte offsets, and the interesting
// construct is placed (using inter-token whitespace padding) so that it
// starts at, ends at, or straddles a window/block boundary. The padding math
// is asserted in `docAt`, so a drift in the layout fails loudly instead of
// silently testing nothing.
describe("structural index window seams", () => {
  const WINDOW = 8192; // REFILL_INPUT in src/parsers/json_index.rs
  const BLOCK = 64; // SIMD block size

  // Offsets at which a construct should start: the last byte of a window or
  // block (boundary - 1), the first byte of the next one (boundary), and one
  // past it, for the first two window boundaries and a couple of block
  // boundaries.
  const SEAMS = [
    BLOCK - 1,
    BLOCK,
    BLOCK + 1,
    3 * BLOCK - 1,
    3 * BLOCK,
    3 * BLOCK + 1,
    WINDOW - 1,
    WINDOW,
    WINDOW + 1,
    2 * WINDOW - 1,
    2 * WINDOW,
    2 * WINDOW + 1,
  ];
  // The first byte of the 2nd and 3rd refill windows.
  const WINDOW_STARTS = [WINDOW, 2 * WINDOW];

  const sp = (n: number) => Buffer.alloc(n, " ").toString();

  // Builds `<head><spaces><lead><needle><rest>` such that `needle` begins at
  // exactly byte `offset`, and asserts that position. `needle` must not occur
  // earlier in the document.
  function docAt(offset: number, head: string, lead: string, needle: string, rest: string): string {
    const pad = offset - head.length - lead.length;
    expect(pad).toBeGreaterThanOrEqual(1);
    const doc = head + sp(pad) + lead + needle + rest;
    expect(doc.indexOf(needle)).toBe(offset);
    return doc;
  }

  // For strict-JSON documents, JSC's JSON.parse is the oracle.
  function expectAgree(doc: string) {
    expect(Bun.JSONC.parse(doc)).toEqual(JSON.parse(doc));
  }
  function expectBothThrow(doc: string) {
    expect(() => JSON.parse(doc)).toThrow();
    expect(() => Bun.JSONC.parse(doc)).toThrow();
  }

  test("string whose opening quote is the last byte of a window", () => {
    for (const offset of SEAMS) {
      expectAgree(docAt(offset, '{"k":', "", '"seam-value"', "}"));
    }
  });

  test("string starting at a window seam and spanning 3+ windows", () => {
    const body = Buffer.alloc(2 * WINDOW + 7, "z").toString();
    for (const offset of [WINDOW - 1, WINDOW, WINDOW + 1]) {
      // The opening quote sits at `offset` and the closing quote lands two
      // windows later.
      const doc = docAt(offset, '{"k":', "", '"S0S1S2S3', body + '"}');
      expect(doc.length).toBeGreaterThan(3 * WINDOW);
      expectAgree(doc);
    }
    // Also: a string that begins in the first window and spans 3 windows.
    const doc = '{"k":"' + body + body.slice(0, WINDOW) + '"}';
    expect(doc.length).toBeGreaterThan(3 * WINDOW);
    expectAgree(doc);
  });

  test("two-character escape whose backslash is the last byte of a window", () => {
    for (const offset of SEAMS) {
      expectAgree(docAt(offset, '{"k":', '"ab', "\\n", 'cd"}'));
      expectAgree(docAt(offset, '{"k":', '"ab', "\\\\", 'cd"}'));
      expectAgree(docAt(offset, '{"k":', '"ab', '\\"', 'cd"}'));
    }
  });

  test("\\uXXXX escape straddling a window seam at every internal byte", () => {
    const needle = "\\u00e9";
    for (const boundary of [2 * BLOCK, ...WINDOW_STARTS]) {
      // Slide the 6-byte escape across the boundary so each of its bytes is
      // the first byte of the new window exactly once.
      for (let d = -needle.length; d <= 1; d++) {
        expectAgree(docAt(boundary + d, '{"k":', '"ab', needle, 'cd"}'));
      }
    }
  });

  test("surrogate-pair escape straddling a window seam at every internal byte", () => {
    const needle = "\\uD83D\\uDE00";
    for (const boundary of [2 * BLOCK, ...WINDOW_STARTS]) {
      for (let d = -needle.length; d <= 1; d++) {
        const doc = docAt(boundary + d, '{"k":', '"ab', needle, 'cd"}');
        const actual = Bun.JSONC.parse(doc) as { k: string };
        const expected = JSON.parse(doc) as { k: string };
        expect(actual).toEqual(expected);
        expect(actual.k).toBe("ab\u{1F600}cd");
      }
    }
  });

  test("lone surrogate escape at a window seam keeps the exact code units", () => {
    for (const offset of SEAMS) {
      const doc = docAt(offset, '{"k":', '"ab', "\\uD800", 'cd"}');
      const actual = (Bun.JSONC.parse(doc) as { k: string }).k;
      const expected = (JSON.parse(doc) as { k: string }).k;
      // Compare WTF-16 code units, not just toEqual, so a U+FFFD replacement
      // (or a dropped unit) is caught.
      expect(actual.split("").map(c => c.charCodeAt(0))).toEqual(expected.split("").map(c => c.charCodeAt(0)));
      expect(actual.charCodeAt(2)).toBe(0xd800);
      expect(actual.length).toBe(5);
    }
  });

  test("keyword literals and numbers split by a window seam", () => {
    for (const token of ["true", "false", "null", "-1.25e+10", "98765.4321e-12", "1e3"]) {
      for (const boundary of [2 * BLOCK, ...WINDOW_STARTS]) {
        // Start offsets from "the whole token is just before the boundary"
        // through "the token starts just after it", so the seam falls between
        // every adjacent pair of its bytes.
        for (let start = boundary - token.length; start <= boundary + 1; start++) {
          expectAgree(docAt(start, '{"k":', "", token, "}"));
        }
      }
    }
  });

  test("block comment delimiters straddling a window seam", () => {
    for (const length of [4, 32]) {
      const comment = "/*" + Buffer.alloc(length - 4, "x").toString() + "*/";
      expect(comment.length).toBe(length);
      for (const boundary of WINDOW_STARTS) {
        // Opening `/*` straddles the seam, then closing `*/` straddles it.
        for (const start of [boundary - 1, boundary + 1 - comment.length]) {
          const jsonc = docAt(start, '{"k":', "", comment, " 42}");
          // Oracle: the same bytes with the comment blanked out by an
          // equal-length run of spaces is plain JSON.
          const json = jsonc.replace(comment, sp(comment.length));
          expect(json.length).toBe(jsonc.length);
          expect(Bun.JSONC.parse(jsonc)).toEqual(JSON.parse(json));
        }
      }
    }
  });

  test("line comment whose newline is the first byte of the next window", () => {
    for (const boundary of WINDOW_STARTS) {
      const jsonc = docAt(boundary, '{"k":1', "//xxxx", "\n", "}");
      const json = jsonc.replace("//xxxx", sp(6));
      expect(json.length).toBe(jsonc.length);
      expect(Bun.JSONC.parse(jsonc)).toEqual(JSON.parse(json));
    }
  });

  test("line comment whose two slashes straddle a window seam", () => {
    for (const boundary of WINDOW_STARTS) {
      const jsonc = docAt(boundary - 1, '{"k":1', "", "//", "xx\n}");
      const json = jsonc.replace("//xx", sp(4));
      expect(json.length).toBe(jsonc.length);
      expect(Bun.JSONC.parse(jsonc)).toEqual(JSON.parse(json));
    }
  });

  test("single-quoted string opening at a window seam (scalar fallback path)", () => {
    // A single quote outside a string makes the indexer fall back to the
    // scalar path for that chunk; JSONC accepts single-quoted strings.
    for (const offset of SEAMS) {
      expect(Bun.JSONC.parse(docAt(offset, "{'k':", "", "'seam'", "}"))).toEqual({ k: "seam" });
    }
  });

  test("unterminated string whose opening quote is the last byte of a window", () => {
    for (const offset of [WINDOW - 1, WINDOW, 2 * WINDOW - 1]) {
      expectBothThrow(docAt(offset, '{"k":', "", '"never-closed', ""));
    }
  });

  test("document truncated exactly at a window boundary inside a key", () => {
    for (const boundary of WINDOW_STARTS) {
      const full = '{"' + Buffer.alloc(boundary + 100, "k").toString() + '":1}';
      const doc = full.slice(0, boundary);
      expect(doc.length).toBe(boundary);
      // The cut lands inside the (unterminated) key.
      expect(doc[doc.length - 1]).toBe("k");
      expectBothThrow(doc);
    }
  });

  test("control character as the last byte of a window inside a string", () => {
    for (const offset of [WINDOW - 1, WINDOW, 2 * WINDOW - 1]) {
      expectBothThrow(docAt(offset, '{"k":', '"ab', "\x01", 'cd"}'));
    }
  });

  // Bun.JSONC.parse parses the first value and ignores trailing content (the
  // released parser already accepted `{"k":1}true` / `{}[]`), so the invariant
  // here is only that a window seam between the value and the trailing bytes
  // does not change the result. JSON.parse, by contrast, must always reject.
  test("closing brace at a window boundary followed by trailing garbage", () => {
    for (const offset of [WINDOW - 1, WINDOW, 2 * WINDOW - 1, 2 * WINDOW]) {
      const doc = docAt(offset, '{"k":1', "", "}", "@@@@");
      expect(() => JSON.parse(doc)).toThrow();
      expect(Bun.JSONC.parse(doc)).toEqual(Bun.JSONC.parse('{"k":1}@@@@'));
    }
  });

  // A minified JSON object of exactly `n` bytes: numbered keys generated by a
  // counter, then a final string property padded so the total length is `n`.
  function minifiedDocOfLength(n: number): string {
    const parts: string[] = [];
    let len = 1; // "{"
    let i = 0;
    // Always leave room for the closing `"pad":"<fill>"}` entry.
    while (len + 40 < n) {
      const piece = `"k${String(i).padStart(6, "0")}":${i % 997},`;
      parts.push(piece);
      len += piece.length;
      i++;
    }
    const fill = n - (len + '"pad":""}'.length);
    expect(fill).toBeGreaterThanOrEqual(0);
    const doc = "{" + parts.join("") + '"pad":"' + Buffer.alloc(fill, "p").toString() + '"}';
    expect(doc.length).toBe(n);
    return doc;
  }

  test("documents sized exactly at and around window multiples", () => {
    for (const n of [WINDOW - 1, WINDOW, WINDOW + 1, 3 * WINDOW, 8 * WINDOW - 1, 8 * WINDOW, 8 * WINDOW + 1]) {
      expectAgree(minifiedDocOfLength(n));
    }
  });

  // A BOM-prefixed document whose first comment (or single quote) is past the
  // first SIMD window: the kernel indexes the document until the comment
  // makes it bail, then the scalar indexer restarts from byte 0 and must
  // re-derive the exact same index stream — including for the BOM, whose
  // middle byte is one of the few non-ASCII bytes the shared classification
  // table calls structural.
  test("BOM-prefixed document with a comment past the first window", () => {
    let body = "";
    let i = 0;
    while (body.length < 3 * WINDOW) body += `"k${i++}": ${i},\n`;
    const doc = "\uFEFF{\n" + body + '"z": 0 // trailing comment\n}\n';
    expect(doc.indexOf("//")).toBeGreaterThan(WINDOW);
    const expected = JSON.parse(doc.replace("\uFEFF", "").replace("// trailing comment", ""));
    expect(Bun.JSONC.parse(doc)).toEqual(expected);

    const singleQuoted = "\uFEFF{\n" + body + "'z': 'x'\n}\n";
    expect((Bun.JSONC.parse(singleQuoted) as Record<string, unknown>).z).toBe("x");
  });
});
