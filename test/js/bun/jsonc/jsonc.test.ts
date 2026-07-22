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

test("Bun.JSONC.parse throws a SyntaxError on invalid input", () => {
  for (const input of ["{ not valid", '{"a": }', "[1, 2", '"abc', "   ", ""]) {
    let thrown: unknown;
    try {
      Bun.JSONC.parse(input);
    } catch (e) {
      thrown = e;
    }
    expect(thrown, `input: ${JSON.stringify(input)}`).toBeInstanceOf(SyntaxError);
    expect(thrown, `input: ${JSON.stringify(input)}`).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("SyntaxError");
    expect((thrown as Error).message).toContain("JSONC Parse error");
  }
});

test("Bun.JSONC.parse SyntaxError names the actual error, not a preceding warning", () => {
  let thrown: unknown;
  try {
    Bun.JSONC.parse('{"a":1,"a":2,');
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(SyntaxError);
  expect((thrown as Error).message).not.toContain("Duplicate key");
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
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth, "[").toString() + Buffer.alloc(depth, "]").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

test("Bun.JSONC.parse throws on deeply nested objects instead of crashing", () => {
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth * 5, '{"a":').toString() + "1" + Buffer.alloc(depth, "}").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

test("Bun.JSONC.parse handles pathological inputs in linear time", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        {
          const input = "[{" + "-1" + Buffer.alloc(5 * 50_000, '"":[{').toString();
          let threw;
          try {
            Bun.JSONC.parse(input);
          } catch (e) {
            threw = e;
          }
          if (!threw) throw new Error("expected Bun.JSONC.parse to throw");
          console.log("OK malformed flood");
        }
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
      throw new Error(`generator produced invalid JSON: ${doc}`);
    }
    expect(Bun.JSONC.parse(doc)).toEqual(expected as any);
  }
});

test("Bun.JSONC.parse matches JSON.parse across 64-byte block boundaries", () => {
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

test("Bun.JSONC.parse accepts a BOM adjacent to any token", () => {
  expect(Bun.JSONC.parse("[1\uFEFF,2]")).toEqual([1, 2]);
  expect(Bun.JSONC.parse("[\uFEFF1]")).toEqual([1]);
  expect(Bun.JSONC.parse("[\uFEFFnull\uFEFF]")).toEqual([null]);
  expect(Bun.JSONC.parse('\uFEFF{\uFEFF"a"\uFEFF:\uFEFF1\uFEFF,"b":\uFEFFtrue\uFEFF}\uFEFF')).toEqual({
    a: 1,
    b: true,
  });
});

test("Bun.JSONC.parse accepts a comment immediately after exotic whitespace", () => {
  expect(Bun.JSONC.parse('\uFEFF// see https://aka.ms/tsconfig\n{"a": 1}')).toEqual({ a: 1 });
  expect(Bun.JSONC.parse('{\u00A0/* x */ "a": 1\u00A0// t\n}')).toEqual({ a: 1 });
  expect(Bun.JSONC.parse("[1,\u00A0// c\n2]")).toEqual([1, 2]);
  expect(Bun.JSONC.parse("\uFEFF/* x */[\u00A0/* y */1]")).toEqual([1]);
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
  expect(minified.length).toBeGreaterThan(16 * 8192);
  expect(Bun.JSONC.parse(minified)).toEqual(big as any);
  expect(Bun.JSONC.parse(pretty)).toEqual(big as any);
});

test("Bun.JSONC.parse throws on documents that only parse with error recovery", () => {
  for (const doc of ['{"a":1 "b":2}', '{"a" "b"}', "[1 true]", '["": 1]', '{"a":{"b":1 "c":2}}', '[{"a":1} {"b":2}]']) {
    expect(() => Bun.JSONC.parse(doc), doc).toThrow();
    expect(() => JSON.parse(doc), doc).toThrow();
  }
});

describe("structural index window seams", () => {
  const WINDOW = 8192;
  const BLOCK = 64;

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
  const WINDOW_STARTS = [WINDOW, 2 * WINDOW];

  const sp = (n: number) => Buffer.alloc(n, " ").toString();

  function docAt(offset: number, head: string, lead: string, needle: string, rest: string): string {
    const pad = offset - head.length - lead.length;
    expect(pad).toBeGreaterThanOrEqual(1);
    const doc = head + sp(pad) + lead + needle + rest;
    expect(doc.indexOf(needle)).toBe(offset);
    return doc;
  }

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
      const doc = docAt(offset, '{"k":', "", '"S0S1S2S3', body + '"}');
      expect(doc.length).toBeGreaterThan(3 * WINDOW);
      expectAgree(doc);
    }
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
      expect(actual.split("").map(c => c.charCodeAt(0))).toEqual(expected.split("").map(c => c.charCodeAt(0)));
      expect(actual.charCodeAt(2)).toBe(0xd800);
      expect(actual.length).toBe(5);
    }
  });

  test("keyword literals and numbers split by a window seam", () => {
    for (const token of ["true", "false", "null", "-1.25e+10", "98765.4321e-12", "1e3"]) {
      for (const boundary of [2 * BLOCK, ...WINDOW_STARTS]) {
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
        for (const start of [boundary - 1, boundary + 1 - comment.length]) {
          const jsonc = docAt(start, '{"k":', "", comment, " 42}");
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
      expect(doc[doc.length - 1]).toBe("k");
      expectBothThrow(doc);
    }
  });

  test("control character as the last byte of a window inside a string", () => {
    for (const offset of [WINDOW - 1, WINDOW, 2 * WINDOW - 1]) {
      expectBothThrow(docAt(offset, '{"k":', '"ab', "\x01", 'cd"}'));
    }
  });

  test("closing brace at a window boundary followed by trailing garbage", () => {
    for (const offset of [WINDOW - 1, WINDOW, 2 * WINDOW - 1, 2 * WINDOW]) {
      const doc = docAt(offset, '{"k":1', "", "}", "@@@@");
      expect(() => JSON.parse(doc)).toThrow();
      expect(Bun.JSONC.parse(doc)).toEqual(Bun.JSONC.parse('{"k":1}@@@@'));
    }
  });

  function minifiedDocOfLength(n: number): string {
    const parts: string[] = [];
    let len = 1;
    let i = 0;
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
