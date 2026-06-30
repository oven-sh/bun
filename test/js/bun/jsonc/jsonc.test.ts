import { expect, test } from "bun:test";
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
