import { simdJSONInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const { parse, index, cursorGet } = simdJSONInternals;

// Compares the SIMD parser against the engine's JSON.parse on inputs both must
// accept. Differences are bugs in the new parser.
function ok(input: string) {
  expect(parse(input)).toEqual(JSON.parse(input));
}

function err(input: string) {
  expect(() => parse(input)).toThrow();
  expect(() => JSON.parse(input)).toThrow();
}

describe("simdjson stage-1 indexer", () => {
  test("structural indices for a small document", () => {
    //          0         1
    //          0123456789012345
    const s = '{"a": [1, true]}';
    expect(index(s)).toEqual([0, 1, 4, 6, 7, 8, 10, 14, 15]);
  });

  test("ignores characters inside strings", () => {
    const s = '{"key,with:ops[]{}": 1}';
    // {  "  :  1  }
    expect(index(s)).toEqual([0, 1, 19, 21, 22]);
  });

  test("escaped quotes do not terminate strings", () => {
    expect(index('["a\\"b", 1]')).toEqual([0, 1, 7, 9, 10]);
  });

  test("backslash run parity across many backslashes", () => {
    // 4 backslashes then quote: quote is unescaped → string ends at pos 6.
    expect(index(String.raw`["\\\\", 1]`)).toEqual([0, 1, 7, 9, 10]);
    // 3 backslashes then quote: quote at 5 is escaped, real close at 6.
    expect(index(String.raw`["\\\"", 1]`)).toEqual([0, 1, 7, 9, 10]);
  });

  test("unclosed string is reported", () => {
    expect(() => index('["never ends')).toThrow(/UnclosedString/);
  });
});

describe("simdjson stage-2 — leaves", () => {
  test.each([
    "true",
    "false",
    "null",
    "0",
    "1",
    "-0",
    "-1",
    "42",
    "1234567890",
    "-1234567890",
    "1.5",
    "-1.5",
    "0.0001",
    "1e10",
    "1E10",
    "1e+10",
    "1e-10",
    "1.234e56",
    "-1.234e-56",
    "9007199254740993",
    "1.7976931348623157e308",
    '""',
    '"hello"',
    '"with spaces and\\ttabs"',
    '"escaped \\"quote\\""',
    '"\\\\"',
    '"\\/"',
    '"\\b\\f\\n\\r\\t"',
    '"\\u0041"',
    '"\\u00e9"',
    '"\\ud83d\\ude00"',
    '"日本語"',
    '"😀"',
  ])("parses %s", ok);

  test.each([
    "",
    "  ",
    "tru",
    "truee",
    "nul",
    "fals",
    "falsey",
    "01",
    "-",
    ".5",
    "1.",
    "1e",
    "1e+",
    "+1",
    "--1",
    "0x1",
    "1_000",
    "Infinity",
    "NaN",
    '"',
    '"unterminated',
    '"\\x41"',
    '"\\u12"',
    '"\\"',
    '"control\nchar"',
    "'single'",
  ])("rejects %s", err);
});

describe("simdjson stage-2 — containers", () => {
  test.each([
    "[]",
    "{}",
    "[1,2,3]",
    "[[]]",
    "[[],[]]",
    "[{},{}]",
    '{"a":1}',
    '{"a":1,"b":2}',
    '{"a":[1,2,{"b":[true,false,null]}]}',
    '{"":""}',
    "[1, 2 ,3 ]",
    ' { "a" : 1 } ',
    "[\n  1,\n  2\n]",
  ])("parses %s", ok);

  test.each([
    "[",
    "]",
    "{",
    "}",
    "[,]",
    "[1,]",
    "[1,,2]",
    "[1 2]",
    "{,}",
    '{"a":1,}',
    '{"a"}',
    '{"a":}',
    '{"a" 1}',
    "{a:1}",
    "{1:1}",
    "[1]]",
    "{}{}",
    "1 2",
    "[1] [2]",
  ])("rejects %s", err);
});

describe("simdjson — block boundaries", () => {
  // Stage 1 processes 64-byte blocks; place tokens straddling the boundary.
  test("string spanning multiple 64-byte blocks", () => {
    const body = "x".repeat(200);
    ok(JSON.stringify({ k: body }));
  });

  test("escaped quote straddling block boundary", () => {
    for (let pad = 55; pad <= 70; pad++) {
      const s = `{"${"a".repeat(pad)}\\"tail": 1}`;
      ok(s);
    }
  });

  test("backslash run ending at block boundary", () => {
    for (let pad = 55; pad <= 70; pad++) {
      // Even-length run → following quote is real.
      ok(`["${"a".repeat(pad)}\\\\", 1]`);
      // Odd-length run → following quote is escaped, then a real one.
      ok(`["${"a".repeat(pad)}\\\\\\"", 1]`);
    }
  });

  test("number straddling block boundary", () => {
    for (let pad = 55; pad <= 70; pad++) {
      ok(`[${" ".repeat(pad)}12345.6789e10]`);
    }
  });

  test("scalar start at every offset within a block", () => {
    for (let pad = 0; pad < 130; pad++) {
      ok(`${" ".repeat(pad)}[true,false,null,42]`);
    }
  });
});

describe("simdjson — depth and size", () => {
  test("deeply nested arrays", () => {
    const depth = 512;
    const s = "[".repeat(depth) + "1" + "]".repeat(depth);
    ok(s);
  });

  test("nesting beyond MAX_DEPTH is rejected without crashing", () => {
    const depth = 2000;
    const s = "[".repeat(depth) + "1" + "]".repeat(depth);
    expect(() => parse(s)).toThrow();
  });

  test("large array of integers", () => {
    const arr = Array.from({ length: 10000 }, (_, i) => i);
    ok(JSON.stringify(arr));
  });

  test("large object", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) obj[`key_${i}`] = i;
    ok(JSON.stringify(obj));
  });

  test("real-world: this repo's package.json", async () => {
    const text = await Bun.file(new URL("../../../../package.json", import.meta.url)).text();
    ok(text);
  });
});

