import { TOML } from "bun";
import { describe, expect, test } from "bun:test";

// Hand-written coverage beyond the official conformance suite
// (toml-test-suite.test.ts): the JS-facing API surface, JS value mapping,
// Bun-specific input types, and robustness on adversarial inputs.

function syntaxError(input: string | Uint8Array): SyntaxError {
  let err: unknown;
  try {
    TOML.parse(input as string);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  return err as SyntaxError;
}

describe("input types", () => {
  const doc = 'a = 1\n[t]\nb = "x"\n';
  const expected = { a: 1, t: { b: "x" } };

  test("string", () => {
    expect(TOML.parse(doc)).toEqual(expected);
  });

  test("Buffer", () => {
    expect(TOML.parse(Buffer.from(doc))).toEqual(expected);
  });

  test("Uint8Array subarray respects byteOffset and length", () => {
    const padded = Buffer.from("xxx" + doc + "yyy");
    expect(TOML.parse(padded.subarray(3, 3 + doc.length))).toEqual(expected);
  });

  test("DataView", () => {
    const bytes = new TextEncoder().encode(doc);
    expect(TOML.parse(new DataView(bytes.buffer))).toEqual(expected);
  });

  test("ArrayBuffer", () => {
    expect(TOML.parse(new TextEncoder().encode(doc).buffer)).toEqual(expected);
  });

  test("SharedArrayBuffer", () => {
    const bytes = new TextEncoder().encode(doc);
    const sab = new SharedArrayBuffer(bytes.length);
    new Uint8Array(sab).set(bytes);
    expect(TOML.parse(sab)).toEqual(expected);
  });

  test("Blob parses synchronously", () => {
    expect(TOML.parse(new Blob([doc]) as any)).toEqual(expected);
  });

  test("non-string values are coerced via toString", () => {
    expect(TOML.parse({ toString: () => "a = 1" } as any)).toEqual({ a: 1 });
    // A number coerces to a string that is not valid TOML.
    expect(() => TOML.parse(123 as any)).toThrow(SyntaxError);
  });

  test("null and undefined throw", () => {
    expect(() => TOML.parse(null as any)).toThrow();
    expect(() => TOML.parse(undefined as any)).toThrow();
    expect(() => (TOML.parse as any)()).toThrow();
  });

  test("invalid UTF-8 bytes throw SyntaxError", () => {
    expect(syntaxError(new Uint8Array([0x61, 0x20, 0x3d, 0x20, 0xff])).message).toBe(
      "TOML Parse error: Invalid UTF-8 byte sequence",
    );
  });

  test("UTF-8 BOM is skipped in both string and byte input", () => {
    expect(TOML.parse("\uFEFFa = 1")).toEqual({ a: 1 });
    expect(TOML.parse(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x20, 0x3d, 0x20, 0x31]))).toEqual({ a: 1 });
  });
});

describe("JS value mapping", () => {
  test("returns a plain object with Object.prototype", () => {
    const o = TOML.parse("a = 1");
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
  });

  test("__proto__ key becomes an own property, not the prototype", () => {
    const o = TOML.parse('"__proto__" = 1') as any;
    expect(Object.getOwnPropertyNames(o)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(o, "__proto__")!.value).toBe(1);
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });

  test("__proto__ table becomes an own property", () => {
    const o = TOML.parse('["__proto__"]\nx = 1') as any;
    expect(Object.getOwnPropertyDescriptor(o, "__proto__")!.value).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
  });

  test("constructor and prototype keys are plain data properties", () => {
    const o = TOML.parse("constructor = 1\nprototype = 2") as any;
    expect(o.constructor).toBe(1);
    expect(o.prototype).toBe(2);
  });

  test("property order: array-index keys first (JS semantics), then insertion order", () => {
    const o = TOML.parse('b = 1\na = 2\n"2" = 3\n"1" = 4') as any;
    expect(Object.keys(o)).toEqual(["1", "2", "b", "a"]);
  });

  test("unicode keys are preserved without normalization", () => {
    // NFC "é" (U+00E9) and NFD "é" (U+0065 U+0301) are distinct keys.
    const composed = "é";
    const decomposed = "é";
    const o = TOML.parse(`"${composed}" = 1\n"${decomposed}" = 2`) as any;
    expect(o[composed]).toBe(1);
    expect(o[decomposed]).toBe(2);
    expect(Object.keys(o)).toHaveLength(2);
  });

  test("non-ASCII and astral-plane content round-trips", () => {
    const o = TOML.parse('emoji = "🐰🐶"\n"日本語" = "テスト"\nmixed = "aé中🦊"') as any;
    expect(o.emoji).toBe("🐰🐶");
    expect(o["日本語"]).toBe("テスト");
    expect(o.mixed).toBe("aé中🦊");
  });
});

