import { TOML } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Hand-written coverage beyond the official conformance suite
// (toml-test-suite.test.ts): the JS-facing API surface, JS value mapping,
// Bun-specific input types, and robustness on adversarial inputs.

function syntaxError(input: string | Uint8Array): SyntaxError {
  let err: unknown;
  try {
    TOML.parse(input);
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
    const padded = Buffer.from("<<<" + doc + ">>>");
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
    expect(TOML.parse(new Blob([doc]))).toEqual(expected);
  });

  test("DataView over a SharedArrayBuffer", () => {
    const bytes = new TextEncoder().encode(doc);
    const sab = new SharedArrayBuffer(bytes.length);
    new Uint8Array(sab).set(bytes);
    expect(TOML.parse(new DataView(sab))).toEqual(expected);
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

  test("lone surrogates: replaced in string input (USVString), rejected in byte input", () => {
    // A JS string is converted to UTF-8 before parsing, so unpaired
    // surrogates become U+FFFD (the same semantics as TextEncoder and the
    // YAML/JSON5 siblings). The same content as bytes is ill-formed UTF-8
    // and must be rejected.
    expect(TOML.parse('a = "\uD800"')).toEqual({ a: "�" });
    const encodedSurrogate = new Uint8Array([0x61, 0x20, 0x3d, 0x20, 0x22, 0xed, 0xa0, 0x80, 0x22]);
    expect(syntaxError(encodedSurrogate).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
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
    // A table under "__proto__" must not pollute Object.prototype.
    const p = TOML.parse('"__proto__" = { polluted = true }') as any;
    expect(Object.getOwnPropertyDescriptor(p, "__proto__")!.value).toEqual({ polluted: true });
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

  test("digit-only bare keys are strings regardless of magnitude", () => {
    // Keys are always strings; the integer range rules never apply to them.
    // Tables keyed by snowflake IDs are the realistic shape of this.
    expect(TOML.parse("9007199254740993 = 1")).toEqual({ "9007199254740993": 1 });
    expect(TOML.parse("[175928847299117063]\nk = 1")).toEqual({ "175928847299117063": { k: 1 } });
    expect(TOML.parse("t = { 99999999999999999999 = 1 }")).toEqual({ t: { "99999999999999999999": 1 } });
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

  test("the 64-bit boundary picks the right diagnostic", () => {
    // i64::MIN is inside the 64-bit signed range, so it gets the lossless
    // message; one further is genuinely outside the 64-bit range.
    expect(syntaxError("a = -9223372036854775808").message).toBe(
      "TOML Parse error: Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
    );
    expect(syntaxError("a = 9223372036854775807").message).toBe(
      "TOML Parse error: Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
    );
    expect(syntaxError("a = -9223372036854775809").message).toBe(
      "TOML Parse error: Integer is outside the 64-bit signed range",
    );
    expect(syntaxError("a = 9223372036854775808").message).toBe(
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

describe("date/times return Temporal objects", () => {
  test("all four kinds map to their Temporal type", () => {
    const o = TOML.parse(
      ["odt = 1979-05-27T07:32:00Z", "ldt = 1979-05-27T07:32:00", "ld = 1979-05-27", "lt = 07:32:00"].join("\n"),
    ) as any;
    expect(o.odt).toBeInstanceOf(Temporal.Instant);
    expect(o.ldt).toBeInstanceOf(Temporal.PlainDateTime);
    expect(o.ld).toBeInstanceOf(Temporal.PlainDate);
    expect(o.lt).toBeInstanceOf(Temporal.PlainTime);
    expect(o.odt.toString()).toBe("1979-05-27T07:32:00Z");
    expect(o.ldt.toString()).toBe("1979-05-27T07:32:00");
    expect(o.ld.toString()).toBe("1979-05-27");
    expect(o.lt.toString()).toBe("07:32:00");
  });

  test("an offset date-time specifies an instant; the written offset normalizes away", () => {
    const o = TOML.parse("a = 1979-05-27T00:32:00-07:00\nb = 1979-05-27T07:32:00Z") as any;
    expect(o.a.epochMilliseconds).toBe(296638320000);
    expect(o.a.toString()).toBe("1979-05-27T07:32:00Z");
    expect(o.a.equals(o.b)).toBe(true);
  });

  test("TOML spellings Temporal does not print survive losslessly", () => {
    const o = TOML.parse(
      [
        "lower = 1979-05-27t07:32:00.500z",
        "space = 1979-05-27 07:32:00+13:00",
        "frac = 07:32:00.999999999",
        "noseconds = 07:32",
        "datenoseconds = 1979-05-27T07:32Z",
        "leap = 1990-12-31T23:59:60Z", // RFC 3339 leap second; Temporal clamps to :59
      ].join("\n"),
    ) as any;
    expect(o.lower.toString()).toBe("1979-05-27T07:32:00.5Z");
    expect(o.space.toString()).toBe("1979-05-26T18:32:00Z");
    expect(o.frac.toString()).toBe("07:32:00.999999999");
    expect(o.noseconds.toString()).toBe("07:32:00");
    expect(o.datenoseconds.toString()).toBe("1979-05-27T07:32:00Z");
    expect(o.leap.toString()).toBe("1990-12-31T23:59:59Z");
  });

  test("fractional seconds past Temporal's 9 digits are truncated, not rounded", () => {
    // TOML: "excess precision should be truncated, not rounded".
    const o = TOML.parse("a = 07:32:00.123456789999\nb = 1979-05-27T07:32:00.999999999999Z") as any;
    expect(o.a.toString()).toBe("07:32:00.123456789");
    expect(o.b.toString()).toBe("1979-05-27T07:32:00.999999999Z");
  });

  test("date/times nest in arrays and inline tables", () => {
    const o = TOML.parse("arr = [ 1979-05-27, 07:32:00 ]\ntbl = { d = 1979-05-27T07:32:00 }") as any;
    expect(o.arr[0]).toBeInstanceOf(Temporal.PlainDate);
    expect(o.arr[1]).toBeInstanceOf(Temporal.PlainTime);
    expect(o.tbl.d).toBeInstanceOf(Temporal.PlainDateTime);
  });

  test("parse throws when Temporal is disabled", async () => {
    // The Temporal mapping cannot exist without Temporal; a date/time value
    // is then an error rather than a silently different type.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try { Bun.TOML.parse("a = 1979-05-27"); console.log("no error"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }` +
          `console.log(JSON.stringify(Bun.TOML.parse("b = 'still works'")));`,
      ],
      env: { ...bunEnv, BUN_JSC_useTemporal: "0" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      'TypeError: Date/time values require Temporal, which is disabled in this process\n{"b":"still works"}\n',
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("deep dotted headers bundle without crashing", async () => {
    // Dotted headers nest objects beyond safe recursion depth (the TOML
    // parser builds them iteratively); the bundler's date/time lowering and
    // the transform path's scan walk the tree iteratively too. A clean
    // bundler error is acceptable; death by stack overflow is not.
    using dir = tempDir("toml-deep-header", {
      "deep.toml": "[" + Buffer.alloc(200_000, "a.").toString() + "a]\nd = 1979-05-27\n",
    });
    const entry = join(String(dir), "deep.toml");
    for (const args of [
      ["build", entry],
      ["build", "--no-bundle", entry],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      // Drain stderr concurrently so the child cannot block on a full pipe.
      // Exit 0 is today's behavior and a clean diagnostic exit would also be
      // fine; death by signal (stack overflow) is neither.
      const [exitCode] = await Promise.all([proc.exited, proc.stderr.text()]);
      expect([0, 1]).toContain(exitCode);
    }
  });

  test("importing a TOML module with date/times throws when Temporal is disabled", async () => {
    // The import path converts the same way; the load must fail with the
    // TypeError, not crash.
    using dir = tempDir("toml-dates-no-temporal", {
      "config.toml": "a = 1979-05-27\n",
      "index.ts": `try { await import("./config.toml"); console.log("no error"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_JSC_useTemporal: "0" },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("TypeError: Date/time values require Temporal, which is disabled in this process\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

  test("CRLF in a single-line string gets the newline diagnostic, not the bare-CR one", () => {
    expect(syntaxError('a = "x\r\ny"').message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
    expect(syntaxError("a = 'x\r\ny'").message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
    // A genuinely bare CR keeps its own message.
    expect(syntaxError('a = "x\ry"').message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
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

  test("newlines and comments are not allowed between '=' and the value in inline tables", () => {
    // keyval-sep is `ws %x3D ws`: ws-comment-newline is permitted around
    // keyvals and commas, but never between '=' and the value.
    expect(syntaxError("t = { a =\n1 }").message).toBe(
      "TOML Parse error: Missing value after '='; values must be on the same line",
    );
    expect(syntaxError("t = { a = # c\n1 }").message).toBe("TOML Parse error: Expected a value but found '#'");
    // A newline between the key and '=' is rejected for the same reason.
    expect(() => TOML.parse("t = { a\n= 1 }")).toThrow(SyntaxError);
    // The allowed positions (around keyvals and commas) still work.
    expect(TOML.parse("t = {\na = 1\n,\nb = 2\n}")).toEqual({ t: { a: 1, b: 2 } });
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
    const open = Buffer.alloc(OVERFLOW_DEPTH, "[").toString();
    const close = Buffer.alloc(OVERFLOW_DEPTH, "]").toString();
    expect(() => TOML.parse("a = " + open + close)).toThrow(RangeError);
  });

  test("deeply nested inline tables throw instead of crashing", () => {
    const open = Buffer.alloc(OVERFLOW_DEPTH * 6, "{ b = ").toString();
    const close = Buffer.alloc(OVERFLOW_DEPTH * 2, " }").toString();
    expect(() => TOML.parse("a = " + open + "1" + close)).toThrow(RangeError);
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
    // the JS-conversion recursion at release frame sizes. The two parses
    // take ~7s under debug+ASAN on slow machines, past the 5s default.
    const depth = 250_000;
    const path = Buffer.alloc(depth * 2 - 1, "a.").toString();
    expect(() => TOML.parse(path + " = 1")).toThrow(RangeError);
    expect(() => TOML.parse(`[${path}]`)).toThrow(RangeError);
  }, 60_000);

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
    const results: any[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(TOML.parse(doc));
    }
    Bun.gc(true);
    for (const o of results) {
      expect(o).toEqual({ a: "héllo wörld 🌍", b: [1, 2.5, true, "x"], t: { c: expect.anything() } });
      expect(o.t.c).toBeInstanceOf(Temporal.PlainDate);
      expect(o.t.c.toString()).toBe("1979-05-27");
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

  test("array-of-tables errors name the right header kind", () => {
    expect(syntaxError("[[a").message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found end of file",
    );
    expect(syntaxError("a = 1\n[[a]]").message).toBe("TOML Parse error: Cannot redefine key 'a' as an array of tables");
    // For a non-last segment the table wording is the correct one.
    expect(syntaxError("a = 1\n[[a.b]]").message).toBe("TOML Parse error: Cannot redefine key 'a' as a table");
    expect(syntaxError("a = 1\n[a]").message).toBe("TOML Parse error: Cannot redefine key 'a' as a table");
  });

  test("unquoted string values name the fix", () => {
    // The old parser silently accepted bare words as strings; this is the
    // most common spec violation in real-world bunfig.toml files.
    expect(syntaxError("linker = isolated").message).toBe('TOML Parse error: Strings must be quoted: "isolated"');
    expect(syntaxError("a = tru").message).toBe('TOML Parse error: Strings must be quoted: "tru"');
    expect(syntaxError("a = nope").message).toBe('TOML Parse error: Strings must be quoted: "nope"');
    // Bare words that merely start with inf/nan are unquoted strings too.
    expect(syntaxError("timeout = infinity").message).toBe('TOML Parse error: Strings must be quoted: "infinity"');
    expect(syntaxError("unit = nanoseconds").message).toBe('TOML Parse error: Strings must be quoted: "nanoseconds"');
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

describe("TOML.stringify", () => {
  function stringifyError(value: unknown): Error {
    let err: unknown;
    try {
      TOML.stringify(value);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    return err as Error;
  }

  test("layout: keyvals first, then tables, then arrays of tables", () => {
    expect(
      TOML.stringify({
        server: { host: "localhost", port: 8080 },
        name: "app",
        points: [{ x: 1 }, { x: 2 }],
        debug: true,
      }),
    ).toBe(
      'name = "app"\ndebug = true\n\n[server]\nhost = "localhost"\nport = 8080\n\n[[points]]\nx = 1\n\n[[points]]\nx = 2\n',
    );
  });

  test("nested tables emit dotted headers", () => {
    expect(TOML.stringify({ a: { x: 1, b: { c: 2 } } })).toBe("[a]\nx = 1\n\n[a.b]\nc = 2\n");
  });

  test("super-tables with no keyvals of their own are implied, not written", () => {
    // toml-rs, tomli_w, tomlkit, smol-toml and @iarna/toml all omit the
    // pass-through headers; `[a.b]` alone implies `[a]`.
    expect(TOML.stringify({ a: { b: { c: 1 } } })).toBe("[a.b]\nc = 1\n");
    expect(TOML.stringify({ t: { arr: [{ q: 1 }] } })).toBe("[[t.arr]]\nq = 1\n");
    expect(TOML.stringify({ x: 1, a: { b: { c: 1 } } })).toBe("x = 1\n\n[a.b]\nc = 1\n");
    // Skipped (undefined/function/symbol) properties are not keyvals.
    expect(TOML.stringify({ a: { u: undefined, b: { c: 1 } } })).toBe("[a.b]\nc = 1\n");
    // A nested empty table still needs the one header that materializes it.
    expect(TOML.stringify({ a: { b: {} } })).toBe("[a.b]\n");
    expect(TOML.stringify({ a: { b: {}, c: {} } })).toBe("[a.b]\n\n[a.c]\n");
    // An array-of-tables element header always appears (each one creates the
    // element), even when the element body itself starts with a sub-table.
    expect(TOML.stringify({ arr: [{ sub: { x: 1 } }] })).toBe("[[arr]]\n\n[arr.sub]\nx = 1\n");
  });

  test("pyproject/Cargo-shaped documents round-trip without gaining headers", () => {
    const doc =
      '[tool.poetry]\nname = "pkg"\n\n[tool.ruff.lint]\nselect = ["E"]\n\n[profile.release.package.foo]\nopt-level = 3\n';
    expect(TOML.stringify(TOML.parse(doc))).toBe(doc);
  });

  test("round-trips through TOML.parse", () => {
    const value = {
      title: "example",
      count: 42,
      pi: 3.14,
      on: true,
      off: false,
      list: [1, "two", [3.5], { four: 4 }],
      empty: [],
      nested: { deep: { key: "value" } },
      multi: 'line one\nline two\t"quoted"',
    };
    expect(TOML.parse(TOML.stringify(value))).toEqual(value);
  });

  test("keys: bare when possible, quoted otherwise", () => {
    expect(TOML.stringify({ bare_key: 1, "key with space": 2, ключ: 3, "": 4, "a.b": 5 })).toBe(
      'bare_key = 1\n"key with space" = 2\n"ключ" = 3\n"" = 4\n"a.b" = 5\n',
    );
    expect(TOML.stringify({ t: { "dotted.seg": 1 } })).toBe('[t]\n"dotted.seg" = 1\n');
    expect(TOML.stringify({ "dotted.tbl": { a: 1 } })).toBe('["dotted.tbl"]\na = 1\n');
  });

  test("string escaping is exact and round-trips", () => {
    expect(TOML.stringify({ s: 'a"b\\c\nd\te\u0000f' })).toBe('s = "a\\"b\\\\c\\nd\\te\\u0000f"\n');
    const original = { s: '\b\t\n\f\r"\\中🦊' };
    expect(TOML.parse(TOML.stringify(original))).toEqual(original);
  });

  test("lone surrogates are replaced with U+FFFD like the parse boundary", () => {
    expect(TOML.stringify({ s: "a\uD800b" })).toBe('s = "a�b"\n');
    // A well-formed pair passes through.
    expect(TOML.stringify({ s: "🦊" })).toBe('s = "🦊"\n');
  });

  test("numbers: integers, floats, special values", () => {
    expect(TOML.stringify({ i: 5, f: 0.5, nz: -0.0, n: NaN, p: Infinity, m: -Infinity })).toBe(
      "i = 5\nf = 0.5\nnz = -0.0\nn = nan\np = inf\nm = -inf\n",
    );
    expect(TOML.stringify({ max: Number.MAX_SAFE_INTEGER })).toBe("max = 9007199254740991\n");
    // A double-encoded +0 (not an int32-tagged value) must not gain a sign.
    expect(TOML.stringify({ z: new Float64Array(1)[0] })).toBe("z = 0\n");
    expect(Object.is(TOML.parse(TOML.stringify({ z: new Float64Array(1)[0] })).z, 0)).toBe(true);
  });

  test("integral doubles beyond the safe range are emitted as floats", () => {
    // Bare digits would round-trip as an out-of-range TOML integer.
    expect(TOML.stringify({ big: 1e20 })).toBe("big = 100000000000000000000.0\n");
    expect(TOML.parse(TOML.stringify({ big: 1e20 }))).toEqual({ big: 1e20 });
    expect(TOML.parse(TOML.stringify({ big: 1e21 }))).toEqual({ big: 1e21 });
  });

  test("Date becomes a TOML offset date-time", () => {
    const d = new Date(Date.UTC(1979, 4, 27, 7, 32, 0, 999));
    expect(TOML.stringify({ d })).toBe("d = 1979-05-27T07:32:00.999Z\n");
    // It reads back as the Temporal.Instant of the same moment.
    expect(TOML.parse(TOML.stringify({ d })).d.epochMilliseconds).toBe(d.getTime());
    // Fraction uses auto precision (trailing zeros trimmed), so a Date and a
    // Temporal.Instant spell the same instant identically.
    expect(TOML.stringify({ d: new Date(0) })).toBe("d = 1970-01-01T00:00:00Z\n");
    expect(TOML.stringify({ d: new Date(500) })).toBe("d = 1970-01-01T00:00:00.5Z\n");
    expect(TOML.stringify({ a: new Date(0), b: Temporal.Instant.fromEpochMilliseconds(0) })).toBe(
      "a = 1970-01-01T00:00:00Z\nb = 1970-01-01T00:00:00Z\n",
    );
    // The 4-digit-year bounds (`Date.UTC(0, ...)` remaps year 0 to 1900, so raw ms).
    expect(TOML.stringify({ d: new Date(-62167219200000) })).toBe("d = 0000-01-01T00:00:00Z\n");
    expect(TOML.stringify({ d: new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999)) })).toBe(
      "d = 9999-12-31T23:59:59.999Z\n",
    );
  });

  test("invalid and unrepresentable Dates throw", () => {
    expect(stringifyError({ d: new Date(NaN) }).message).toBe("TOML.stringify cannot serialize an invalid Date");
    // One millisecond before year 0000, and the first instant of year 10000.
    expect(stringifyError({ d: new Date(-62167219200001) }).message).toBe(
      "TOML.stringify cannot serialize a Date outside years 0000-9999",
    );
    expect(stringifyError({ d: new Date(Date.UTC(10000, 0, 1)) }).message).toBe(
      "TOML.stringify cannot serialize a Date outside years 0000-9999",
    );
  });

  test("the four Temporal date/time types become unquoted TOML literals", () => {
    expect(
      TOML.stringify({
        odt: Temporal.Instant.from("1979-05-27T00:32:00-07:00"),
        ldt: Temporal.PlainDateTime.from("1979-05-27T07:32:00"),
        ld: Temporal.PlainDate.from("1979-05-27"),
        lt: Temporal.PlainTime.from("07:32:00"),
      }),
    ).toBe(
      [
        "odt = 1979-05-27T07:32:00Z", // an Instant prints in UTC
        "ldt = 1979-05-27T07:32:00",
        "ld = 1979-05-27",
        "lt = 07:32:00",
      ].join("\n") + "\n",
    );
  });

  test("Temporal values keep sub-second precision with trailing zeros trimmed", () => {
    expect(
      TOML.stringify({
        half: Temporal.Instant.from("1979-05-27T07:32:00.500Z"),
        nanos: Temporal.PlainTime.from("07:32:00.123456789"),
      }),
    ).toBe("half = 1979-05-27T07:32:00.5Z\nnanos = 07:32:00.123456789\n");
  });

  test("ZonedDateTime emits its offset and drops the time-zone annotation", () => {
    const zdt = Temporal.ZonedDateTime.from("2024-06-15T12:34:56+02:00[Europe/Berlin]");
    expect(TOML.stringify({ zdt })).toBe("zdt = 2024-06-15T12:34:56+02:00\n");
    // The same instant comes back, as an Instant.
    expect(TOML.parse(TOML.stringify({ zdt })).zdt.equals(zdt.toInstant())).toBe(true);
  });

  test("a ZonedDateTime with a sub-minute offset falls back to the UTC instant form", () => {
    // Pre-standard-time zones use LMT: Europe/Berlin in 1800 is +00:53:28,
    // which TOML's HH:MM offset grammar cannot carry.
    const zdt = Temporal.ZonedDateTime.from("1800-01-01T00:00[Europe/Berlin]");
    expect(zdt.offsetNanoseconds % 60_000_000_000).not.toBe(0);
    expect(TOML.stringify({ zdt })).toBe(`zdt = ${zdt.toInstant().toString()}\n`);
    expect(TOML.parse(TOML.stringify({ zdt })).zdt.equals(zdt.toInstant())).toBe(true);
  });

  test("a non-ISO calendar date emits its ISO fields without the calendar annotation", () => {
    const hebrew = Temporal.PlainDate.from("2024-01-01[u-ca=hebrew]");
    expect(hebrew.toString()).toBe("2024-01-01[u-ca=hebrew]"); // what TOML cannot carry
    expect(TOML.stringify({ d: hebrew })).toBe("d = 2024-01-01\n");
  });

  test("Temporal values in arrays stay inline instead of becoming [[table]] sections", () => {
    expect(TOML.stringify({ a: [Temporal.PlainDate.from("1979-05-27"), Temporal.PlainTime.from("07:32:00")] })).toBe(
      "a = [1979-05-27, 07:32:00]\n",
    );
  });

  test("Temporal types with no TOML representation throw", () => {
    expect(stringifyError({ x: Temporal.PlainYearMonth.from("2024-01") }).message).toBe(
      "TOML.stringify cannot serialize Temporal.PlainYearMonth (it has no TOML representation)",
    );
    expect(stringifyError({ x: Temporal.PlainMonthDay.from("01-01") }).message).toBe(
      "TOML.stringify cannot serialize Temporal.PlainMonthDay (it has no TOML representation)",
    );
    expect(stringifyError({ x: Temporal.Duration.from("PT1H") }).message).toBe(
      "TOML.stringify cannot serialize Temporal.Duration (it has no TOML representation)",
    );
  });

  test("Temporal values outside years 0000-9999 throw like Date does", () => {
    expect(stringifyError({ d: Temporal.PlainDate.from({ year: 10000, month: 1, day: 1 }) }).message).toBe(
      "TOML.stringify cannot serialize a Temporal.PlainDate outside years 0000-9999",
    );
    expect(stringifyError({ d: Temporal.PlainDate.from({ year: -1, month: 12, day: 31 }) }).message).toBe(
      "TOML.stringify cannot serialize a Temporal.PlainDate outside years 0000-9999",
    );
    // An instant a day or more outside the range has no `±HH:MM` spelling with a 4-digit year.
    expect(stringifyError({ i: Temporal.Instant.from("+010000-01-02T00:00:00Z") }).message).toBe(
      "TOML.stringify cannot serialize a Temporal.Instant outside years 0000-9999",
    );
    expect(stringifyError({ i: Temporal.Instant.from("-000001-12-31T00:00:00Z") }).message).toBe(
      "TOML.stringify cannot serialize a Temporal.Instant outside years 0000-9999",
    );
    // The boundary years themselves are fine.
    expect(TOML.stringify({ d: Temporal.PlainDate.from("0000-01-01") })).toBe("d = 0000-01-01\n");
    expect(TOML.stringify({ d: Temporal.PlainDate.from("9999-12-31") })).toBe("d = 9999-12-31\n");
  });

  test("an instant whose UTC year is outside 0000-9999 is spelled with an offset that keeps the year in range", () => {
    // These are what `TOML.parse` produces for valid offset date-times at the
    // year edges; the same instant must stringify, and to the same nanosecond.
    const cases: [string, string][] = [
      ["0000-01-01T00:00:00+01:00", "0000-01-01T00:00:00+01:00"],
      ["0000-01-01T00:20:00.5+01:00", "0000-01-01T00:20:00.5+01:00"],
      ["0000-01-01T00:00:00+23:59", "0000-01-01T00:00:00+23:59"],
      ["0000-01-01T00:00:30+23:59", "0000-01-01T00:00:30+23:59"],
      ["9999-12-31T23:30:00-01:00", "9999-12-31T23:30:00-01:00"],
      ["9999-12-31T23:59:59.999999999-23:59", "9999-12-31T23:59:59.999999999-23:59"],
      // In range as UTC: `Z` is preferred over the written offset.
      ["0000-01-01T01:00:00+01:00", "0000-01-01T00:00:00Z"],
      ["9999-12-31T23:59:59.999999999+00:00", "9999-12-31T23:59:59.999999999Z"],
    ];
    for (const [source, printed] of cases) {
      const i = TOML.parse(`i = ${source}`).i as Temporal.Instant;
      expect(TOML.stringify({ i })).toBe(`i = ${printed}\n`);
      expect((TOML.parse(`i = ${printed}`).i as Temporal.Instant).epochNanoseconds).toBe(i.epochNanoseconds);
    }
    // A ZonedDateTime keeps its own offset when that spelling fits, else the same rule applies.
    const zdt = Temporal.Instant.from("+010000-01-01T00:00:00Z").toZonedDateTimeISO("+02:00");
    expect(TOML.stringify({ zdt })).toBe("zdt = 9999-12-31T23:00:00-01:00\n");
    expect((TOML.parse(TOML.stringify({ zdt })).zdt as Temporal.Instant).epochNanoseconds).toBe(zdt.epochNanoseconds);
  });

  test("null values throw with the offending key", () => {
    expect(stringifyError({ a: { broken: null } }).message).toBe(
      "TOML cannot represent null (key 'broken'); remove the key or use a sentinel value",
    );
    expect(stringifyError({ list: [1, null] }).message).toBe("TOML cannot represent null in an array");
    expect(stringifyError({ list: [1, undefined] }).message).toBe("TOML cannot represent undefined in an array");
  });

  test("BigInt throws like the YAML and JSON5 siblings", () => {
    expect(stringifyError({ n: 1n }).message).toBe("TOML.stringify cannot serialize BigInt");
  });

  test("circular structures throw", () => {
    const cycle: any = { a: 1 };
    cycle.self = cycle;
    expect(stringifyError(cycle).message).toBe("Converting circular structure to TOML");
    const arrCycle: any = { list: [] };
    arrCycle.list.push(arrCycle.list);
    expect(stringifyError(arrCycle).message).toBe("Converting circular structure to TOML");
  });

  test("top level must be a plain object", () => {
    const msg = "TOML.stringify expects an object at the top level (a TOML document is a table)";
    expect(stringifyError([1, 2]).message).toBe(msg);
    expect(stringifyError(null).message).toBe(msg);
    expect(stringifyError("str").message).toBe(msg);
    expect(stringifyError(5).message).toBe(msg);
    expect(stringifyError(new Date(0)).message).toBe(msg);
    expect(stringifyError(Temporal.PlainDate.from("1979-05-27")).message).toBe(msg);
    expect(TOML.stringify(undefined)).toBeUndefined();
  });

  test("space is accepted and ignored", () => {
    expect(TOML.stringify({ a: { b: 1 } }, null, 2)).toBe("[a]\nb = 1\n");
    expect(TOML.stringify({ a: { b: 1 } }, null, "\t")).toBe("[a]\nb = 1\n");
  });

  // The replacer protocol (keys, holders, call order, how the list is read) is
  // shared with JSON5.stringify and covered in json5.test.ts. These tests
  // cover what is specific to the TOML output.
  describe("replacer", () => {
    test("a function replaces values in keyvals, tables, arrays and arrays of tables", () => {
      const input = {
        name: "app",
        id: 7n,
        server: { port: 8080n, secret: "s" },
        points: [{ x: 1n, secret: "s" }, { x: 2n }],
      };
      const snapshot = structuredClone(input);
      const calls: [string, boolean][] = [];
      const replacer = function (this: unknown, key: string, value: unknown) {
        calls.push([key, Array.isArray(this)]);
        if (key === "secret") return undefined;
        return typeof value === "bigint" ? Number(value) : value;
      };
      expect(TOML.stringify(input, replacer)).toBe(
        'name = "app"\nid = 7\n\n[server]\nport = 8080\n\n[[points]]\nx = 1\n\n[[points]]\nx = 2\n',
      );
      expect(input).toEqual(snapshot);
      // Once per property, in property order. An array element comes with its index, and the array is the holder.
      expect(calls).toEqual([
        ["", false],
        ["name", false],
        ["id", false],
        ["server", false],
        ["port", false],
        ["secret", false],
        ["points", false],
        ["0", true],
        ["x", false],
        ["secret", false],
        ["1", true],
        ["x", false],
      ]);
    });

    test("Date and Temporal values the replacer returns are still written as date/times", () => {
      const input = {
        date: new Date(0),
        day: Temporal.PlainDate.from("1979-05-27"),
        list: [Temporal.PlainTime.from("07:32:00")],
      };
      const keep = (key: string, value: unknown) => value;
      expect(TOML.stringify(input, keep)).toBe(TOML.stringify(input));
      expect(TOML.stringify(input, keep)).toBe("date = 1970-01-01T00:00:00Z\nday = 1979-05-27\nlist = [07:32:00]\n");
      expect(TOML.stringify(input, ["date", "day"])).toBe("date = 1970-01-01T00:00:00Z\nday = 1979-05-27\n");
      expect(TOML.stringify(input, (key, value) => (value instanceof Date ? value.getTime() : value))).toBe(
        "date = 0\nday = 1979-05-27\nlist = [07:32:00]\n",
      );
    });

    test("the layout follows the replaced values", () => {
      const points = { points: [{ id: 1 }, { id: 2 }] };
      expect(TOML.stringify(points)).toBe("[[points]]\nid = 1\n\n[[points]]\nid = 2\n");
      expect(
        TOML.stringify(points, (key, value: any) =>
          key !== "" && typeof value === "object" && "id" in value ? `#${value.id}` : value,
        ),
      ).toBe('points = ["#1", "#2"]\n');

      const names = { names: ["a", "b"] };
      expect(TOML.stringify(names)).toBe('names = ["a", "b"]\n');
      expect(TOML.stringify(names, (key, value) => (/^\d+$/.test(key) ? { name: value } : value))).toBe(
        '[[names]]\nname = "a"\n\n[[names]]\nname = "b"\n',
      );
    });

    test("replaced values follow the same rules as written values", () => {
      const toNull = (key: string, value: unknown) => (key === "a" ? null : value);
      expect(() => TOML.stringify({ a: 1 }, toNull)).toThrow(
        "TOML cannot represent null (key 'a'); remove the key or use a sentinel value",
      );
      expect(TOML.stringify({ a: 1, b: 2 }, (key, value) => (key === "a" ? undefined : value))).toBe("b = 2\n");
      expect(() => TOML.stringify({ list: [1, 2] }, (key, value) => (key === "0" ? undefined : value))).toThrow(
        "TOML cannot represent undefined in an array",
      );
      expect(() => TOML.stringify({ n: 1 }, (key, value) => (key === "n" ? 1n : value))).toThrow(
        "TOML.stringify cannot serialize BigInt",
      );
      const cyclic: any = { a: 1 };
      cyclic.self = cyclic;
      expect(() => TOML.stringify(cyclic, (key, value) => value)).toThrow("Converting circular structure to TOML");
      expect(TOML.stringify(cyclic, (key, value) => (key === "self" ? "(cycle)" : value))).toBe(
        'a = 1\nself = "(cycle)"\n',
      );
    });

    test("the root goes through the replacer and must still come out as a table", () => {
      expect(TOML.stringify(5, (key, value) => (key === "" ? { value } : value))).toBe("value = 5\n");
      expect(() => TOML.stringify({ a: 1 }, () => 5)).toThrow(
        "TOML.stringify expects an object at the top level (a TOML document is a table)",
      );
      expect(TOML.stringify({ a: 1 }, () => undefined)).toBeUndefined();
    });

    test("an array lists the keys to write in every table: root, sub-tables, inline tables and arrays of tables", () => {
      const input = {
        secret: "s",
        name: "app",
        server: { secret: "s", host: "h", tls: { secret: "s", cert: "c" } },
        points: [{ secret: "s", id: 1 }],
        mixed: [1, { secret: "s", id: 2 }],
      };
      expect(TOML.stringify(input, ["name", "server", "host", "tls", "cert", "points", "mixed", "id"])).toBe(
        'name = "app"\nmixed = [1, { id = 2 }]\n\n[server]\nhost = "h"\n\n[server.tls]\ncert = "c"\n\n[[points]]\nid = 1\n',
      );
    });

    test("an array decides the order of the keyvals and of the tables", () => {
      const input = { a: 1, b: 2, t1: { x: 1 }, t2: { x: 2 } };
      expect(TOML.stringify(input, ["b", "t2", "a", "t1", "x"])).toBe("b = 2\na = 1\n\n[t2]\nx = 2\n\n[t1]\nx = 1\n");
      expect(TOML.stringify(input, [])).toBe("");
    });

    test("a replacer that is neither callable nor an array is ignored, as JSON.stringify ignores it", () => {
      for (const replacer of [undefined, null, "a", 1, true, { 0: "a", length: 1 }]) {
        expect(TOML.stringify({ a: 1, b: 2 }, replacer as any)).toBe("a = 1\nb = 2\n");
      }
    });
  });

  test("undefined, function, and symbol properties are skipped", () => {
    expect(TOML.stringify({ a: 1, u: undefined, f: () => 1, s: Symbol("x") })).toBe("a = 1\n");
  });

  test("empty shapes", () => {
    expect(TOML.stringify({})).toBe("");
    expect(TOML.stringify({ t: {} })).toBe("[t]\n");
    expect(TOML.stringify({ a: [] })).toBe("a = []\n");
    expect(TOML.stringify({ a: [{}] })).toBe("[[a]]\n");
  });

  test("mixed arrays use inline tables", () => {
    expect(TOML.stringify({ a: [1, { b: 2 }, {}] })).toBe("a = [1, { b = 2 }, {}]\n");
    expect(TOML.parse(TOML.stringify({ a: [1, { b: 2 }] }))).toEqual({ a: [1, { b: 2 }] });
  });

  test("boxed primitives unwrap", () => {
    expect(TOML.stringify({ n: new Number(5), s: new String("x"), b: new Boolean(true) })).toBe(
      'n = 5\ns = "x"\nb = true\n',
    );
  });

  test("stringify is GC-safe under stress", () => {
    // Unique keys each iteration force fresh WTF strings through the
    // header-path bookkeeping; a refcount imbalance there crashes under GC.
    for (let i = 0; i < 2000; i++) {
      TOML.stringify({ ["table" + i]: { ["inner" + i]: { deep: [{ a: i }, { b: i }] } } });
      if (i % 256 === 0) Bun.gc(true);
    }
    Bun.gc(true);
    expect(TOML.parse(TOML.stringify({ ok: true }))).toEqual({ ok: true });
  });
});

// The TOML.stringify suite above covers parse(stringify(jsValue)). These cover
// the other direction, stringify of a value produced by parse (read, modify,
// write back).
describe("stringify(parse) round-trips", () => {
  test("all four date/time types come back out as the same TOML type", () => {
    // parse maps a date/time literal to its Temporal type, and stringify maps
    // each Temporal type back to the literal it came from: the TOML type
    // survives the lap (the spelling normalizes to canonical ISO form).
    const cases: [string, string][] = [
      ["d = 1979-05-27T07:32:00Z", "d = 1979-05-27T07:32:00Z\n"],
      ["d = 1979-05-27T00:32:00-07:00", "d = 1979-05-27T07:32:00Z\n"], // instant; offset normalizes
      ["d = 1979-05-27T07:32:00", "d = 1979-05-27T07:32:00\n"],
      ["d = 1979-05-27", "d = 1979-05-27\n"],
      ["d = 07:32:00", "d = 07:32:00\n"],
      ["d = 07:32", "d = 07:32:00\n"], // TOML 1.1 omitted seconds
    ];
    for (const [doc, out] of cases) {
      const once = TOML.parse(doc) as any;
      expect(TOML.stringify(once)).toBe(out);
      expect((TOML.parse(TOML.stringify(once)) as any).d.toString()).toBe(once.d.toString());
    }
  });

  test("a date literal and a string of the same text stay distinct", () => {
    expect((TOML.parse("a = 1979-05-27") as any).a).toBeInstanceOf(Temporal.PlainDate);
    expect((TOML.parse('a = "1979-05-27"') as any).a).toBe("1979-05-27");
    expect(TOML.stringify(TOML.parse("a = 1979-05-27"))).toBe("a = 1979-05-27\n");
    expect(TOML.stringify(TOML.parse('a = "1979-05-27"'))).toBe('a = "1979-05-27"\n');
  });

  test("nan, inf, -inf, and signed zero round-trip as values, not just as text", () => {
    // toEqual treats NaN as NaN and -0 as 0, so assert with Object.is.
    for (const x of [NaN, Infinity, -Infinity, -0, 0]) {
      expect(Object.is(TOML.parse(TOML.stringify({ x })).x, x)).toBe(true);
    }
  });

  test("2 ** 53 is the first integral double emitted in float form", () => {
    // TOML.parse rejects a bare integer one past Number.MAX_SAFE_INTEGER (the
    // "losslessly represented" test above), so stringify's `.0` suffix at this
    // boundary is what keeps its own output reparseable.
    expect(TOML.stringify({ x: Number.MAX_SAFE_INTEGER })).toBe("x = 9007199254740991\n");
    expect(TOML.stringify({ x: 2 ** 53 })).toBe("x = 9007199254740992.0\n");
    expect(TOML.stringify({ x: -Number.MAX_SAFE_INTEGER })).toBe("x = -9007199254740991\n");
    expect(TOML.stringify({ x: -(2 ** 53) })).toBe("x = -9007199254740992.0\n");
    for (const x of [Number.MAX_SAFE_INTEGER, 2 ** 53, -Number.MAX_SAFE_INTEGER, -(2 ** 53)]) {
      expect(TOML.parse(TOML.stringify({ x }))).toEqual({ x });
    }
    // Without the suffix, the same digits are not reparseable at all.
    expect(() => TOML.parse("x = 9007199254740992")).toThrow(SyntaxError);
  });

  test("float extremes round-trip exactly and the exponent form is valid TOML", () => {
    for (const x of [Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON, 1e-7, 1e-300, 0.1, 1 / 3]) {
      expect(Object.is(TOML.parse(TOML.stringify({ x })).x, x)).toBe(true);
    }
    // JSC's shortest repr picks exponent form here; TOML allows `int-part exp`.
    expect(TOML.stringify({ x: 1e-7 })).toBe("x = 1e-7\n");
    expect(TOML.stringify({ x: Number.MAX_VALUE })).toBe("x = 1.7976931348623157e+308\n");
    expect(TOML.stringify({ x: Number.MIN_VALUE })).toBe("x = 5e-324\n");
  });

  test("stringify(parse(doc)) is a fixed point on a multi-type document", () => {
    const doc = [
      'title = "ex"',
      "n = 5",
      "f = 2.5",
      "b = true",
      "dt = 1979-05-27T07:32:00Z",
      "ld = 1979-05-27",
      "lt = 07:32:00",
      "arr = [1, 2, 3]",
      "mixed = [1, 'two', [3]]",
      "[tbl]",
      "k = 'v'",
      "[[aot]]",
      "x = 1",
      "[[aot]]",
      "x = 2",
    ].join("\n");
    const once = TOML.parse(doc);
    expect(TOML.parse(TOML.stringify(once))).toEqual(once as any);
    // The emitted text is stable after one lap: a second stringify/parse
    // produces the identical document.
    expect(TOML.stringify(TOML.parse(TOML.stringify(once)))).toBe(TOML.stringify(once));
  });
});