describe("JsonCursor — on-demand navigation", () => {
  const doc = JSON.stringify({
    name: "pkg",
    versions: {
      "1.0.0": { dist: { tarball: "https://a/1.tgz" }, bin: { x: "y" } },
      "2.0.0": { dist: { tarball: "https://a/2.tgz", integrity: "sha512-abc" } },
    },
    nested: { a: { b: { c: "deep" } } },
    esc: "line1\nline2",
    arr: [1, [2, 3], { k: "v" }],
  });

  test("get() walks dotted paths", () => {
    expect(cursorGet(doc, "name")).toBe("pkg");
    expect(cursorGet(doc, "nested.a.b.c")).toBe("deep");
  });

  test("missing keys return undefined", () => {
    expect(cursorGet(doc, "nope")).toBeUndefined();
    expect(cursorGet(doc, "versions.nope")).toBeUndefined();
    expect(cursorGet(doc, "name.foo")).toBeUndefined();
  });

  test("escapes are decoded", () => {
    expect(cursorGet(doc, "esc")).toBe("line1\nline2");
    expect(cursorGet('{"k":"a\\u00e9b"}', "k")).toBe("aéb");
    expect(cursorGet('{"k":"\\ud83d\\ude00"}', "k")).toBe("😀");
  });

  test("non-string values return null from cursorGet", () => {
    expect(cursorGet(doc, "arr")).toBeNull();
    expect(cursorGet(doc, "versions")).toBeNull();
  });

  test("skipping deep/large values", () => {
    // a 10K-element array that get() must skip past to reach "after"
    const big = JSON.stringify({
      before: "x",
      huge: Array.from({ length: 10000 }, (_, i) => ({ n: i })),
      after: "found",
    });
    expect(cursorGet(big, "after")).toBe("found");
  });

  test("real-world: this repo's package.json", async () => {
    const text = await Bun.file(new URL("../../../../package.json", import.meta.url)).text();
    const ref = JSON.parse(text);
    expect(cursorGet(text, "name")).toBe(ref.name);
    expect(cursorGet(text, "version")).toBe(ref.version);
  });
});

describe("simdjson — randomized fuzzing against JSON.parse", () => {
  function rand(n: number) {
    return Math.floor(Math.random() * n);
  }
  function genValue(depth: number): unknown {
    if (depth <= 0) return [null, true, false, rand(1e6) - 5e5, Math.random(), randString()][rand(6)];
    switch (rand(6)) {
      case 0:
        return null;
      case 1:
        return rand(2) === 0;
      case 2:
        return (Math.random() - 0.5) * 1e6;
      case 3:
        return randString();
      case 4: {
        const n = rand(6);
        return Array.from({ length: n }, () => genValue(depth - 1));
      }
      default: {
        const n = rand(6);
        const o: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) o[randString()] = genValue(depth - 1);
        return o;
      }
    }
  }
  function randString() {
    const chars = 'abc XYZ 012 ,:{}[]"\\\n\t日😀';
    const cps = [...chars];
    const n = rand(12);
    let s = "";
    for (let i = 0; i < n; i++) s += cps[rand(cps.length)];
    return s;
  }

  test("1000 random documents round-trip", () => {
    for (let i = 0; i < 1000; i++) {
      const v = genValue(5);
      const s = JSON.stringify(v);
      const got = parse(s);
      if (JSON.stringify(got) !== s) {
        // Re-assert via expect for a useful diff.
        expect({ input: s, got }).toEqual({ input: s, got: JSON.parse(s) });
      }
    }
  });
});