describe("numbers", () => {
  test("safe integer boundaries", () => {
    expect(TOML.parse(`max = 9007199254740991\nmin = -9007199254740991`)).toEqual({
      max: Number.MAX_SAFE_INTEGER,
      min: Number.MIN_SAFE_INTEGER,
    });
    expect(syntaxError("a = 9007199254740992").message).toBe(
      "TOML Parse error: Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
    );
    expect(() => TOML.parse("a = -9007199254740992")).toThrow(SyntaxError);
    // Out of even the 64-bit range.
    expect(syntaxError("a = 99999999999999999999").message).toBe(
      "TOML Parse error: Integer is outside the 64-bit signed range",
    );
  });

  test("radix integers at the safe-range boundary", () => {
    expect(TOML.parse("a = 0x1FFFFFFFFFFFFF")).toEqual({ a: Number.MAX_SAFE_INTEGER });
    expect(() => TOML.parse("a = 0x20000000000000")).toThrow(SyntaxError);
  });

  test("float -0.0 is negative zero; integer -0 is positive zero", () => {
    expect(Object.is((TOML.parse("a = -0.0") as any).a, -0)).toBe(true);
    expect(Object.is((TOML.parse("a = -0") as any).a, 0)).toBe(true);
  });

  test("inf and nan", () => {
    const o = TOML.parse("a = inf\nb = -inf\nc = +inf\nd = nan\ne = -nan\nf = +nan") as any;
    expect(o.a).toBe(Infinity);
    expect(o.b).toBe(-Infinity);
    expect(o.c).toBe(Infinity);
    expect(Number.isNaN(o.d)).toBe(true);
    expect(Number.isNaN(o.e)).toBe(true);
    expect(Number.isNaN(o.f)).toBe(true);
  });

  test("underscores and exponents", () => {
    expect(TOML.parse("a = 1_000_000\nb = 1_2.3_4e1_0\nc = 5e2\nd = 2E-3")).toEqual({
      a: 1000000,
      b: 12.34e10,
      c: 500,
      d: 0.002,
    });
  });

  test("float precision is exact f64", () => {
    const o = TOML.parse("a = 0.1\nb = 3.141592653589793\nc = 5e-324\nd = 1.7976931348623157e308") as any;
    expect(o.a).toBe(0.1);
    expect(o.b).toBe(Math.PI);
    expect(o.c).toBe(Number.MIN_VALUE);
    expect(o.d).toBe(Number.MAX_VALUE);
  });
});

describe("date/times return their source text", () => {
  test("all four kinds", () => {
    const o = TOML.parse(
      ["odt = 1979-05-27T07:32:00Z", "ldt = 1979-05-27T07:32:00", "ld = 1979-05-27", "lt = 07:32:00"].join("\n"),
    ) as any;
    expect(o).toEqual({
      odt: "1979-05-27T07:32:00Z",
      ldt: "1979-05-27T07:32:00",
      ld: "1979-05-27",
      lt: "07:32:00",
    });
    for (const key of ["odt", "ldt", "ld", "lt"]) {
      expect(typeof o[key]).toBe("string");
    }
  });

  test("source spelling is preserved verbatim", () => {
    const o = TOML.parse(
      [
        "lower = 1979-05-27t07:32:00.500z",
        "space = 1979-05-27 07:32:00+13:00",
        "frac = 07:32:00.999999999",
        "noseconds = 07:32",
        "datenoseconds = 1979-05-27T07:32Z",
      ].join("\n"),
    ) as any;
    expect(o.lower).toBe("1979-05-27t07:32:00.500z");
    expect(o.space).toBe("1979-05-27 07:32:00+13:00");
    expect(o.frac).toBe("07:32:00.999999999");
    expect(o.noseconds).toBe("07:32");
    expect(o.datenoseconds).toBe("1979-05-27T07:32Z");
  });

  test("offset date-times feed directly into Date and Temporal-style consumers", () => {
    const odt = (TOML.parse("a = 1979-05-27T00:32:00-07:00") as any).a;
    expect(new Date(odt).getTime()).toBe(296638320000);
  });
});

describe("strings", () => {
  test("all escapes including TOML 1.1 \\x and \\e", () => {
    expect(TOML.parse('a = "\\b\\t\\n\\f\\r\\"\\\\\\e\\x41\\u00e9\\U0001F600"')).toEqual({
      a: '\b\t\n\f\r"\\\x1b\x41é\u{1F600}',
    });
  });

  test("escaped NUL and control characters decode", () => {
    expect((TOML.parse('a = "\\u0000\\u001F"') as any).a).toBe("\u0000\u001F");
  });

  test("multi-line basic: leading newline trim, CRLF normalization, line-ending backslash", () => {
    expect((TOML.parse('a = """\nline1\r\nline2"""') as any).a).toBe("line1\nline2");
    expect((TOML.parse('a = """\\\n   trimmed"""') as any).a).toBe("trimmed");
    expect((TOML.parse('a = """one \\\n\n\n  two"""') as any).a).toBe("one two");
  });

  test("multi-line literal: verbatim except CRLF normalization", () => {
    expect((TOML.parse("a = '''\nC:\\path\\to\\file'''") as any).a).toBe("C:\\path\\to\\file");
    expect((TOML.parse("a = '''x\r\ny'''") as any).a).toBe("x\ny");
  });

  test("quotes adjacent to multi-line delimiters", () => {
    // Open """, two content quotes, x, two content quotes, an escaped quote
    // (consuming one of the trailing five), then a run of four: close + 1.
    expect((TOML.parse('a = """""x""\\"""""') as any).a).toBe('""x""""');
    expect((TOML.parse("a = '''''x'''''") as any).a).toBe("''x''");
  });

  test("single-line literal strings take backslashes verbatim", () => {
    expect((TOML.parse("a = 'C:\\Users\\nodejs\\templates'") as any).a).toBe("C:\\Users\\nodejs\\templates");
  });

  test("lone surrogate escapes are rejected", () => {
    expect(syntaxError('a = "\\uD800"').message).toBe(
      "TOML Parse error: Escaped code point must be a Unicode scalar value",
    );
    expect(() => TOML.parse('a = "\\UFFFFFFFF"')).toThrow(SyntaxError);
  });
});

describe("structure", () => {
  test("the toml.io front-page example", () => {
    const o = TOML.parse(`
title = "TOML Example"

[owner]
name = "Tom Preston-Werner"

[database]
enabled = true
ports = [ 8000, 8001, 8002 ]
data = [ ["delta", "phi"], [3.14] ]
temp_targets = { cpu = 79.5, case = 72.0 }

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"
`);
    expect(o).toEqual({
      title: "TOML Example",
      owner: { name: "Tom Preston-Werner" },
      database: {
        enabled: true,
        ports: [8000, 8001, 8002],
        data: [["delta", "phi"], [3.14]],
        temp_targets: { cpu: 79.5, case: 72.0 },
      },
      servers: {
        alpha: { ip: "10.0.0.1", role: "frontend" },
        beta: { ip: "10.0.0.2", role: "backend" },
      },
    });
  });

  test("TOML 1.1 multi-line inline tables with trailing comma", () => {
    expect(
      TOML.parse(`t = {
  a = 1,
  # comments are allowed here
  b = { c = 2 },
}`),
    ).toEqual({ t: { a: 1, b: { c: 2 } } });
  });

  test("array of tables accumulates in order", () => {
    const o = TOML.parse(`
[[fruit]]
name = "apple"
[fruit.physical]
color = "red"
[[fruit.variety]]
name = "red delicious"
[[fruit.variety]]
name = "granny smith"
[[fruit]]
name = "banana"
`) as any;
    expect(o.fruit).toHaveLength(2);
    expect(o.fruit[0].physical.color).toBe("red");
    expect(o.fruit[0].variety.map((v: any) => v.name)).toEqual(["red delicious", "granny smith"]);
    expect(o.fruit[1]).toEqual({ name: "banana" });
  });

  test("empty and comment-only documents parse to an empty table", () => {
    expect(TOML.parse("")).toEqual({});
    expect(TOML.parse("   \n# just a comment\n\n")).toEqual({});
    expect(TOML.parse(new Uint8Array(0))).toEqual({});
  });

  test("whole-document CRLF line endings", () => {
    expect(TOML.parse('a = 1\r\n[t]\r\nb = "x"\r\n')).toEqual({ a: 1, t: { b: "x" } });
  });
});

describe("robustness", () => {
  // Recursion-overflow depths must hold on every build: release frames are
  // much smaller than debug/ASAN frames, so a depth that overflows locally
  // can parse successfully on a release build. 2M frames exceeds any stack
  // even at tiny frame sizes, while the parses-fine depth of 1000 stays well
  // under the limit even with large sanitizer frames.
  const OVERFLOW_DEPTH = 2_000_000;

  test("deeply nested arrays throw instead of crashing", () => {
    expect(() => TOML.parse("a = " + "[".repeat(OVERFLOW_DEPTH) + "]".repeat(OVERFLOW_DEPTH))).toThrow(RangeError);
  });

  test("deeply nested inline tables throw instead of crashing", () => {
    expect(() => TOML.parse("a = " + "{ b = ".repeat(OVERFLOW_DEPTH) + "1" + " }".repeat(OVERFLOW_DEPTH))).toThrow(
      RangeError,
    );
  });

  test("deep dotted keys parse beyond the old 512-segment cap", () => {
    const depth = 1000;
    const o = TOML.parse(Array(depth).fill("a").join(".") + " = 1");
    let cur: any = o;
    for (let i = 0; i < depth - 1; i++) cur = cur.a;
    expect(cur).toEqual({ a: 1 });
  });

  test("extremely deep dotted keys and headers throw instead of crashing", () => {
    // Parsing these is iterative (every segment is processed before the limit
    // can trip), so unlike OVERFLOW_DEPTH this depth is paid in full: it must
    // stay small enough to be fast in debug builds while still overflowing
    // the JS-conversion recursion at release frame sizes.
    const path = Array(250_000).fill("a").join(".");
    expect(() => TOML.parse(path + " = 1")).toThrow(RangeError);
    expect(() => TOML.parse(`[${path}]`)).toThrow(RangeError);
  });

  test("a very long string value round-trips", () => {
    const long = Buffer.alloc(1 << 20, "x").toString();
    expect((TOML.parse(`a = "${long}"`) as any).a).toBe(long);
  });

  test("a table with many keys preserves every entry", () => {
    const n = 1000;
    let doc = "";
    for (let i = 0; i < n; i++) doc += `key_${i} = ${i}\n`;
    const o = TOML.parse(doc) as any;
    expect(Object.keys(o)).toHaveLength(n);
    expect(o.key_0).toBe(0);
    expect(o[`key_${n - 1}`]).toBe(n - 1);
  });

  test("values survive garbage collection", () => {
    const doc = 'a = "héllo wörld 🌍"\nb = [1, 2.5, true, "x"]\n[t]\nc = 1979-05-27\n';
    const results: unknown[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(TOML.parse(doc));
    }
    Bun.gc(true);
    for (const o of results) {
      expect(o).toEqual({ a: "héllo wörld 🌍", b: [1, 2.5, true, "x"], t: { c: "1979-05-27" } });
    }
  });
});

describe("error contract", () => {
  test("errors are SyntaxError instances with the TOML Parse error prefix", () => {
    const err = syntaxError("a = = =");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SyntaxError");
    expect(err.message).toStartWith("TOML Parse error: ");
  });

  test("end-of-file errors name the end of file", () => {
    expect(syntaxError("a").message).toBe("TOML Parse error: Expected '=' after a key but found end of file");
    expect(syntaxError("[a").message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found end of file",
    );
  });

  test("common mistakes produce specific messages", () => {
    expect(syntaxError("a = 1\na = 2").message).toBe("TOML Parse error: Cannot redefine key 'a'");
    expect(syntaxError("[a]\n[a]").message).toBe("TOML Parse error: Cannot redefine table 'a'");
    expect(syntaxError("a = 01").message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
    expect(syntaxError("a = 1_").message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
    expect(syntaxError('a = "x" y = 2').message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });
});
