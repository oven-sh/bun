// Tests generated from the official toml-lang/toml-test conformance suite
// Generated from toml-test commit: 4d77658d0f903a13454ece4dbfeafeb7c7f31c9f
// Scope: TOML v1.1.0 manifest (tests/files-toml-1.1.0): 217 valid + 1 out-of-range-integer + 481 invalid + 9 invalid-encoding cases
// Regenerate with: bun bd test/js/bun/toml/generate_toml_test_suite.ts [path-to-toml-test]
//
// TOML type encoding asserted by these tests:
//   - integer: number; values outside Number.MAX_SAFE_INTEGER throw (TOML
//     requires lossless handling or an error — see the out-of-range block)
//   - datetime, datetime-local, date-local, time-local: string (source text);
//     compared after normalizing the date/time separator to "T", uppercasing
//     "Z", padding omitted seconds to ":00", and trimming trailing zeros from
//     fractional seconds
//   - invalid documents throw SyntaxError; the exact full message is asserted
//     where the in-tree parser produced a SyntaxError at generation time
//
// Inputs that are not valid UTF-8 cannot be JS strings; they are passed to
// TOML.parse as raw bytes (base64-decoded) in the invalid-encoding block.
import { TOML } from "bun";
import { describe, expect, test } from "bun:test";

class TomlDateTime {
  constructor(
    public kind: "datetime" | "datetime-local" | "date-local" | "time-local",
    public value: string,
  ) {}
}
function dt(kind: TomlDateTime["kind"], value: string): TomlDateTime {
  return new TomlDateTime(kind, value);
}

function normalizeDateTime(s: string): string {
  return s
    .replace(/^(\d{4}-\d{2}-\d{2})[ tT]/, "$1T")
    .replace(/[zZ]$/, "Z")
    .replace(/(^|T)(\d{2}:\d{2})(?=[Z+-]|$)/, "$1$2:00")
    .replace(/\.(\d+)/, (_, frac: string) => {
      const trimmed = frac.replace(/0+$/, "");
      return trimmed === "" ? "" : "." + trimmed;
    });
}

// Datetime markers become normalized strings; everything else is unchanged.
function normalizeExpected(expected: unknown): unknown {
  if (expected instanceof TomlDateTime) return normalizeDateTime(expected.value);
  if (Array.isArray(expected)) return expected.map(normalizeExpected);
  if (expected !== null && typeof expected === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(expected)) out[k] = normalizeExpected(v);
    return out;
  }
  return expected;
}

// Normalize the positions of `actual` that `expected` marks as datetimes, in
// lockstep, so a single toEqual compares everything else exactly.
function normalizeActual(actual: unknown, expected: unknown): unknown {
  if (expected instanceof TomlDateTime) {
    return typeof actual === "string" ? normalizeDateTime(actual) : actual;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return actual.map((a, i) => normalizeActual(a, expected[i]));
  }
  if (
    expected !== null &&
    typeof expected === "object" &&
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual)
  ) {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(actual)) out[k] = normalizeActual(v, (expected as any)[k]);
    return out;
  }
  return actual;
}

function expectTomlEqual(parsed: unknown, expected: unknown): void {
  expect(normalizeActual(parsed, expected)).toEqual(normalizeExpected(expected) as any);
}

// Each case also asserts that parse(stringify(parse(input))) produces the same
// value: stringify must never emit a document its own parse rejects or reads
// back differently. The TOML text may change (date/times come back as quoted
// strings), but the JS value is a fixed point after one lap.
describe("toml-test/valid", () => {
  test("valid/array/array-subtables", () => {
    const input: string = "[[arr]]\n[arr.subtab]\nval=1\n\n[[arr]]\n[arr.subtab]\nval=2\n";
    const expected: any = { arr: [{ subtab: { val: 1 } }, { subtab: { val: 2 } }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/array", () => {
    const input: string =
      'ints = [1, 2, 3, ]\nfloats = [1.1, 2.1, 3.1]\nstrings = ["a", "b", "c"]\ndates = [\n\t1987-07-05T17:45:00Z,\n\t1979-05-27T07:32:00,\n\t2006-06-01,\n\t11:00:00,\n]\ncomments = [\n         1,\n         2, #this is ok\n]\n';
    const expected: any = {
      comments: [1, 2],
      dates: [
        dt("datetime", "1987-07-05T17:45:00Z"),
        dt("datetime-local", "1979-05-27T07:32:00"),
        dt("date-local", "2006-06-01"),
        dt("time-local", "11:00:00"),
      ],
      floats: [1.1, 2.1, 3.1],
      ints: [1, 2, 3],
      strings: ["a", "b", "c"],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/bool", () => {
    const input: string = "a = [true, false]\n";
    const expected: any = { a: [true, false] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/empty", () => {
    const input: string = "thevoid = [[[[[]]]]]\n";
    const expected: any = { thevoid: [[[[[]]]]] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/hetergeneous", () => {
    const input: string = 'mixed = [[1, 2], ["a", "b"], [1.1, 2.1]]\n';
    const expected: any = {
      mixed: [
        [1, 2],
        ["a", "b"],
        [1.1, 2.1],
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/mixed-int-array", () => {
    const input: string = 'arrays-and-ints =  [1, ["Arrays are not integers."]]\n';
    const expected: any = { "arrays-and-ints": [1, ["Arrays are not integers."]] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/mixed-int-float", () => {
    const input: string = "ints-and-floats = [1, 1.1]\n";
    const expected: any = { "ints-and-floats": [1, 1.1] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/mixed-int-string", () => {
    const input: string = 'strings-and-ints = ["hi", 42]\n';
    const expected: any = { "strings-and-ints": ["hi", 42] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/mixed-string-table", () => {
    const input: string =
      'contributors = [\n  "Foo Bar <foo@example.com>",\n  { name = "Baz Qux", email = "bazqux@example.com", url = "https://example.com/bazqux" }\n]\n\n# Start with a table as the first element. This tests a case that some libraries\n# might have where they will check if the first entry is a table/map/hash/assoc\n# array and then encode it as a table array. This was a reasonable thing to do\n# before TOML 1.0 since arrays could only contain one type, but now it\'s no\n# longer.\nmixed = [{k="a"}, "b", 1]\n';
    const expected: any = {
      contributors: [
        "Foo Bar <foo@example.com>",
        {
          email: "bazqux@example.com",
          name: "Baz Qux",
          url: "https://example.com/bazqux",
        },
      ],
      mixed: [{ k: "a" }, "b", 1],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/nested-double", () => {
    const input: string = 'nest = [\n\t[\n\t\t["a"],\n\t\t[1, 2, [3]]\n\t]\n]\n';
    const expected: any = { nest: [[["a"], [1, 2, [3]]]] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/nested-inline-table", () => {
    const input: string = "a = [ { b = {} } ]\n";
    const expected: any = { a: [{ b: {} }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/nested", () => {
    const input: string = 'nest = [["a"], ["b"]]\n';
    const expected: any = { nest: [["a"], ["b"]] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/nospaces", () => {
    const input: string = "ints = [1,2,3]\n";
    const expected: any = { ints: [1, 2, 3] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/open-parent-table", () => {
    const input: string = "[[parent-table.arr]]\n[[parent-table.arr]]\n[parent-table]\nnot-arr = 1\n";
    const expected: any = { "parent-table": { "not-arr": 1, arr: [{}, {}] } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/string-quote-comma-01", () => {
    const input: string = 'title = [\n"Client: \\"XXXX\\", Job: XXXX",\n"Code: XXXX"\n]\n';
    const expected: any = { title: ['Client: "XXXX", Job: XXXX', "Code: XXXX"] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/string-quote-comma-02", () => {
    const input: string = 'title = [ " \\", ",]\n';
    const expected: any = { title: [' ", '] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/string-with-comma-01", () => {
    const input: string = 'title = [\n"Client: XXXX, Job: XXXX",\n"Code: XXXX"\n]\n';
    const expected: any = { title: ["Client: XXXX, Job: XXXX", "Code: XXXX"] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/string-with-comma-02", () => {
    const input: string = 'title = [\n"""Client: XXXX,\nJob: XXXX""",\n"Code: XXXX"\n]\n';
    const expected: any = { title: ["Client: XXXX,\nJob: XXXX", "Code: XXXX"] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/strings", () => {
    const input: string = "string_array = [ \"all\", 'strings', \"\"\"are the same\"\"\", '''type''']\n";
    const expected: any = { string_array: ["all", "strings", "are the same", "type"] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/table-array-string-backslash", () => {
    const input: string = 'foo = [ { bar="\\"{{baz}}\\""} ]\n';
    const expected: any = { foo: [{ bar: '"{{baz}}"' }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/array/trailing-comma", () => {
    const input: string = "arr-1 = [1,]\n\narr-2 = [2,3,]\n\narr-3 = [4,\n]\n\narr-4 = [\n\t5,\n\t6,\n]\n";
    const expected: any = { "arr-1": [1], "arr-3": [4], "arr-2": [2, 3], "arr-4": [5, 6] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/bool/bool", () => {
    const input: string = "t = true\nf = false\n";
    const expected: any = { f: false, t: true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/after-literal-no-ws", () => {
    const input: string = "inf=inf#infinity\nnan=nan#not a number\ntrue=true#true\nfalse=false#false\n";
    const expected: any = { false: false, inf: Infinity, nan: NaN, true: true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/at-eof", () => {
    const input: string = '# This is a full-line comment\nkey = "value" # This is a comment at the end of a line\n';
    const expected: any = { key: "value" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/at-eof2", () => {
    const input: string = '# This is a full-line comment\nkey = "value" # This is a comment at the end of a line\n';
    const expected: any = { key: "value" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/everywhere", () => {
    const input: string =
      '# Top comment.\n  # Top comment.\n# Top comment.\n\n# [no-extraneous-groups-please]\n\n[group] # Comment\nanswer = 42 # Comment\n# no-extraneous-keys-please = 999\n# Inbetween comment.\nmore = [ # Comment\n  # What about multiple # comments?\n  # Can you handle it?\n  #\n          # Evil.\n# Evil.\n  42, 42, # Comments within arrays are fun.\n  # What about multiple # comments?\n  # Can you handle it?\n  #\n          # Evil.\n# Evil.\n# ] Did I fool you?\n] # Hopefully not.\n\n# Make sure the space between the datetime and "#" isn\'t lexed.\ndt = 1979-05-27T07:32:12-07:00  # c\nd = 1979-05-27 # Comment\n\n[[aot]] # Comment\nk = 98 # Comment\n[[aot]]# Comment\nk = 99# Comment\n';
    const expected: any = {
      aot: [{ k: 98 }, { k: 99 }],
      group: {
        answer: 42,
        d: dt("date-local", "1979-05-27"),
        dt: dt("datetime", "1979-05-27T07:32:12-07:00"),
        more: [42, 42],
      },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/noeol", () => {
    const input: string = "# single comment without any eol characters";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/nonascii", () => {
    const input: string = "# ~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿\n";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/comment/tricky", () => {
    const input: string =
      '[section]#attached comment\n#[notsection]\none = "11"#cmt\ntwo = "22#"\nthree = \'#\'\n\nfour = """# no comment\n# nor this\n#also not comment"""#is_comment\n\nfive = 5.5#66\nsix = 6#7\n8 = "eight"\n#nine = 99\nten = 10e2#1\neleven = 1.11e1#23\n\n["hash#tag"]\n"#!" = "hash bang"\narr3 = [ "#", \'#\', """###""" ]\narr4 = [ 1,# 9, 9,\n2#,9\n,#9\n3#]\n,4]\narr5 = [[[[#["#"],\n["#"]]]]#]\n]\ntbl1 = { "#" = \'}#\'}#}}\n\n\n';
    const expected: any = {
      "hash#tag": {
        "#!": "hash bang",
        arr5: [[[[["#"]]]]],
        arr3: ["#", "#", "###"],
        arr4: [1, 2, 3, 4],
        tbl1: { "#": "}#" },
      },
      section: {
        "8": "eight",
        eleven: 11.1,
        five: 5.5,
        four: "# no comment\n# nor this\n#also not comment",
        one: "11",
        six: 6,
        ten: 1000,
        three: "#",
        two: "22#",
      },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/datetime", () => {
    const input: string =
      'space = 1987-07-05 17:45:00Z\n\n# ABNF is case-insensitive, both "Z" and "z" must be supported.\nlower = 1987-07-05t17:45:00z\n';
    const expected: any = {
      lower: dt("datetime", "1987-07-05T17:45:00Z"),
      space: dt("datetime", "1987-07-05T17:45:00Z"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/edge", () => {
    const input: string =
      "first-offset = 0001-01-01 00:00:00Z\nfirst-local  = 0001-01-01 00:00:00\nfirst-date   = 0001-01-01\n\nlast-offset = 9999-12-31 23:59:59Z\nlast-local  = 9999-12-31 23:59:59\nlast-date   = 9999-12-31\n";
    const expected: any = {
      "first-date": dt("date-local", "0001-01-01"),
      "first-local": dt("datetime-local", "0001-01-01T00:00:00"),
      "first-offset": dt("datetime", "0001-01-01T00:00:00Z"),
      "last-date": dt("date-local", "9999-12-31"),
      "last-local": dt("datetime-local", "9999-12-31T23:59:59"),
      "last-offset": dt("datetime", "9999-12-31T23:59:59Z"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/invalid-date-in-string", () => {
    const input: string = "s = '2020-01-01x'\n";
    const expected: any = { s: "2020-01-01x" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/leap-year", () => {
    const input: string =
      "2000-datetime       = 2000-02-29 15:15:15Z\n2000-datetime-local = 2000-02-29 15:15:15\n2000-date           = 2000-02-29\n\n2024-datetime       = 2024-02-29 15:15:15Z\n2024-datetime-local = 2024-02-29 15:15:15\n2024-date           = 2024-02-29\n";
    const expected: any = {
      "2000-date": dt("date-local", "2000-02-29"),
      "2000-datetime": dt("datetime", "2000-02-29T15:15:15Z"),
      "2000-datetime-local": dt("datetime-local", "2000-02-29T15:15:15"),
      "2024-date": dt("date-local", "2024-02-29"),
      "2024-datetime": dt("datetime", "2024-02-29T15:15:15Z"),
      "2024-datetime-local": dt("datetime-local", "2024-02-29T15:15:15"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/local-date", () => {
    const input: string = "bestdayever = 1987-07-05\n";
    const expected: any = { bestdayever: dt("date-local", "1987-07-05") };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/local-time", () => {
    const input: string = "besttimeever = 17:45:00\nmilliseconds = 10:32:00.555\n";
    const expected: any = {
      besttimeever: dt("time-local", "17:45:00"),
      milliseconds: dt("time-local", "10:32:00.555"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/local", () => {
    const input: string = "local = 1987-07-05T17:45:00\nmilli = 1977-12-21T10:32:00.555\nspace = 1987-07-05 17:45:00\n";
    const expected: any = {
      local: dt("datetime-local", "1987-07-05T17:45:00"),
      milli: dt("datetime-local", "1977-12-21T10:32:00.555"),
      space: dt("datetime-local", "1987-07-05T17:45:00"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/milliseconds", () => {
    const input: string =
      "utc1  = 1987-07-05T17:45:56.123Z\nutc2  = 1987-07-05T17:45:56.6Z\nwita1 = 1987-07-05T17:45:56.123+08:00\nwita2 = 1987-07-05T17:45:56.6+08:00\n";
    const expected: any = {
      utc1: dt("datetime", "1987-07-05T17:45:56.123Z"),
      utc2: dt("datetime", "1987-07-05T17:45:56.600Z"),
      wita1: dt("datetime", "1987-07-05T17:45:56.123+08:00"),
      wita2: dt("datetime", "1987-07-05T17:45:56.600+08:00"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/no-seconds", () => {
    const input: string =
      "# Seconds are optional in date-time and time.\nwithout-seconds-1 = 13:37\nwithout-seconds-2 = 1979-05-27 07:32Z\nwithout-seconds-3 = 1979-05-27 07:32-07:00\nwithout-seconds-4 = 1979-05-27T07:32\n";
    const expected: any = {
      "without-seconds-1": dt("time-local", "13:37:00"),
      "without-seconds-2": dt("datetime", "1979-05-27T07:32:00Z"),
      "without-seconds-3": dt("datetime", "1979-05-27T07:32:00-07:00"),
      "without-seconds-4": dt("datetime-local", "1979-05-27T07:32:00"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/datetime/timezone", () => {
    const input: string =
      "utc  = 1987-07-05T17:45:56Z\npdt  = 1987-07-05T17:45:56-05:00\nnzst = 1987-07-05T17:45:56+12:00\nnzdt = 1987-07-05T17:45:56+13:00  # DST\n";
    const expected: any = {
      nzdt: dt("datetime", "1987-07-05T17:45:56+13:00"),
      nzst: dt("datetime", "1987-07-05T17:45:56+12:00"),
      pdt: dt("datetime", "1987-07-05T17:45:56-05:00"),
      utc: dt("datetime", "1987-07-05T17:45:56Z"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/empty-crlf", () => {
    const input: string = "\r\n";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/empty-lf", () => {
    const input: string = "\n";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/empty-nothing", () => {
    const input: string = "";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/empty-space", () => {
    const input: string = " ";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/empty-tab", () => {
    const input: string = "\t";
    const expected: any = {};
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/example", () => {
    const input: string =
      "best-day-ever = 1987-07-05T17:45:00Z\n\n[numtheory]\nboring = false\nperfection = [6, 28, 496]\n";
    const expected: any = {
      "best-day-ever": dt("datetime", "1987-07-05T17:45:00Z"),
      numtheory: { boring: false, perfection: [6, 28, 496] },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/exponent-upper", () => {
    const input: string =
      '# Both upper- and lower-case "e" is valid, so repeat the exponent.toml test with\n# upper-case.\nexp        = 3E2\npos-exp    = 3E+2\nneg-exp    = 3E-2\nzero-exp   = 3E0\nfrac       = 3.1E2\nneg        = -1E-1\nzero       = 0E2\nzero-plus = +0E2\n';
    const expected: any = {
      exp: 300,
      frac: 310,
      neg: -0.1,
      "neg-exp": 0.03,
      "pos-exp": 300,
      zero: 0,
      "zero-exp": 3,
      "zero-plus": 0,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/exponent", () => {
    const input: string =
      "# Please keep exponent-upper.toml in sync with this.\n\nexp       = 3e2\npos-exp   = 3e+2\nneg-exp   = 3e-2\nzero-exp  = 3e0\nfrac      = 3.1e2\nneg       = -1e-1\nzero      = 0e2\nzero-plus = +0e2\n";
    const expected: any = {
      exp: 300,
      frac: 310,
      neg: -0.1,
      "neg-exp": 0.03,
      "pos-exp": 300,
      zero: 0,
      "zero-exp": 3,
      "zero-plus": 0,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/float", () => {
    const input: string =
      "pi = 3.14\npospi = +3.14\nnegpi = -3.14\nzero-intpart = 0.123\nleading-zero-fractional = 0.0123\n";
    const expected: any = {
      negpi: -3.14,
      pi: 3.14,
      pospi: 3.14,
      "zero-intpart": 0.123,
      "leading-zero-fractional": 0.0123,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/inf-and-nan", () => {
    const input: string =
      "# We don't encode +nan and -nan back with the signs; many languages don't\n# support a sign on NaN (it doesn't really make much sense).\nnan = nan\nnan_neg = -nan\nnan_plus = +nan\ninfinity = inf\ninfinity_neg = -inf\ninfinity_plus = +inf\n";
    const expected: any = {
      infinity: Infinity,
      infinity_neg: -Infinity,
      infinity_plus: Infinity,
      nan: NaN,
      nan_neg: NaN,
      nan_plus: NaN,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/long", () => {
    const input: string = "longpi = 3.141592653589793\nneglongpi = -3.141592653589793\n";
    const expected: any = { longpi: 3.141592653589793, neglongpi: -3.141592653589793 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/max-int", () => {
    const input: string =
      "# Maximum and minimum safe natural numbers.\nmax_float =  9_007_199_254_740_991.0\nmin_float = -9_007_199_254_740_991.0\n";
    const expected: any = { max_float: 9007199254740991, min_float: -9007199254740991 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/underscore", () => {
    const input: string = "before = 3_141.5927\nafter = 3141.592_7\nexponent = 3e1_4\n";
    const expected: any = { after: 3141.5927, before: 3141.5927, exponent: 300000000000000 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/float/zero", () => {
    const input: string =
      "zero = 0.0\nsigned-pos = +0.0\nsigned-neg = -0.0\nexponent = 0e0\nexponent-two-0 = 0e00\nexponent-signed-pos = +0e0\nexponent-signed-neg = -0e0\n";
    const expected: any = {
      exponent: 0,
      "exponent-signed-neg": -0,
      "exponent-signed-pos": 0,
      "exponent-two-0": 0,
      "signed-neg": -0,
      "signed-pos": 0,
      zero: 0,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/implicit-and-explicit-after", () => {
    const input: string = "[a.b.c]\nanswer = 42\n\n[a]\nbetter = 43\n";
    const expected: any = { a: { better: 43, b: { c: { answer: 42 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/implicit-and-explicit-before", () => {
    const input: string = "[a]\nbetter = 43\n\n[a.b.c]\nanswer = 42\n";
    const expected: any = { a: { better: 43, b: { c: { answer: 42 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/implicit-groups", () => {
    const input: string = "[a.b.c]\nanswer = 42\n";
    const expected: any = { a: { b: { c: { answer: 42 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/array-01", () => {
    const input: string =
      'arr = [ {\'a\'= 1}, {\'a\'= 2} ]\n\npeople = [{first_name = "Bruce", last_name = "Springsteen"},\n          {first_name = "Eric", last_name = "Clapton"},\n          {first_name = "Bob", last_name = "Seger"}]\n';
    const expected: any = {
      arr: [{ a: 1 }, { a: 2 }],
      people: [
        { first_name: "Bruce", last_name: "Springsteen" },
        { first_name: "Eric", last_name: "Clapton" },
        { first_name: "Bob", last_name: "Seger" },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/array-02", () => {
    const input: string =
      '# "No newlines are allowed between the curly braces unless they are valid within\n# a value"\n\na = { a = [\n]}\n';
    const expected: any = { a: { a: [] } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/array-03", () => {
    const input: string = "b = { a = [\n\t\t1,\n\t\t2,\n\t], b = [\n\t\t3,\n\t\t4,\n\t]}\n";
    const expected: any = { b: { a: [1, 2], b: [3, 4] } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/bool", () => {
    const input: string = "a = {a = true, b = false}\n";
    const expected: any = { a: { a: true, b: false } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/empty", () => {
    const input: string =
      'empty1 = {}\nempty2 = { }\nempty_in_array = [ { not_empty = 1 }, {} ]\nempty_in_array2 = [{},{not_empty=1}]\nmany_empty = [{},{},{}]\nnested_empty = {"empty"={}}\nwith_cmt ={            }#nothing here\n';
    const expected: any = {
      empty1: {},
      empty2: {},
      with_cmt: {},
      empty_in_array: [{ not_empty: 1 }, {}],
      empty_in_array2: [{}, { not_empty: 1 }],
      many_empty: [{}, {}, {}],
      nested_empty: { empty: {} },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/end-in-bool", () => {
    const input: string = 'black = { python=">3.6", version=">=18.9b0", allow_prereleases=true }\n';
    const expected: any = { black: { allow_prereleases: true, python: ">3.6", version: ">=18.9b0" } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/inline-table", () => {
    const input: string =
      'name        = { first = "Tom", last = "Preston-Werner" }\npoint       = { x = 1, y = 2 }\nsimple      = { a = 1 }\nstr-key     = { "a" = 1 }\ntable-array = [{ "a" = 1 }, { "b" = 2 }]\n';
    const expected: any = {
      name: { first: "Tom", last: "Preston-Werner" },
      point: { x: 1, y: 2 },
      simple: { a: 1 },
      "str-key": { a: 1 },
      "table-array": [{ a: 1 }, { b: 2 }],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-01", () => {
    const input: string =
      'a = {   a.b  =  1   }\nb = {   "a"."b"  =  1   }\nc = {   a   .   b  =  1   }\nd = {   \'a\'   .   "b"  =  1   }\ne = {a.b=1}\n';
    const expected: any = {
      a: { a: { b: 1 } },
      b: { a: { b: 1 } },
      c: { a: { b: 1 } },
      d: { a: { b: 1 } },
      e: { a: { b: 1 } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-02", () => {
    const input: string = "many.dots.here.dot.dot.dot = {a.b.c = 1, a.b.d = 2}\n";
    const expected: any = {
      many: { dots: { here: { dot: { dot: { dot: { a: { b: { c: 1, d: 2 } } } } } } } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-03", () => {
    const input: string = "[tbl]\na.b.c = {d.e=1}\n\n[tbl.x]\na.b.c = {d.e=1}\n";
    const expected: any = {
      tbl: { a: { b: { c: { d: { e: 1 } } } }, x: { a: { b: { c: { d: { e: 1 } } } } } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-04", () => {
    const input: string = "[[arr]]\nt = {a.b=1}\nT = {a.b=1}\n\n[[arr]]\nt = {a.b=2}\nT = {a.b=2}\n";
    const expected: any = {
      arr: [
        { T: { a: { b: 1 } }, t: { a: { b: 1 } } },
        { T: { a: { b: 2 } }, t: { a: { b: 2 } } },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-05", () => {
    const input: string =
      'arr-1 = [{a.b = 1}]\narr-2 = ["str", {a.b = 1}]\n\narr-3 = [{a.b = 1}, {a.b = 2}]\narr-4 = ["str", {a.b = 1}, {a.b = 2}]\n';
    const expected: any = {
      "arr-1": [{ a: { b: 1 } }],
      "arr-2": ["str", { a: { b: 1 } }],
      "arr-3": [{ a: { b: 1 } }, { a: { b: 2 } }],
      "arr-4": ["str", { a: { b: 1 } }, { a: { b: 2 } }],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-06", () => {
    const input: string = "top.dot.dot = [\n\t{dot.dot.dot = 1},\n\t{dot.dot.dot = 2},\n]\n";
    const expected: any = {
      top: { dot: { dot: [{ dot: { dot: { dot: 1 } } }, { dot: { dot: { dot: 2 } } }] } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/key-dotted-07", () => {
    const input: string = "arr = [\n\t{a.b = [{c.d = 1}]}\n]\n";
    const expected: any = { arr: [{ a: { b: [{ c: { d: 1 } }] } }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/multiline", () => {
    const input: string =
      'tbl_multiline = { a = 1, b = """\nmultiline\n""", c = """and yet\nanother line""", d = 4 }\n';
    const expected: any = { tbl_multiline: { a: 1, b: "multiline\n", c: "and yet\nanother line", d: 4 } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/nest", () => {
    const input: string =
      "tbl_tbl_empty = { tbl_0 = {} }\ntbl_tbl_val   = { tbl_1 = { one = 1 } }\ntbl_arr_tbl   = { arr_tbl = [ { one = 1 } ] }\narr_tbl_tbl   = [ { tbl = { one = 1 } } ]\n\n# Array-of-array-of-table is interesting because it can only\n# be represented in inline form.\narr_arr_tbl_empty = [ [ {} ] ]\narr_arr_tbl_val = [ [ { one = 1 } ] ]\narr_arr_tbls  = [ [ { one = 1 }, { two = 2 } ] ]\n";
    const expected: any = {
      arr_arr_tbl_empty: [[{}]],
      arr_arr_tbl_val: [[{ one: 1 }]],
      arr_arr_tbls: [[{ one: 1 }, { two: 2 }]],
      arr_tbl_tbl: [{ tbl: { one: 1 } }],
      tbl_arr_tbl: { arr_tbl: [{ one: 1 }] },
      tbl_tbl_empty: { tbl_0: {} },
      tbl_tbl_val: { tbl_1: { one: 1 } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/newline-comment", () => {
    const input: string =
      '# Identical to newline.toml, but with comments that shouldn\'t affect the\n# results.\n\ntrailing-comma-1 = {#comment\n\t# comment\n\tc = 1,#comment\n\t#comment\n}#comment\ntrailing-comma-2 = { c = 1, }#comment\n\ntbl-1 = {#comment\n\thello = "world",#comment\n\t1     = 2,#comment\n\tarr   = [1,#comment\n\t         2,#comment\n\t         3,#comment\n\t        ],#comment\n\ttbl = {#comment\n\t\t k = 1,#comment\n\t}#comment\n}#comment\n\ntbl-2 = {#comment\n\tk = """\n\tHello\n\t"""#comment\n}#comment\n';
    const expected: any = {
      "tbl-1": { "1": 2, hello: "world", arr: [1, 2, 3], tbl: { k: 1 } },
      "tbl-2": { k: "\tHello\n\t" },
      "trailing-comma-1": { c: 1 },
      "trailing-comma-2": { c: 1 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/newline", () => {
    const input: string =
      '# TOML 1.1 supports newlines in inline tables and trailing commas.\n\ntrailing-comma-1 = {\n\tc = 1,\n}\ntrailing-comma-2 = { c = 1, }\n\ntbl-1 = {\n\thello = "world",\n\t1     = 2,\n\tarr   = [1,\n\t         2,\n\t         3,\n\t        ],\n\ttbl = {\n\t\t k = 1,\n\t}\n}\n\ntbl-2 = {\n\tk = """\n\tHello\n\t"""\n}\n\nno-newline-before-brace = {\na = 1,\nb = 2}\n\nno-newline-before-brace-with-comma = {\na = 1,\nb = 2,}\n';
    const expected: any = {
      "no-newline-before-brace": { a: 1, b: 2 },
      "no-newline-before-brace-with-comma": { a: 1, b: 2 },
      "tbl-1": { "1": 2, hello: "world", arr: [1, 2, 3], tbl: { k: 1 } },
      "tbl-2": { k: "\tHello\n\t" },
      "trailing-comma-1": { c: 1 },
      "trailing-comma-2": { c: 1 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/inline-table/spaces", () => {
    const input: string =
      '# https://github.com/toml-lang/toml-test/issues/146\nclap-1 = { version = "4"  , features = ["derive", "cargo"] }\n\n# Contains some literal tabs!\nclap-2 = { version = "4"\t   \t,\t  \tfeatures = [   "derive" \t  ,  \t  "cargo"   ]   , nest   =   {  \t  "a"   =   \'x\'  , \t  \'b\'   = [ 1.5    ,   9.0  ]  }  }\n';
    const expected: any = {
      "clap-1": { version: "4", features: ["derive", "cargo"] },
      "clap-2": { version: "4", features: ["derive", "cargo"], nest: { a: "x", b: [1.5, 9] } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/integer/float64-max", () => {
    const input: string =
      "# Maximum and minimum safe float64 natural numbers. Mainly here for\n# -int-as-float.\nmax_int =  9_007_199_254_740_991\nmin_int = -9_007_199_254_740_991\n";
    const expected: any = { max_int: 9007199254740991, min_int: -9007199254740991 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/integer/integer", () => {
    const input: string = "answer = 42\nposanswer = +42\nneganswer = -42\nzero = 0\n";
    const expected: any = { answer: 42, neganswer: -42, posanswer: 42, zero: 0 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/integer/literals", () => {
    const input: string =
      "bin1 = 0b11010110\nbin2 = 0b1_0_1\n\noct1 = 0o01234567\noct2 = 0o755\noct3 = 0o7_6_5\n\nhex1 = 0xDEADBEEF\nhex2 = 0xdeadbeef\nhex3 = 0xdead_beef\nhex4 = 0x00987\n";
    const expected: any = {
      bin1: 214,
      bin2: 5,
      hex1: 3735928559,
      hex2: 3735928559,
      hex3: 3735928559,
      hex4: 2439,
      oct1: 342391,
      oct2: 493,
      oct3: 501,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/integer/underscore", () => {
    const input: string = "kilo = 1_000\nx = 1_1_1_1\n";
    const expected: any = { kilo: 1000, x: 1111 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/integer/zero", () => {
    const input: string =
      "d1 = 0\nd2 = +0\nd3 = -0\n\nh1 = 0x0\nh2 = 0x00\nh3 = 0x00000\n\no1 = 0o0\na2 = 0o00\na3 = 0o00000\n\nb1 = 0b0\nb2 = 0b00\nb3 = 0b00000\n";
    const expected: any = {
      a2: 0,
      a3: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      d1: 0,
      d2: 0,
      d3: 0,
      h1: 0,
      h2: 0,
      h3: 0,
      o1: 0,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/alphanum", () => {
    const input: string =
      'alpha = "a"\n123 = "num"\n000111 = "leading"\n10e3 = "false float"\none1two2 = "mixed"\nwith-dash = "dashed"\nunder_score = "___"\n34-11 = 23\n\n[2018_10]\n001 = 1\n\n[a-a-a]\n_ = false\n';
    const expected: any = {
      "123": "num",
      "000111": "leading",
      "10e3": "false float",
      "34-11": 23,
      alpha: "a",
      one1two2: "mixed",
      under_score: "___",
      "with-dash": "dashed",
      "2018_10": { "001": 1 },
      "a-a-a": { _: false },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/case-sensitive", () => {
    const input: string =
      'sectioN = "NN"\n\n[section]\nname = "lower"\nNAME = "upper"\nName = "capitalized"\n\n[Section]\nname = "different section!!"\n"μ" = "greek small letter mu"\n"Μ" = "greek capital letter MU"\nM = "latin letter M"\n\n';
    const expected: any = {
      sectioN: "NN",
      Section: {
        M: "latin letter M",
        name: "different section!!",
        "Μ": "greek capital letter MU",
        "μ": "greek small letter mu",
      },
      section: { NAME: "upper", Name: "capitalized", name: "lower" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/dotted-01", () => {
    const input: string = 'name.first = "Arthur"\n"name".\'last\' = "Dent"\n\nmany.dots.dot.dot.dot = 42\n';
    const expected: any = {
      many: { dots: { dot: { dot: { dot: 42 } } } },
      name: { first: "Arthur", last: "Dent" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/dotted-02", () => {
    const input: string =
      "# Note: this file contains literal tab characters.\n\n# Space are ignored, and key parts can be quoted.\ncount.a       = 1\ncount . b     = 2\n\"count\".\"c\"   = 3\n\"count\" . \"d\" = 4\n'count'.'e'   = 5\n'count' . 'f' = 6\n\"count\".'g'   = 7\n\"count\" . 'h' = 8\ncount.'i'     = 9\ncount \t.\t 'j'\t   = 10\n\"count\".k     = 11\n\"count\" . l   = 12\n";
    const expected: any = {
      count: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/dotted-03", () => {
    const input: string =
      'top.key = 1\n\n[tbl]\na.b.c = 42.666\n\n[a.few.dots]\npolka.dot = "again?"\npolka.dance-with = "Dot"\n\n';
    const expected: any = {
      a: { few: { dots: { polka: { "dance-with": "Dot", dot: "again?" } } } },
      tbl: { a: { b: { c: 42.666 } } },
      top: { key: 1 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/dotted-04", () => {
    const input: string = "top.key = 1\n\n[[arr]]\na.b.c=1\na.b.d=2\n\n[[arr]]\na.b.c=3\na.b.d=4\n\n";
    const expected: any = {
      arr: [{ a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 3, d: 4 } } }],
      top: { key: 1 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/dotted-empty", () => {
    const input: string = '\'\'.x = "empty.x"\nx."" = "x.empty"\n[a]\n"".\'\' = "empty.empty"\n';
    const expected: any = {
      "": { x: "empty.x" },
      a: { "": { "": "empty.empty" } },
      x: { "": "x.empty" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/empty-01", () => {
    const input: string = '"" = "blank"\n';
    const expected: any = { "": "blank" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/empty-02", () => {
    const input: string = "'' = \"blank\"\n";
    const expected: any = { "": "blank" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/empty-03", () => {
    const input: string = "''=0\n";
    const expected: any = { "": 0 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/equals-nospace", () => {
    const input: string = "answer=42\n";
    const expected: any = { answer: 42 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/escapes", () => {
    const input: string =
      '"\\n" = "newline"\n"\\b" = "bell"\n"\\u00c0" = "latin capital letter A with grave"\n"\\"" = "just a quote"\n\n["backsp\\b\\b"]\n\n["\\"quoted\\""]\nquote = true\n\n["a.b"."\\u00c0"]\n';
    const expected: any = {
      "\b": "bell",
      "\n": "newline",
      '"': "just a quote",
      "backsp\b\b": {},
      "À": "latin capital letter A with grave",
      '"quoted"': { quote: true },
      "a.b": { "À": {} },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/like-date", () => {
    const input: string =
      '# \'-\' is a valid character in keys: make a key that looks like a date.\n2001-02-03   = 1\n"2001-02-04" = 2\n\'2001-02-05\' = 3\n\n# Also include datetime and time for good measure; these need to be quoted as\n# \':\' isn\'t a valid bare key.\n"2001-02-06T15:16:17+01:00" = 4\n"2001-02-07T15:16:17"       = 5\n"15:16:17"                  = 6\n\n# Dotted keys\na.2001-02-08 = 7\na.2001-02-09.2001-02-10 = 8\n2001-02-11.a.2001-02-12 = 9\n\n# Table names\n[2002-01-02]\nk = 10\n\n[2002-01-02.2024-01-03]\nk = 11\n\n[[2002-01-04]]\nk = 12\n';
    const expected: any = {
      "15:16:17": 6,
      "2001-02-03": 1,
      "2001-02-04": 2,
      "2001-02-05": 3,
      "2001-02-06T15:16:17+01:00": 4,
      "2001-02-07T15:16:17": 5,
      "2002-01-04": [{ k: 12 }],
      "2001-02-11": { a: { "2001-02-12": 9 } },
      "2002-01-02": { k: 10, "2024-01-03": { k: 11 } },
      a: { "2001-02-08": 7, "2001-02-09": { "2001-02-10": 8 } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-01", () => {
    const input: string = "1     = true\n";
    const expected: any = { "1": true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-02", () => {
    const input: string = "1.2   = true\n";
    const expected: any = { "1": { "2": true } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-03", () => {
    const input: string = "0123  = true\n";
    const expected: any = { "0123": true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-04", () => {
    const input: string = "01.23 = true\n";
    const expected: any = { "01": { "23": true } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-05", () => {
    const input: string = "23.01 = true\n";
    const expected: any = { "23": { "01": true } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-06", () => {
    const input: string = "-1    = true\n";
    const expected: any = { "-1": true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-07", () => {
    const input: string = "-01   = true\n";
    const expected: any = { "-01": true };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/numeric-08", () => {
    const input: string = "1  = 'one'\n01 = 'zero one'\n";
    const expected: any = { "1": "one", "01": "zero one" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/quoted-dots", () => {
    const input: string =
      'plain = 1\n"with.dot" = 2\n\n[plain_table]\nplain = 3\n"with.dot" = 4\n\n[table.withdot]\nplain = 5\n"key.with.dots" = 6\n"escaped\\u002edot" = 7\n';
    const expected: any = {
      plain: 1,
      "with.dot": 2,
      plain_table: { plain: 3, "with.dot": 4 },
      table: { withdot: { "escaped.dot": 7, "key.with.dots": 6, plain: 5 } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/quoted-unicode", () => {
    const input: string =
      '\n"\\u0000" = "null"\n\'\\u0000\' = "different key"\n"\\u0008 \\u000c \\U00000041 \\u007f \\u0080 \\u00ff \\ud7ff \\ue000 \\uffff \\U00010000 \\U0010ffff" = "escaped key"\n\n"~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿" = "basic key"\n\'l ~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿\' = "literal key"\n';
    const expected: any = {
      "\u0000": "null",
      "\b \f A \u007f \u0080 ÿ ퟿  ￿ 𐀀 􏿿": "escaped key",
      "\\u0000": "different key",
      "l ~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿": "literal key",
      "~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿": "basic key",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/space", () => {
    const input: string =
      '# Keep whitespace inside quotes keys at all positions.\n"a b"   = 1\n" c d " = 2\n"  much \t\t  whitespace  \t\\n  \\r\\n  " = 3\n\n[ " tbl " ]\n"\\ttab\\ttab\\t" = "tab"\n';
    const expected: any = {
      "  much \t\t  whitespace  \t\n  \r\n  ": 3,
      " c d ": 2,
      "a b": 1,
      " tbl ": { "\ttab\ttab\t": "tab" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/special-chars", () => {
    const input: string = '"=~!@$^&*()_+-`1234567890[]|/?><.,;:\'=" = 1\n';
    const expected: any = { "=~!@$^&*()_+-`1234567890[]|/?><.,;:'=": 1 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/special-word", () => {
    const input: string = 'false = false\ntrue = 1\ninf = 100000000\nnan = "ceci n\'est pas un nombre"\n\n';
    const expected: any = { false: false, inf: 100000000, nan: "ceci n'est pas un nombre", true: 1 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/start", () => {
    const input: string =
      "# Table and keys can start with any character; there is no requirement for it to\n# start with a letter.\n\n[-key]\n-key = 1\n\n[_key]\n_key = 2\n\n[1key]\n1key = 3\n\n[-]\n- = 4\n\n[_]\n_ = 5\n\n[1] \n1 = 6\n\n[---] \n--- = 7\n\n[___]\n___ = 8\n\n[111]\n111 = 9\n\n[inline]\n--- = {--- = 10, ___ = 11, 111 = 12}\n";
    const expected: any = {
      "1": { "1": 6 },
      "111": { "111": 9 },
      "-": { "-": 4 },
      "---": { "---": 7 },
      "-key": { "-key": 1 },
      "1key": { "1key": 3 },
      _: { _: 5 },
      ___: { ___: 8 },
      _key: { _key: 2 },
      inline: { "---": { "111": 12, "---": 10, ___: 11 } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/key/zero", () => {
    const input: string = "0=0\n";
    const expected: any = { "0": 0 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/multibyte", () => {
    const input: string =
      '# Test multibyte throughout\n\n# Tèƨƭ ƒïℓè ƒôř TÓM£\n# Óñℓ¥ ƭλïƨ ôñè ƭřïèƨ ƭô è₥úℓáƭè á TÓM£ ƒïℓè ωřïƭƭèñ β¥ á úƨèř ôƒ ƭλè ƙïñδ ôƒ ƥářƨèř ωřïƭèřƨ ƥřôβáβℓ¥ λáƭè\n\n[\'𝐭𝐛𝐥\']\nstring = "𝓼𝓽𝓻𝓲𝓷𝓰 - #"          # " 𝓼𝓽𝓻𝓲𝓷𝓰\n\t[\'𝐭𝐛𝐥\'.sub]\n\t\'𝕒𝕣𝕣𝕒𝕪\' = [ "] ", " # "]      # ] 𝓪𝓻𝓻𝓪𝔂\n\t\'𝕒𝕣𝕣𝕒𝕪𝟚\' = [ "Tèƨƭ #11 ]ƥřôƲèδ ƭλáƭ", "Éжƥèřï₥èñƭ #9 ωáƨ á ƨúççèƨƨ" ]\n\t# Ýôú δïδñ\'ƭ ƭλïñƙ ïƭ\'δ áƨ èáƨ¥ áƨ çλúçƙïñϱ ôúƭ ƭλè ℓáƨƭ #, δïδ ¥ôú?\n\tanother_test_string = "§á₥è ƭλïñϱ, βúƭ ωïƭλ á ƨƭřïñϱ #"\n\tescapes = " Âñδ ωλèñ \\"\'ƨ ářè ïñ ƭλè ƨƭřïñϱ, áℓôñϱ ωïƭλ # \\""   # "áñδ çô₥₥èñƭƨ ářè ƭλèřè ƭôô"\n\t# Tλïñϱƨ ωïℓℓ ϱèƭ λářδèř\n\t\t[\'𝐭𝐛𝐥\'.sub."βïƭ#"]\n\t\t"ωλáƭ?" = "Ýôú δôñ\'ƭ ƭλïñƙ ƨô₥è úƨèř ωôñ\'ƭ δô ƭλáƭ?"\n\t\tmulti_line_array = [\n\t\t\t"]",\n\t\t\t# ] Óλ ¥èƨ Ì δïδ\n\t\t\t]\n';
    const expected: any = {
      "𝐭𝐛𝐥": {
        string: "𝓼𝓽𝓻𝓲𝓷𝓰 - #",
        sub: {
          another_test_string: "§á₥è ƭλïñϱ, βúƭ ωïƭλ á ƨƭřïñϱ #",
          escapes: ' Âñδ ωλèñ "\'ƨ ářè ïñ ƭλè ƨƭřïñϱ, áℓôñϱ ωïƭλ # "',
          "βïƭ#": {
            multi_line_array: ["]"],
            "ωλáƭ?": "Ýôú δôñ'ƭ ƭλïñƙ ƨô₥è úƨèř ωôñ'ƭ δô ƭλáƭ?",
          },
          "𝕒𝕣𝕣𝕒𝕪": ["] ", " # "],
          "𝕒𝕣𝕣𝕒𝕪𝟚": ["Tèƨƭ #11 ]ƥřôƲèδ ƭλáƭ", "Éжƥèřï₥èñƭ #9 ωáƨ á ƨúççèƨƨ"],
        },
      },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/newline-crlf", () => {
    const input: string = 'os = "DOS"\r\nnewline = "crlf"\r\n';
    const expected: any = { newline: "crlf", os: "DOS" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/newline-lf", () => {
    const input: string = 'os = "unix"\nnewline = "lf"\n';
    const expected: any = { newline: "lf", os: "unix" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-0", () => {
    const input: string =
      '# This is a full-line comment\nkey = "value"  # This is a comment at the end of a line\nanother = "# This is not a comment"\n';
    const expected: any = { another: "# This is not a comment", key: "value" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-1", () => {
    const input: string = 'key = "value"\n';
    const expected: any = { key: "value" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-10", () => {
    const input: string =
      '# RECOMMENDED\n\napple.type = "fruit"\napple.skin = "thin"\napple.color = "red"\n\norange.type = "fruit"\norange.skin = "thick"\norange.color = "orange"\n';
    const expected: any = {
      apple: { color: "red", skin: "thin", type: "fruit" },
      orange: { color: "orange", skin: "thick", type: "fruit" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-11", () => {
    const input: string = '3.14159 = "pi"\n';
    const expected: any = { "3": { "14159": "pi" } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-12", () => {
    const input: string = 'str = "I\'m a string. \\"You can quote me\\". Name\\tJos\\xE9\\nLocation\\tSF."\n';
    const expected: any = { str: 'I\'m a string. "You can quote me". Name\tJosé\nLocation\tSF.' };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-13", () => {
    const input: string = 'str1 = """\nRoses are red\nViolets are blue"""\n';
    const expected: any = { str1: "Roses are red\nViolets are blue" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-14", () => {
    const input: string =
      '# On a Unix system, the above multi-line string will most likely be the same as:\nstr2 = "Roses are red\\nViolets are blue"\n\n# On a Windows system, it will most likely be equivalent to:\nstr3 = "Roses are red\\r\\nViolets are blue"\n';
    const expected: any = {
      str2: "Roses are red\nViolets are blue",
      str3: "Roses are red\r\nViolets are blue",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-15", () => {
    const input: string =
      '# The following strings are byte-for-byte equivalent:\nstr1 = "The quick brown fox jumps over the lazy dog."\n\nstr2 = """\nThe quick brown \\\n\n\n  fox jumps over \\\n    the lazy dog."""\n\nstr3 = """\\\n       The quick brown \\\n       fox jumps over \\\n       the lazy dog.\\\n       """\n';
    const expected: any = {
      str1: "The quick brown fox jumps over the lazy dog.",
      str2: "The quick brown fox jumps over the lazy dog.",
      str3: "The quick brown fox jumps over the lazy dog.",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-16", () => {
    const input: string =
      'str4 = """Here are two quotation marks: "". Simple enough."""\n# str5 = """Here are three quotation marks: """."""  # INVALID\nstr5 = """Here are three quotation marks: ""\\"."""\nstr6 = """Here are fifteen quotation marks: ""\\"""\\"""\\"""\\"""\\"."""\n\n# "This," she said, "is just a pointless statement."\nstr7 = """"This," she said, "is just a pointless statement.""""\n';
    const expected: any = {
      str4: 'Here are two quotation marks: "". Simple enough.',
      str5: 'Here are three quotation marks: """.',
      str6: 'Here are fifteen quotation marks: """"""""""""""".',
      str7: '"This," she said, "is just a pointless statement."',
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-17", () => {
    const input: string =
      "# What you see is what you get.\nwinpath  = 'C:\\Users\\nodejs\\templates'\nwinpath2 = '\\\\ServerX\\admin$\\system32\\'\nquoted   = 'Tom \"Dubs\" Preston-Werner'\nregex    = '<\\i\\c*\\s*>'\n";
    const expected: any = {
      quoted: 'Tom "Dubs" Preston-Werner',
      regex: "<\\i\\c*\\s*>",
      winpath: "C:\\Users\\nodejs\\templates",
      winpath2: "\\\\ServerX\\admin$\\system32\\",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-18", () => {
    const input: string =
      "regex2 = '''I [dw]on't need \\d{2} apples'''\nlines  = '''\nThe first newline is\ntrimmed in literal strings.\n   All other whitespace\n   is preserved.\n'''\n";
    const expected: any = {
      lines: "The first newline is\ntrimmed in literal strings.\n   All other whitespace\n   is preserved.\n",
      regex2: "I [dw]on't need \\d{2} apples",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-19", () => {
    const input: string =
      "quot15 = '''Here are fifteen quotation marks: \"\"\"\"\"\"\"\"\"\"\"\"\"\"\"'''\n\n# apos15 = '''Here are fifteen apostrophes: ''''''''''''''''''  # INVALID\napos15 = \"Here are fifteen apostrophes: '''''''''''''''\"\n\n# 'That,' she said, 'is still pointless.'\nstr = ''''That,' she said, 'is still pointless.''''\n";
    const expected: any = {
      apos15: "Here are fifteen apostrophes: '''''''''''''''",
      quot15: 'Here are fifteen quotation marks: """""""""""""""',
      str: "'That,' she said, 'is still pointless.'",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-20", () => {
    const input: string = "int1 = +99\nint2 = 42\nint3 = 0\nint4 = -17\n";
    const expected: any = { int1: 99, int2: 42, int3: 0, int4: -17 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-21", () => {
    const input: string =
      "int5 = 1_000\nint6 = 5_349_221\nint7 = 53_49_221  # Indian number system grouping\nint8 = 1_2_3_4_5  # VALID but discouraged\n";
    const expected: any = { int5: 1000, int6: 5349221, int7: 5349221, int8: 12345 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-22", () => {
    const input: string =
      "# hexadecimal with prefix `0x`\nhex1 = 0xDEADBEEF\nhex2 = 0xdeadbeef\nhex3 = 0xdead_beef\n\n# octal with prefix `0o`\noct1 = 0o01234567\noct2 = 0o755 # useful for Unix file permissions\n\n# binary with prefix `0b`\nbin1 = 0b11010110\n";
    const expected: any = {
      bin1: 214,
      hex1: 3735928559,
      hex2: 3735928559,
      hex3: 3735928559,
      oct1: 342391,
      oct2: 493,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-23", () => {
    const input: string =
      "# fractional\nflt1 = +1.0\nflt2 = 3.1415\nflt3 = -0.01\n\n# exponent\nflt4 = 5e+22\nflt5 = 1e06\nflt6 = -2E-2\n\n# both\nflt7 = 6.626e-34\n";
    const expected: any = {
      flt1: 1,
      flt2: 3.1415,
      flt3: -0.01,
      flt4: 5e22,
      flt5: 1000000,
      flt6: -0.02,
      flt7: 6.626e-34,
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-24", () => {
    const input: string = "flt8 = 224_617.445_991_228\n";
    const expected: any = { flt8: 224617.445991228 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-25", () => {
    const input: string =
      "# infinity\nsf1 = inf  # positive infinity\nsf2 = +inf # positive infinity\nsf3 = -inf # negative infinity\n\n# not a number\nsf4 = nan  # actual sNaN/qNaN encoding is implementation-specific\nsf5 = +nan # same as `nan`\nsf6 = -nan # valid, actual encoding is implementation-specific\n";
    const expected: any = { sf1: Infinity, sf2: Infinity, sf3: -Infinity, sf4: NaN, sf5: NaN, sf6: NaN };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-26", () => {
    const input: string = "bool1 = true\nbool2 = false\n";
    const expected: any = { bool1: true, bool2: false };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-27", () => {
    const input: string =
      "odt1 = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27T00:32:00-07:00\nodt3 = 1979-05-27T00:32:00.5-07:00\nodt4 = 1979-05-27T00:32:00.999-07:00\n";
    const expected: any = {
      odt1: dt("datetime", "1979-05-27T07:32:00Z"),
      odt2: dt("datetime", "1979-05-27T00:32:00-07:00"),
      odt3: dt("datetime", "1979-05-27T00:32:00.5-07:00"),
      odt4: dt("datetime", "1979-05-27T00:32:00.999-07:00"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-28", () => {
    const input: string = "odt4 = 1979-05-27 07:32:00Z\n";
    const expected: any = { odt4: dt("datetime", "1979-05-27T07:32:00Z") };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-29", () => {
    const input: string = "odt5 = 1979-05-27 07:32Z\nodt6 = 1979-05-27 07:32-07:00\n";
    const expected: any = {
      odt5: dt("datetime", "1979-05-27T07:32:00Z"),
      odt6: dt("datetime", "1979-05-27T07:32:00-07:00"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-3", () => {
    const input: string = 'key = "value"\nbare_key = "value"\nbare-key = "value"\n1234 = "value"\n';
    const expected: any = { "1234": "value", "bare-key": "value", bare_key: "value", key: "value" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-30", () => {
    const input: string = "ldt1 = 1979-05-27T07:32:00\nldt2 = 1979-05-27T07:32:00.5\nldt3 = 1979-05-27T00:32:00.999\n";
    const expected: any = {
      ldt1: dt("datetime-local", "1979-05-27T07:32:00"),
      ldt2: dt("datetime-local", "1979-05-27T07:32:00.5"),
      ldt3: dt("datetime-local", "1979-05-27T00:32:00.999"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-31", () => {
    const input: string = "ldt3 = 1979-05-27T07:32\n";
    const expected: any = { ldt3: dt("datetime-local", "1979-05-27T07:32:00") };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-32", () => {
    const input: string = "ld1 = 1979-05-27\n";
    const expected: any = { ld1: dt("date-local", "1979-05-27") };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-33", () => {
    const input: string = "lt1 = 07:32:00\nlt2 = 00:32:00.5\nlt3 = 00:32:00.999\n";
    const expected: any = {
      lt1: dt("time-local", "07:32:00"),
      lt2: dt("time-local", "00:32:00.5"),
      lt3: dt("time-local", "00:32:00.999"),
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-34", () => {
    const input: string = "lt3 = 07:32\n";
    const expected: any = { lt3: dt("time-local", "07:32:00") };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-35", () => {
    const input: string =
      'integers = [ 1, 2, 3 ]\ncolors = [ "red", "yellow", "green" ]\nnested_arrays_of_ints = [ [ 1, 2 ], [3, 4, 5] ]\nnested_mixed_array = [ [ 1, 2 ], ["a", "b", "c"] ]\nstring_array = [ "all", \'strings\', """are the same""", \'\'\'type\'\'\' ]\n\n# Mixed-type arrays are allowed\nnumbers = [ 0.1, 0.2, 0.5, 1, 2, 5 ]\ncontributors = [\n  "Foo Bar <foo@example.com>",\n  { name = "Baz Qux", email = "bazqux@example.com", url = "https://example.com/bazqux" }\n]\n';
    const expected: any = {
      colors: ["red", "yellow", "green"],
      contributors: [
        "Foo Bar <foo@example.com>",
        {
          email: "bazqux@example.com",
          name: "Baz Qux",
          url: "https://example.com/bazqux",
        },
      ],
      integers: [1, 2, 3],
      nested_arrays_of_ints: [
        [1, 2],
        [3, 4, 5],
      ],
      nested_mixed_array: [
        [1, 2],
        ["a", "b", "c"],
      ],
      numbers: [0.1, 0.2, 0.5, 1, 2, 5],
      string_array: ["all", "strings", "are the same", "type"],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-36", () => {
    const input: string = "integers2 = [\n  1, 2, 3\n]\n\nintegers3 = [\n  1,\n  2, # this is ok\n]\n";
    const expected: any = { integers2: [1, 2, 3], integers3: [1, 2] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-37", () => {
    const input: string = "[table]\n";
    const expected: any = { table: {} };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-38", () => {
    const input: string =
      '[table-1]\nkey1 = "some string"\nkey2 = 123\n\n[table-2]\nkey1 = "another string"\nkey2 = 456\n';
    const expected: any = {
      "table-1": { key1: "some string", key2: 123 },
      "table-2": { key1: "another string", key2: 456 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-39", () => {
    const input: string = '[dog."tater.man"]\ntype.name = "pug"\n';
    const expected: any = { dog: { "tater.man": { type: { name: "pug" } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-4", () => {
    const input: string =
      '"127.0.0.1" = "value"\n"character encoding" = "value"\n"ʎǝʞ" = "value"\n\'key2\' = "value"\n\'quoted "value"\' = "value"\n';
    const expected: any = {
      "127.0.0.1": "value",
      "character encoding": "value",
      key2: "value",
      'quoted "value"': "value",
      "ʎǝʞ": "value",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-40", () => {
    const input: string =
      "[a.b.c]            # this is best practice\n[ d.e.f ]          # same as [d.e.f]\n[ g .  h  . i ]    # same as [g.h.i]\n[ j . \"ʞ\" . 'l' ]  # same as [j.\"ʞ\".'l']\n";
    const expected: any = {
      a: { b: { c: {} } },
      d: { e: { f: {} } },
      g: { h: { i: {} } },
      j: { "ʞ": { l: {} } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-41", () => {
    const input: string =
      "# [x] you\n# [x.y] don't\n# [x.y.z] need these\n[x.y.z.w] # for this to work\n\n[x] # defining a super-table afterward is ok\n";
    const expected: any = { x: { y: { z: { w: {} } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-42", () => {
    const input: string = "# VALID BUT DISCOURAGED\n[fruit.apple]\n[animal]\n[fruit.orange]\n";
    const expected: any = { animal: {}, fruit: { apple: {}, orange: {} } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-43", () => {
    const input: string = "# RECOMMENDED\n[fruit.apple]\n[fruit.orange]\n[animal]\n";
    const expected: any = { animal: {}, fruit: { apple: {}, orange: {} } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-44", () => {
    const input: string =
      '# Top-level table begins.\nname = "Fido"\nbreed = "pug"\n\n# Top-level table ends.\n[owner]\nname = "Regina Dogman"\nmember_since = 1999-08-04\n';
    const expected: any = {
      breed: "pug",
      name: "Fido",
      owner: { member_since: dt("date-local", "1999-08-04"), name: "Regina Dogman" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-45", () => {
    const input: string =
      'fruit.apple.color = "red"\n# Defines a table named fruit\n# Defines a table named fruit.apple\n\nfruit.apple.taste.sweet = true\n# Defines a table named fruit.apple.taste\n# fruit and fruit.apple were already created\n';
    const expected: any = { fruit: { apple: { color: "red", taste: { sweet: true } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-46", () => {
    const input: string =
      '[fruit]\napple.color = "red"\napple.taste.sweet = true\n\n# [fruit.apple]  # INVALID\n# [fruit.apple.taste]  # INVALID\n\n[fruit.apple.texture]  # you can add sub-tables\nsmooth = true\n';
    const expected: any = {
      fruit: { apple: { color: "red", taste: { sweet: true }, texture: { smooth: true } } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-47", () => {
    const input: string =
      'name = { first = "Tom", last = "Preston-Werner" }\npoint = {x=1, y=2}\nanimal = { type.name = "pug" }\ncontact = {\n    personal = {\n        name = "Donald Duck",\n        email = "donald@duckburg.com",\n    },\n    work = {\n        name = "Coin cleaner",\n        email = "donald@ScroogeCorp.com",\n    },\n}\n';
    const expected: any = {
      animal: { type: { name: "pug" } },
      contact: {
        personal: { email: "donald@duckburg.com", name: "Donald Duck" },
        work: { email: "donald@ScroogeCorp.com", name: "Coin cleaner" },
      },
      name: { first: "Tom", last: "Preston-Werner" },
      point: { x: 1, y: 2 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-48", () => {
    const input: string =
      '[name]\nfirst = "Tom"\nlast = "Preston-Werner"\n\n[point]\nx = 1\ny = 2\n\n[animal]\ntype.name = "pug"\n\n[contact.personal]\nname = "Donald Duck"\nemail = "donald@duckburg.com"\n\n[contact.work]\nname = "Coin cleaner"\nemail = "donald@ScroogeCorp.com"\n';
    const expected: any = {
      animal: { type: { name: "pug" } },
      contact: {
        personal: { email: "donald@duckburg.com", name: "Donald Duck" },
        work: { email: "donald@ScroogeCorp.com", name: "Coin cleaner" },
      },
      name: { first: "Tom", last: "Preston-Werner" },
      point: { x: 1, y: 2 },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-49", () => {
    const input: string = '[product]\ntype = { name = "Nail" }\n# type.edible = false  # INVALID\n';
    const expected: any = { product: { type: { name: "Nail" } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-50", () => {
    const input: string = '[product]\ntype.name = "Nail"\n# type = { edible = false }  # INVALID\n';
    const expected: any = { product: { type: { name: "Nail" } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-51", () => {
    const input: string =
      '[[product]]\nname = "Hammer"\nsku = 738594937\n\n[[product]]  # empty table within the array\n\n[[product]]\nname = "Nail"\nsku = 284758393\n\ncolor = "gray"\n';
    const expected: any = {
      product: [{ name: "Hammer", sku: 738594937 }, {}, { color: "gray", name: "Nail", sku: 284758393 }],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-52", () => {
    const input: string =
      '[[fruits]]\nname = "apple"\n\n[fruits.physical]  # subtable\ncolor = "red"\nshape = "round"\n\n[[fruits.varieties]]  # nested array of tables\nname = "red delicious"\n\n[[fruits.varieties]]\nname = "granny smith"\n\n\n[[fruits]]\nname = "banana"\n\n[[fruits.varieties]]\nname = "plantain"\n';
    const expected: any = {
      fruits: [
        {
          name: "apple",
          physical: { color: "red", shape: "round" },
          varieties: [{ name: "red delicious" }, { name: "granny smith" }],
        },
        { name: "banana", varieties: [{ name: "plantain" }] },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-53", () => {
    const input: string =
      "points = [ { x = 1, y = 2, z = 3 },\n           { x = 7, y = 8, z = 9 },\n           { x = 2, y = 4, z = 8 } ]\n";
    const expected: any = {
      points: [
        { x: 1, y: 2, z: 3 },
        { x: 7, y: 8, z: 9 },
        { x: 2, y: 4, z: 8 },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-6", () => {
    const input: string =
      'name = "Orange"\nphysical.color = "orange"\nphysical.shape = "round"\nsite."google.com" = true\n';
    const expected: any = {
      name: "Orange",
      physical: { color: "orange", shape: "round" },
      site: { "google.com": true },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-7", () => {
    const input: string =
      'fruit.name = "banana"       # this is best practice\nfruit. color = "yellow"     # same as fruit.color\nfruit . flavor = "banana"   # same as fruit.flavor\n';
    const expected: any = { fruit: { color: "yellow", flavor: "banana", name: "banana" } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-8", () => {
    const input: string =
      '# This makes the key "fruit" into a table.\nfruit.apple.smooth = true\n\n# So then you can add to the table "fruit" like so:\nfruit.orange = 2\n';
    const expected: any = { fruit: { orange: 2, apple: { smooth: true } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-1.1.0/common-9", () => {
    const input: string =
      '# VALID BUT DISCOURAGED\n\napple.type = "fruit"\norange.type = "fruit"\n\napple.skin = "thin"\norange.skin = "thick"\n\napple.color = "red"\norange.color = "orange"\n';
    const expected: any = {
      apple: { color: "red", skin: "thin", type: "fruit" },
      orange: { color: "orange", skin: "thick", type: "fruit" },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-example-1-compact", () => {
    const input: string =
      '#Useless spaces eliminated.\ntitle="TOML Example"\n[owner]\nname="Lance Uppercut"\ndob=1979-05-27T07:32:00-08:00#First class dates\n[database]\nserver="192.168.1.1"\nports=[8001,8001,8002]\nconnection_max=5000\nenabled=true\n[servers]\n[servers.alpha]\nip="10.0.0.1"\ndc="eqdc10"\n[servers.beta]\nip="10.0.0.2"\ndc="eqdc10"\n[clients]\ndata=[["gamma","delta"],[1,2]]\nhosts=[\n"alpha",\n"omega"\n]\n';
    const expected: any = {
      title: "TOML Example",
      clients: {
        data: [
          ["gamma", "delta"],
          [1, 2],
        ],
        hosts: ["alpha", "omega"],
      },
      database: {
        connection_max: 5000,
        enabled: true,
        server: "192.168.1.1",
        ports: [8001, 8001, 8002],
      },
      owner: { dob: dt("datetime", "1979-05-27T07:32:00-08:00"), name: "Lance Uppercut" },
      servers: {
        alpha: { dc: "eqdc10", ip: "10.0.0.1" },
        beta: { dc: "eqdc10", ip: "10.0.0.2" },
      },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/spec-example-1", () => {
    const input: string =
      '# This is a TOML document. Boom.\n\ntitle = "TOML Example"\n\n[owner]\nname = "Lance Uppercut"\ndob = 1979-05-27T07:32:00-08:00 # First class dates? Why not?\n\n[database]\nserver = "192.168.1.1"\nports = [ 8001, 8001, 8002 ]\nconnection_max = 5000\nenabled = true\n\n[servers]\n\n  # You can indent as you please. Tabs or spaces. TOML don\'t care.\n  [servers.alpha]\n  ip = "10.0.0.1"\n  dc = "eqdc10"\n\n  [servers.beta]\n  ip = "10.0.0.2"\n  dc = "eqdc10"\n\n[clients]\ndata = [ ["gamma", "delta"], [1, 2] ]\n\n# Line breaks are OK when inside arrays\nhosts = [\n  "alpha",\n  "omega"\n]\n';
    const expected: any = {
      title: "TOML Example",
      clients: {
        data: [
          ["gamma", "delta"],
          [1, 2],
        ],
        hosts: ["alpha", "omega"],
      },
      database: {
        connection_max: 5000,
        enabled: true,
        server: "192.168.1.1",
        ports: [8001, 8001, 8002],
      },
      owner: { dob: dt("datetime", "1979-05-27T07:32:00-08:00"), name: "Lance Uppercut" },
      servers: {
        alpha: { dc: "eqdc10", ip: "10.0.0.1" },
        beta: { dc: "eqdc10", ip: "10.0.0.2" },
      },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/basic-escape-01", () => {
    const input: string = '# Escape "\ntest = "\\"one\\""\n';
    const expected: any = { test: '"one"' };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/basic-escape-02", () => {
    const input: string = '# Escape \\ and then "\ntest = "\\\\\\"one"\n';
    const expected: any = { test: '\\"one' };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/basic-escape-03", () => {
    const input: string = '# Escape \\ four times and then "\ntest = "\\\\\\\\\\\\\\\\\\"one"\n';
    const expected: any = { test: '\\\\\\\\"one' };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/empty", () => {
    const input: string = 'answer = ""\n';
    const expected: any = { answer: "" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/ends-in-whitespace-escape", () => {
    const input: string = 'beee = """\nheeee\ngeeee\\  \n\n\n      """\n';
    const expected: any = { beee: "heeee\ngeeee" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/escape-esc", () => {
    const input: string = 'esc = "\\e There is no escape! \\e"\n';
    const expected: any = { esc: "\u001b There is no escape! \u001b" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/escape-tricky", () => {
    const input: string =
      'end_esc = "String does not end here\\" but ends here\\\\"\nlit_end_esc = \'String ends here\\\'\n\nmultiline_unicode = """\n\\u00a0"""\n\nmultiline_not_unicode = """\n\\\\u0041"""\n\nmultiline_end_esc = """When will it end? \\"""...""\\" should be here\\""""\n\nlit_multiline_not_unicode = \'\'\'\n\\u007f\'\'\'\n\nlit_multiline_end = \'\'\'There is no escape\\\'\'\'\n';
    const expected: any = {
      end_esc: 'String does not end here" but ends here\\',
      lit_end_esc: "String ends here\\",
      lit_multiline_end: "There is no escape\\",
      lit_multiline_not_unicode: "\\u007f",
      multiline_end_esc: 'When will it end? """...""" should be here"',
      multiline_not_unicode: "\\u0041",
      multiline_unicode: " ",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/escaped-escape", () => {
    const input: string = 'answer = "\\\\x64"\n';
    const expected: any = { answer: "\\x64" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/escapes", () => {
    const input: string =
      'backspace     = "|\\b."\ntab           = "|\\t."\nnewline       = "|\\n."\nformfeed      = "|\\f."\ncarriage      = "|\\r."\nquote         = "|\\"."\nbackslash     = "|\\\\."\ndelete        = "|\\u007F."\nunitseparator = "|\\u001F."\n\n# \\u is escaped, so should NOT be interperted as a \\u escape.\nnotunicode1   = "|\\\\u."\nnotunicode2   = "|\\u005Cu."\nnotunicode3   = "|\\\\u0075."\nnotunicode4   = "|\\\\\\u0075."\n';
    const expected: any = {
      backslash: "|\\.",
      backspace: "|\b.",
      carriage: "|\r.",
      delete: "|\u007f.",
      formfeed: "|\f.",
      newline: "|\n.",
      notunicode1: "|\\u.",
      notunicode2: "|\\u.",
      notunicode3: "|\\u0075.",
      notunicode4: "|\\u.",
      quote: '|".',
      tab: "|\t.",
      unitseparator: "|\u001f.",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/hex-escape", () => {
    const input: string =
      '# \\x for the first 255 codepoints\n\nwhitespace      = "\\x20 \\x09 \\x1b \\x0d\\x0a"\nbs              = "\\x7f"\nnul             = "\\x00"\nhello           = "\\x68\\x65\\x6c\\x6c\\x6f\\x0a"\nhigher-than-127 = "S\\xf8rmirb\\xe6ren"\n\nmultiline = """\n\\x20 \\x09 \\x1b \\x0d\\x0a\n\\x7f\n\\x00\n\\x68\\x65\\x6c\\x6c\\x6f\\x0a\n\\x53\\xF8\\x72\\x6D\\x69\\x72\\x62\\xE6\\x72\\x65\\x6E\n"""\n\n# Not inside literals.\nliteral = \'\\x20 \\x09 \\x0d\\x0a\'\nmultiline-literal = \'\'\'\n\\x20 \\x09 \\x0d\\x0a\n\'\'\'\n';
    const expected: any = {
      bs: "\u007f",
      hello: "hello\n",
      "higher-than-127": "Sørmirbæren",
      literal: "\\x20 \\x09 \\x0d\\x0a",
      multiline: "  \t \u001b \r\n\n\u007f\n\u0000\nhello\n\nSørmirbæren\n",
      "multiline-literal": "\\x20 \\x09 \\x0d\\x0a\n",
      nul: "\u0000",
      whitespace: "  \t \u001b \r\n",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multibyte-escape", () => {
    const input: string =
      '# Test each multibyte length: 2, 3, and 4 bytes:\n# ɑ € 𐫱\n\nbasic-1    = "\\u0251 \\u20ac \\U00010AF1 \\u0251\\u20ac\\U00010AF1"\nml-basic-1 = """\\u0251 \\u20ac \\U00010AF1 \\u0251\\u20ac\\U00010AF1"""\n\n# Again, but only using \\U\nbasic-2    = "\\U00000251 \\U000020ac \\U00010AF1 \\U00000251\\U000020ac\\U00010AF1"\nml-basic-2 = """\\U00000251 \\U000020ac \\U00010AF1 \\U00000251\\U000020ac\\U00010AF1"""\n';
    const expected: any = {
      "basic-1": "ɑ € 𐫱 ɑ€𐫱",
      "ml-basic-1": "ɑ € 𐫱 ɑ€𐫱",
      "basic-2": "ɑ € 𐫱 ɑ€𐫱",
      "ml-basic-2": "ɑ € 𐫱 ɑ€𐫱",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multibyte", () => {
    const input: string =
      "# Test each multibyte length: 2, 3, and 4 bytes:\n# ɑ € 𐫱\n\nbasic    = \"ɑ € 𐫱 ɑ€𐫱\"\nraw      = 'ɑ € 𐫱 ɑ€𐫱'\nml-basic = \"\"\"ɑ € 𐫱 ɑ€𐫱\"\"\"\nml-raw   = '''ɑ € 𐫱 ɑ€𐫱'''\n";
    const expected: any = {
      basic: "ɑ € 𐫱 ɑ€𐫱",
      "ml-basic": "ɑ € 𐫱 ɑ€𐫱",
      "ml-raw": "ɑ € 𐫱 ɑ€𐫱",
      raw: "ɑ € 𐫱 ɑ€𐫱",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multiline-empty", () => {
    const input: string =
      'empty-1 = """"""\n\n# A newline immediately following the opening delimiter will be trimmed.\nempty-2 = """\n"""\n\n# \\ at the end of line trims newlines as well; note that last \\ is followed by\n# two spaces, which are ignored.\nempty-3 = """\\\n    """\nempty-4 = """\\\n   \\\n   \\  \n   """\n\n';
    const expected: any = { "empty-1": "", "empty-2": "", "empty-3": "", "empty-4": "" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multiline-escaped-crlf", () => {
    const input: string =
      '# The following line should be an unescaped backslash followed by a Windows\r\n# newline sequence ("\\r\\n")\r\n0="""\\\r\n"""\r\n';
    const expected: any = { "0": "" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multiline-quotes", () => {
    const input: string =
      '# Make sure that quotes inside multiline strings are allowed, including right\n# after the opening \'\'\'/""" and before the closing \'\'\'/"""\n\nlit_one = \'\'\'\'one quote\'\'\'\'\nlit_two = \'\'\'\'\'two quotes\'\'\'\'\'\nlit_one_space = \'\'\' \'one quote\' \'\'\'\nlit_two_space = \'\'\' \'\'two quotes\'\' \'\'\'\n\none = """"one quote""""\ntwo = """""two quotes"""""\none_space = """ "one quote" """\ntwo_space = """ ""two quotes"" """\n\nmismatch1 = """aaa\'\'\'bbb"""\nmismatch2 = \'\'\'aaa"""bbb\'\'\'\n\n# Three opening """, then one escaped ", then two "" (allowed), and then three\n# closing """\nescaped = """lol\\""""""\n\nfive-quotes = """\nClosing with five quotes\n"""""\nfour-quotes = """\nClosing with four quotes\n""""\n';
    const expected: any = {
      escaped: 'lol"""',
      "five-quotes": 'Closing with five quotes\n""',
      "four-quotes": 'Closing with four quotes\n"',
      lit_one: "'one quote'",
      lit_one_space: " 'one quote' ",
      lit_two: "''two quotes''",
      lit_two_space: " ''two quotes'' ",
      mismatch1: "aaa'''bbb",
      mismatch2: 'aaa"""bbb',
      one: '"one quote"',
      one_space: ' "one quote" ',
      two: '""two quotes""',
      two_space: ' ""two quotes"" ',
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/multiline", () => {
    const input: string =
      '# NOTE: this file includes some literal tab characters.\n\nequivalent_one = "The quick brown fox jumps over the lazy dog."\nequivalent_two = """\nThe quick brown \\\n\n\n  fox jumps over \\\n    the lazy dog."""\n\nequivalent_three = """\\\n       The quick brown \\\n       fox jumps over \\\n       the lazy dog.\\\n       """\n\nwhitespace-after-bs = """\\\n       The quick brown \\\n       fox jumps over \\   \n       the lazy dog.\\\t\n       """\n\nno-space = """a\\\n    b"""\n\n# Has tab character.\nkeep-ws-before = """a   \t\\\n   b"""\n\nescape-bs-1 = """a \\\\\nb"""\n\nescape-bs-2 = """a \\\\\\\nb"""\n\nescape-bs-3 = """a \\\\\\\\\n  b"""\n';
    const expected: any = {
      equivalent_one: "The quick brown fox jumps over the lazy dog.",
      equivalent_three: "The quick brown fox jumps over the lazy dog.",
      equivalent_two: "The quick brown fox jumps over the lazy dog.",
      "escape-bs-1": "a \\\nb",
      "escape-bs-2": "a \\b",
      "escape-bs-3": "a \\\\\n  b",
      "keep-ws-before": "a   \tb",
      "no-space": "ab",
      "whitespace-after-bs": "The quick brown fox jumps over the lazy dog.",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/nl", () => {
    const input: string =
      "nl_mid = \"val\\nue\"\nnl_end = \"\"\"value\\n\"\"\"\n\nlit_nl_end = '''value\\n'''\nlit_nl_mid = 'val\\nue'\nlit_nl_uni = 'val\\ue'\n";
    const expected: any = {
      lit_nl_end: "value\\n",
      lit_nl_mid: "val\\nue",
      lit_nl_uni: "val\\ue",
      nl_end: "value\n",
      nl_mid: "val\nue",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/quoted-unicode", () => {
    const input: string =
      "\nescaped_string = \"\\u0000 \\u0008 \\u000c \\U00000041 \\u007f \\u0080 \\u00ff \\ud7ff \\ue000 \\uffff \\U00010000 \\U0010ffff\"\nnot_escaped_string = '\\u0000 \\u0008 \\u000c \\U00000041 \\u007f \\u0080 \\u00ff \\ud7ff \\ue000 \\uffff \\U00010000 \\U0010ffff'\n\nbasic_string = \"~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿\"\nliteral_string = '~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿'\n";
    const expected: any = {
      basic_string: "~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿",
      escaped_string: "\u0000 \b \f A \u007f \u0080 ÿ ퟿  ￿ 𐀀 􏿿",
      literal_string: "~ \u0080 ÿ ퟿  ￿ 𐀀 􏿿",
      not_escaped_string:
        "\\u0000 \\u0008 \\u000c \\U00000041 \\u007f \\u0080 \\u00ff \\ud7ff \\ue000 \\uffff \\U00010000 \\U0010ffff",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/raw-empty", () => {
    const input: string = "empty = ''\n";
    const expected: any = { empty: "" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/raw-multiline", () => {
    const input: string =
      "# Single ' should be allowed.\noneline = '''This string has a ' quote character.'''\n\n# A newline immediately following the opening delimiter will be trimmed.\nfirstnl = '''\nThis string has a ' quote character.'''\n\n# All other whitespace and newline characters remain intact.\nmultiline = '''\nThis string\nhas ' a quote character\nand more than\none newline\nin it.'''\n\n# Tab character in literal string does not need to be escaped\nmultiline_with_tab = '''First line\n\t Followed by a tab'''\n\nthis-str-has-apostrophes='''' there's one already\n'' two more\n'''''\n";
    const expected: any = {
      firstnl: "This string has a ' quote character.",
      multiline: "This string\nhas ' a quote character\nand more than\none newline\nin it.",
      multiline_with_tab: "First line\n\t Followed by a tab",
      oneline: "This string has a ' quote character.",
      "this-str-has-apostrophes": "' there's one already\n'' two more\n''",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/raw", () => {
    const input: string =
      "backspace = 'This string has a \\b backspace character.'\ntab = 'This string has a \\t tab character.'\nunescaped_tab = 'This string has an \t unescaped tab character.'\nnewline = 'This string has a \\n new line character.'\nformfeed = 'This string has a \\f form feed character.'\ncarriage = 'This string has a \\r carriage return character.'\nslash = 'This string has a \\/ slash character.'\nbackslash = 'This string has a \\\\ backslash character.'\n";
    const expected: any = {
      backslash: "This string has a \\\\ backslash character.",
      backspace: "This string has a \\b backspace character.",
      carriage: "This string has a \\r carriage return character.",
      formfeed: "This string has a \\f form feed character.",
      newline: "This string has a \\n new line character.",
      slash: "This string has a \\/ slash character.",
      tab: "This string has a \\t tab character.",
      unescaped_tab: "This string has an \t unescaped tab character.",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/simple", () => {
    const input: string = 'answer = "You are not drinking enough whisky."\n';
    const expected: any = { answer: "You are not drinking enough whisky." };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/start-mb", () => {
    const input: string =
      '# Start first line with a multibyte character.\n#\n# https://github.com/marzer/tomlplusplus/issues/190\ns1 = "§"\ns2 = \'§\'\ns3 = """\\\n§"""\ns4 = """\n§"""\ns5 = """§"""\ns6 = \'\'\'\n§\'\'\'\ns7 = \'\'\'§\'\'\'\n';
    const expected: any = { s1: "§", s2: "§", s3: "§", s4: "§", s5: "§", s6: "§", s7: "§" };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/unicode-escape", () => {
    const input: string =
      'delta-1 = "\\u03B4"\ndelta-2 = "\\U000003B4"\na       = "\\u0061"\nb       = "\\u0062"\nc       = "\\U00000063"\nnull-1  = "\\u0000"\nnull-2  = "\\U00000000"\n\nml-delta-1 = """\\u03B4"""\nml-delta-2 = """\\U000003B4"""\nml-a       = """\\u0061"""\nml-b       = """\\u0062"""\nml-c       = """\\U00000063"""\nml-null-1  = """\\u0000"""\nml-null-2  = """\\U00000000"""\n';
    const expected: any = {
      a: "a",
      b: "b",
      c: "c",
      "delta-1": "δ",
      "delta-2": "δ",
      "ml-a": "a",
      "ml-b": "b",
      "ml-c": "c",
      "ml-delta-1": "δ",
      "ml-delta-2": "δ",
      "ml-null-1": "\u0000",
      "ml-null-2": "\u0000",
      "null-1": "\u0000",
      "null-2": "\u0000",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/string/with-pound", () => {
    const input: string =
      'pound = "We see no # comments here."\npoundcomment = "But there are # some comments here." # Did I # mess you up?\n';
    const expected: any = {
      pound: "We see no # comments here.",
      poundcomment: "But there are # some comments here.",
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-empty-name", () => {
    const input: string = "# Silly thing to do, but valid.\n\n[['']]\na = 1\n[['']]\na = 2\n";
    const expected: any = { "": [{ a: 1 }, { a: 2 }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-empty", () => {
    const input: string = "[[a]]\n";
    const expected: any = { a: [{}] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-implicit-and-explicit-after", () => {
    const input: string = "[[a.b]]\nx = 1\n\n[a]\ny = 2\n";
    const expected: any = { a: { b: [{ x: 1 }], y: 2 } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-implicit", () => {
    const input: string = '[[albums.songs]]\nname = "Glory Days"\n';
    const expected: any = { albums: { songs: [{ name: "Glory Days" }] } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-many", () => {
    const input: string =
      '[[people]]\nfirst_name = "Bruce"\nlast_name = "Springsteen"\n\n[[people]]\nfirst_name = "Eric"\nlast_name = "Clapton"\n\n[[people]]\nfirst_name = "Bob"\nlast_name = "Seger"\n';
    const expected: any = {
      people: [
        { first_name: "Bruce", last_name: "Springsteen" },
        { first_name: "Eric", last_name: "Clapton" },
        { first_name: "Bob", last_name: "Seger" },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-nest", () => {
    const input: string =
      '[[albums]]\nname = "Born to Run"\n\n  [[albums.songs]]\n  name = "Jungleland"\n\n  [[albums.songs]]\n  name = "Meeting Across the River"\n\n[[albums]]\nname = "Born in the USA"\n  \n  [[albums.songs]]\n  name = "Glory Days"\n\n  [[albums.songs]]\n  name = "Dancing in the Dark"\n';
    const expected: any = {
      albums: [
        {
          name: "Born to Run",
          songs: [{ name: "Jungleland" }, { name: "Meeting Across the River" }],
        },
        {
          name: "Born in the USA",
          songs: [{ name: "Glory Days" }, { name: "Dancing in the Dark" }],
        },
      ],
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-one", () => {
    const input: string = '[[people]]\nfirst_name = "Bruce"\nlast_name = "Springsteen"\n';
    const expected: any = { people: [{ first_name: "Bruce", last_name: "Springsteen" }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-table-array", () => {
    const input: string =
      '[[a]]\n    [[a.b]]\n        [a.b.c]\n            d = "val0"\n    [[a.b]]\n        [a.b.c]\n            d = "val1"\n';
    const expected: any = { a: [{ b: [{ c: { d: "val0" } }, { c: { d: "val1" } }] }] };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/array-within-dotted", () => {
    const input: string = '[fruit]\napple.color = "red"\n\n[[fruit.apple.seeds]]\nsize = 2\n';
    const expected: any = { fruit: { apple: { color: "red", seeds: [{ size: 2 }] } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/empty-name", () => {
    const input: string = "['']\nx = 1\n\n[\"\".a]\nx = 2\n\n[a.'']\nx = 3\n";
    const expected: any = { "": { x: 1, a: { x: 2 } }, a: { "": { x: 3 } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/empty", () => {
    const input: string = "[a]\n";
    const expected: any = { a: {} };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/keyword-with-values", () => {
    const input: string = "[true]\nk = 1\n\n[false]\nk = 2\n\n[inf]\nk = 3\n\n[nan]\nk = 4\n";
    const expected: any = { false: { k: 2 }, inf: { k: 3 }, nan: { k: 4 }, true: { k: 1 } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/keyword", () => {
    const input: string = "[true]\n\n[false]\n\n[inf]\n\n[nan]\n\n\n";
    const expected: any = { false: {}, inf: {}, nan: {}, true: {} };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/names-with-values", () => {
    const input: string =
      "[a.b.c]\nkey = 1\n\n[a.\"b.c\"]\nkey = 2\n\n[a.'d.e']\nkey = 3\n\n[a.' x ']\nkey = 4\n\n[ d.e.f ]\nkey = 5\n\n[ g . h . i ]\nkey = 6\n\n[ j . \"ʞ\" . 'l' ]\nkey = 7\n\n[x.1.2]\nkey = 8\n";
    const expected: any = {
      a: {
        " x ": { key: 4 },
        b: { c: { key: 1 } },
        "b.c": { key: 2 },
        "d.e": { key: 3 },
      },
      d: { e: { f: { key: 5 } } },
      g: { h: { i: { key: 6 } } },
      j: { "ʞ": { l: { key: 7 } } },
      x: { "1": { "2": { key: 8 } } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/names", () => {
    const input: string =
      "[a.b.c]\n[a.\"b.c\"]\n[a.'d.e']\n[a.' x ']\n[ d.e.f ]\n[ g . h . i ]\n[ j . \"ʞ\" . 'l' ]\n\n[x.1.2]\n";
    const expected: any = {
      a: { " x ": {}, "b.c": {}, "d.e": {}, b: { c: {} } },
      d: { e: { f: {} } },
      g: { h: { i: {} } },
      j: { "ʞ": { l: {} } },
      x: { "1": { "2": {} } },
    };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/no-eol-01", () => {
    const input: string = "# No newline at end of file.\n[table]";
    const expected: any = { table: {} };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/no-eol-02", () => {
    const input: string = "# No newline at end of file.\n[table]\na=1";
    const expected: any = { table: { a: 1 } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/sub-empty", () => {
    const input: string = "[a]\n[a.b]\n";
    const expected: any = { a: { b: {} } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/sub", () => {
    const input: string =
      '[a]\nkey = 1\n\n# a.extend is a key inside the "a" table.\n[a.extend]\nkey = 2\n\n[a.extend.more]\nkey = 3\n';
    const expected: any = { a: { key: 1, extend: { key: 2, more: { key: 3 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/whitespace", () => {
    const input: string = '["valid key"]\n';
    const expected: any = { "valid key": {} };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/with-literal-string", () => {
    const input: string = "['a']\n[a.'\"b\"']\n[a.'\"b\"'.c]\nanswer = 42 \n";
    const expected: any = { a: { '"b"': { c: { answer: 42 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/with-pound", () => {
    const input: string = '["key#group"]\nanswer = 42\n';
    const expected: any = { "key#group": { answer: 42 } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/with-single-quotes", () => {
    const input: string = "['a']\n[a.'b']\n[a.'b'.c]\nanswer = 42 \n";
    const expected: any = { a: { b: { c: { answer: 42 } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/without-super-with-values", () => {
    const input: string =
      "# [x] you\n# [x.y] don't\n# [x.y.z] need these\n[x.y.z.w] # for this to work\na = 1\nb = 2\n[x] # defining a super-table afterwards is ok\nc = 3\nd = 4\n";
    const expected: any = { x: { c: 3, d: 4, y: { z: { w: { a: 1, b: 2 } } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/table/without-super", () => {
    const input: string =
      "# [x] you\n# [x.y] don't\n# [x.y.z] need these\n[x.y.z.w] # for this to work\n[x] # defining a super-table afterwards is ok\n";
    const expected: any = { x: { y: { z: { w: {} } } } };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/utf8-bom-01", () => {
    const input: string =
      "\ufeff# This file starts with an UTF-8 BOM (\\xEF\\xBB\\xBF), which isn't recommended to use but valid.\na=1\n";
    const expected: any = { a: 1 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });

  test("valid/utf8-bom-02", () => {
    const input: string =
      "\ufeffa=1# This file starts with an UTF-8 BOM (\\xEF\\xBB\\xBF), which isn't recommended to use but valid.\n";
    const expected: any = { a: 1 };
    expectTomlEqual(TOML.parse(input), expected);
    expectTomlEqual(TOML.parse(TOML.stringify(TOML.parse(input))), expected);
  });
});

// Upstream marks these valid, asserting exact 64-bit integers, which JS
// numbers cannot represent. Bun rejects integers outside Number.MAX_SAFE_INTEGER
// instead of returning corrupted values or mixed number/BigInt types; the
// 64-bit range is a "should" in the spec (toml-lang/toml-test#154).
describe("toml-test/valid-out-of-range-integer", () => {
  test("valid/integer/long", () => {
    const input: string =
      '# int64 "should" be supported, but is not mandatory. It\'s fine to skip this\n# test.\nint64-max     = 9223372036854775807\nint64-max-neg = -9223372036854775808\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Integer cannot be losslessly represented as a JavaScript number; it must be within +/-(2^53 - 1)",
    );
  });
});

describe("toml-test/invalid", () => {
  test("invalid/array/double-comma-01", () => {
    const input: string = "double-comma-01 = [1,,2]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found ','");
  });

  test("invalid/array/double-comma-02", () => {
    const input: string = "double-comma-02 = [1,2,,]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found ','");
  });

  test("invalid/array/extend-defined-aot", () => {
    const input: string = "[[tab.arr]]\n[tab]\narr.val1=1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'arr'");
  });

  test("invalid/array/extending-table", () => {
    const input: string =
      "a = [{ b = 1 }]\n\n# Cannot extend tables within static arrays\n# https://github.com/toml-lang/toml/issues/908\n[a.c]\nfoo = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend array 'a'");
  });

  test("invalid/array/missing-separator-01", () => {
    const input: string = "arrr = [true false]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or ']' in an array but found 'f'");
  });

  test("invalid/array/missing-separator-02", () => {
    const input: string = "wrong = [ 1 2 3 ]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or ']' in an array but found '2'");
  });

  test("invalid/array/no-close-01", () => {
    const input: string = "no-close-01 = [ 1, 2, 3\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or ']' in an array but found end of file",
    );
  });

  test("invalid/array/no-close-02", () => {
    const input: string = "no-close-02 = [1,\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated array; expected ']'");
  });

  test("invalid/array/no-close-03", () => {
    const input: string = "no-close-03 = [42 #]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or ']' in an array but found end of file",
    );
  });

  test("invalid/array/no-close-04", () => {
    const input: string = "no-close-04 = [{ key = 42\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or '}' in an inline table but found end of file",
    );
  });

  test("invalid/array/no-close-05", () => {
    const input: string = "no-close-05 = [{ key = 42}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or ']' in an array but found end of file",
    );
  });

  test("invalid/array/no-close-06", () => {
    const input: string = "no-close-06 = [{ key = 42 #}]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or '}' in an inline table but found end of file",
    );
  });

  test("invalid/array/no-close-07", () => {
    const input: string = "no-close-07 = [{ key = 42} #]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or ']' in an array but found end of file",
    );
  });

  test("invalid/array/no-close-08", () => {
    const input: string = "no-close-08 = [\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated array; expected ']'");
  });

  test("invalid/array/no-close-table-01", () => {
    const input: string = "no-close-table-01 = [{ key = 42\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or '}' in an inline table but found end of file",
    );
  });

  test("invalid/array/no-close-table-02", () => {
    const input: string = "no-close-table-02 = [{ key = 42 #\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or '}' in an inline table but found end of file",
    );
  });

  test("invalid/array/no-close-table-03", () => {
    const input: string = "no-close-table-03 = [1,{a=1]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or '}' in an inline table but found ']'");
  });

  test("invalid/array/no-close-table-04", () => {
    const input: string = "no-close-table-04 = [1,{2]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found ']'");
  });

  test("invalid/array/no-comma-01", () => {
    const input: string = "no-comma-01 = [true false]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or ']' in an array but found 'f'");
  });

  test("invalid/array/no-comma-02", () => {
    const input: string = "no-comma-02 = [ 1 2 3 ]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or ']' in an array but found '2'");
  });

  test("invalid/array/no-comma-03", () => {
    const input: string = "no-comma-03 = [ 1 #,]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or ']' in an array but found end of file",
    );
  });

  test("invalid/array/only-comma-01", () => {
    const input: string = "only-comma-01 = [,]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found ','");
  });

  test("invalid/array/only-comma-02", () => {
    const input: string = "only-comma-02 = [,,]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found ','");
  });

  test("invalid/array/tables-01", () => {
    const input: string = "# INVALID TOML DOC\nfruit = []\n\n[[fruit]] # Not allowed\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend array 'fruit'");
  });

  test("invalid/array/tables-02", () => {
    const input: string =
      '# INVALID TOML DOC\n[[fruit]]\n  name = "apple"\n\n  [[fruit.variety]]\n    name = "red delicious"\n\n  # This table conflicts with the previous table\n  [fruit.variety]\n    name = "granny smith"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine array of tables 'variety' as a table");
  });

  test("invalid/array/text-after-array-entries", () => {
    const input: string = 'array = [\n  "Is there life after an array separator?", No\n  "Entry"\n]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "No"');
  });

  test("invalid/array/text-before-array-separator", () => {
    const input: string = 'array = [\n  "Is there life before an array separator?" No,\n  "Entry"\n]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or ']' in an array but found 'N'");
  });

  test("invalid/array/text-in-array", () => {
    const input: string = 'array = [\n  "Entry 1",\n  I don\'t belong,\n  "Entry 2",\n]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "I"');
  });

  test("invalid/bool/almost-false-with-extra", () => {
    const input: string = "almost-false-with-extra = falsify\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "falsify"');
  });

  test("invalid/bool/almost-false", () => {
    const input: string = "almost-false            = fals\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "fals"');
  });

  test("invalid/bool/almost-true-with-extra", () => {
    const input: string = "almost-true-with-extra  = truthy\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "truthy"');
  });

  test("invalid/bool/almost-true", () => {
    const input: string = "almost-true             = tru\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "tru"');
  });

  test("invalid/bool/capitalized-false", () => {
    const input: string = "capitalized-false        = False\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "False"');
  });

  test("invalid/bool/capitalized-true", () => {
    const input: string = "capitalized-true         = True\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "True"');
  });

  test("invalid/bool/just-f", () => {
    const input: string = "just-f                  = f\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "f"');
  });

  test("invalid/bool/just-t", () => {
    const input: string = "just-t                  = t\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "t"');
  });

  test("invalid/bool/mixed-case-false", () => {
    const input: string = "mixed-case-false        = falsE\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "falsE"');
  });

  test("invalid/bool/mixed-case-true", () => {
    const input: string = "mixed-case-true         = trUe\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "trUe"');
  });

  test("invalid/bool/mixed-case", () => {
    const input: string = "mixed-case              = valid   = False\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "valid"');
  });

  test("invalid/bool/starting-same-false", () => {
    const input: string = "starting-same-false     = falsey\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "falsey"');
  });

  test("invalid/bool/starting-same-true", () => {
    const input: string = "starting-same-true      = truer\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "truer"');
  });

  test("invalid/bool/wrong-case-false", () => {
    const input: string = "wrong-case-false        = FALSE\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "FALSE"');
  });

  test("invalid/bool/wrong-case-true", () => {
    const input: string = "wrong-case-true         = TRUE\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "TRUE"');
  });

  test("invalid/control/bare-cr", () => {
    const input: string = "# The following line contains a single carriage return control character\r\n\r";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/bare-formfeed", () => {
    const input: string = "bare-formfeed     = \f\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0x0C)");
  });

  test("invalid/control/bare-null", () => {
    const input: string = 'bare-null         = "some value" \u0000\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/control/bare-vertical-tab", () => {
    const input: string = "bare-vertical-tab = \u000b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0x0B)");
  });

  test("invalid/control/comment-cr", () => {
    const input: string = 'comment-cr   = "Carriage return in comment" # \ra=1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/comment-del", () => {
    const input: string = 'comment-del  = "0x7f"   # \u007f\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a comment: (0x7F)",
    );
  });

  test("invalid/control/comment-ff", () => {
    const input: string = 'comment-ff   = "0x7f"   # \f\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a comment: (0x0C)",
    );
  });

  test("invalid/control/comment-lf", () => {
    const input: string = 'comment-lf   = "ctrl-P" # \u0010\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a comment: (0x10)",
    );
  });

  test("invalid/control/comment-null", () => {
    const input: string = 'comment-null = "null"   # \u0000\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a comment: (0x00)",
    );
  });

  test("invalid/control/comment-us", () => {
    const input: string = 'comment-us   = "ctrl-_" # \u001f\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a comment: (0x1F)",
    );
  });

  test("invalid/control/linetab-number-01", () => {
    const input: string = "linetab-number-01 = 1\u000b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0x0B)");
  });

  test("invalid/control/linetab-number-02", () => {
    const input: string = "linetab-number-02 = 1.5\u000b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0x0B)");
  });

  test("invalid/control/linetab-number-03", () => {
    const input: string = "linetab-number-03 = 0xff\u000b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0x0B)");
  });

  test("invalid/control/linetab-number-04", () => {
    const input: string = "linetab-number-04 = +inf\u000b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0x0B)");
  });

  test("invalid/control/multi-cr", () => {
    const input: string = 'multi-cr   = """null\r"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/multi-del", () => {
    const input: string = 'multi-del  = """null\u007f"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x7F)",
    );
  });

  test("invalid/control/multi-lf", () => {
    const input: string = 'multi-lf   = """null\u0010"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x10)",
    );
  });

  test("invalid/control/multi-null", () => {
    const input: string = 'multi-null = """null\u0000"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x00)",
    );
  });

  test("invalid/control/multi-us", () => {
    const input: string = 'multi-us   = """null\u001f"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x1F)",
    );
  });

  test("invalid/control/only-ff", () => {
    const input: string = "\f";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0C)");
  });

  test("invalid/control/only-null", () => {
    const input: string = "\u0000";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x00)");
  });

  test("invalid/control/only-vt", () => {
    const input: string = "\u000b";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0B)");
  });

  test("invalid/control/rawmulti-cr", () => {
    const input: string = "rawmulti-cr   = '''null\r'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/rawmulti-del", () => {
    const input: string = "rawmulti-del  = '''null\u007f'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x7F)",
    );
  });

  test("invalid/control/rawmulti-lf", () => {
    const input: string = "rawmulti-lf   = '''null\u0010'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x10)",
    );
  });

  test("invalid/control/rawmulti-null", () => {
    const input: string = "rawmulti-null = '''null\u0000'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x00)",
    );
  });

  test("invalid/control/rawmulti-us", () => {
    const input: string = "rawmulti-us   = '''null\u001f'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x1F)",
    );
  });

  test("invalid/control/rawstring-cr", () => {
    const input: string = "rawstring-cr   = 'null\r'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/rawstring-del", () => {
    const input: string = "rawstring-del  = 'null\u007f'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x7F)",
    );
  });

  test("invalid/control/rawstring-lf", () => {
    const input: string = "rawstring-lf   = 'null\u0010'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x10)",
    );
  });

  test("invalid/control/rawstring-null", () => {
    const input: string = "rawstring-null = 'null\u0000'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x00)",
    );
  });

  test("invalid/control/rawstring-us", () => {
    const input: string = "rawstring-us   = 'null\u001f'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character is not allowed in a literal string: (0x1F)",
    );
  });

  test("invalid/control/string-bs", () => {
    const input: string = 'string-bs   = "backspace\b"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x08)",
    );
  });

  test("invalid/control/string-cr", () => {
    const input: string = 'string-cr   = "null\r"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Bare carriage return is not allowed; use \\r\\n or \\n",
    );
  });

  test("invalid/control/string-del", () => {
    const input: string = 'string-del  = "null\u007f"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x7F)",
    );
  });

  test("invalid/control/string-lf", () => {
    const input: string = 'string-lf   = "null\u0010"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x10)",
    );
  });

  test("invalid/control/string-null", () => {
    const input: string = 'string-null = "null\u0000"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x00)",
    );
  });

  test("invalid/control/string-us", () => {
    const input: string = 'string-us   = "null\u001f"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Control character must be escaped in a string: (0x1F)",
    );
  });

  test("invalid/datetime/day-zero", () => {
    const input: string = "foo = 1997-09-00T09:09:09.09Z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/datetime/feb-29", () => {
    const input: string = '"not a leap year" = 2100-02-29T15:15:15Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/datetime/feb-30", () => {
    const input: string = '"only 28 or 29 days in february" = 1988-02-30T15:15:15Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/datetime/hour-over", () => {
    const input: string = "# time-hour       = 2DIGIT  ; 00-23\nd = 2006-01-01T24:00:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: hours must be between 00 and 23");
  });

  test("invalid/datetime/leading-zero-date", () => {
    const input: string = "# No leading zero on year allowed.\nd = 02026-05-07\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/datetime/leading-zero-datetime", () => {
    const input: string = "# No leading zero on year allowed.\nd = 02026-05-07T14:15:16Z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/datetime/mday-over", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-32T00:00:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/datetime/mday-under", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-00T00:00:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/datetime/minute-over", () => {
    const input: string = "# time-minute     = 2DIGIT  ; 00-59\nd = 2006-01-01T00:60:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: minutes must be between 00 and 59");
  });

  test("invalid/datetime/month-over", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2006-13-01T00:00:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/datetime/month-under", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2007-00-01T00:00:00-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/datetime/no-date-time-sep", () => {
    const input: string = "foo = 1997-09-0909:09:09\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '0'");
  });

  test("invalid/datetime/no-leads-month", () => {
    const input: string =
      '# Month "7" instead of "07"; the leading zero is required.\nno-leads = 1987-7-05T17:45:00Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit month");
  });

  test("invalid/datetime/no-leads-with-milli", () => {
    const input: string =
      '# Day "5" instead of "05"; the leading zero is required.\nwith-milli = 1987-07-5T17:45:00.12Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit day");
  });

  test("invalid/datetime/no-leads", () => {
    const input: string =
      '# Month "7" instead of "07"; the leading zero is required.\nno-leads = 1987-7-05T17:45:00Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit month");
  });

  test("invalid/datetime/no-t", () => {
    const input: string = '# No "t" or "T" between the date and time.\nno-t = 1987-07-0517:45:00Z\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '1'");
  });

  test("invalid/datetime/no-year-month-sep", () => {
    const input: string = "foo = 199709-09\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/datetime/offset-minus-minute-1digit", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+09:9\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date-time offset: expected 2-digit minutes");
  });

  test("invalid/datetime/offset-minus-no-hour-minute-sep", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+0909\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: expected ':' between hours and minutes",
    );
  });

  test("invalid/datetime/offset-minus-no-hour-minute", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date-time offset: expected 2-digit hours");
  });

  test("invalid/datetime/offset-minus-no-minute", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+09\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: expected ':' between hours and minutes",
    );
  });

  test("invalid/datetime/offset-overflow-hour", () => {
    const input: string = "# Hour must be 00-24\nd = 1985-06-18 17:04:07+25:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: hours must be between 00 and 23",
    );
  });

  test("invalid/datetime/offset-overflow-minute", () => {
    const input: string = "d = 1985-06-18 17:04:07+12:60\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: minutes must be between 00 and 59",
    );
  });

  test("invalid/datetime/offset-plus-minute-1digit", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+09:9\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date-time offset: expected 2-digit minutes");
  });

  test("invalid/datetime/offset-plus-no-hour-minute-sep", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+0909\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: expected ':' between hours and minutes",
    );
  });

  test("invalid/datetime/offset-plus-no-hour-minute", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date-time offset: expected 2-digit hours");
  });

  test("invalid/datetime/offset-plus-no-minute", () => {
    const input: string = "foo = 1997-09-09T09:09:09.09+09\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid date-time offset: expected ':' between hours and minutes",
    );
  });

  test("invalid/datetime/only-T", () => {
    const input: string = "foo = T\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "T"');
  });

  test("invalid/datetime/only-TZ", () => {
    const input: string = "foo = TZ\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "TZ"');
  });

  test("invalid/datetime/only-Tdot", () => {
    const input: string = "foo = T.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "T"');
  });

  test("invalid/datetime/second-over", () => {
    const input: string =
      "# time-second     = 2DIGIT  ; 00-58, 00-59, 00-60 based on leap second\n#                           ; rules\nd = 2006-01-01T00:00:61-00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: seconds must be between 00 and 60");
  });

  test("invalid/datetime/second-trailing-dot", () => {
    const input: string = "foo = 1997-09-09T09:09:09.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid time: expected at least one digit of fractional seconds",
    );
  });

  test("invalid/datetime/second-trailing-dotz", () => {
    const input: string = "foo = 2016-09-09T09:09:09.Z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid time: expected at least one digit of fractional seconds",
    );
  });

  test("invalid/datetime/time-no-leads", () => {
    const input: string = "# Leading 0 is always required.\nd = 2023-10-01T1:32:00Z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: expected 2-digit hours");
  });

  test("invalid/datetime/trailing-x", () => {
    const input: string = "sign=2020-01-01x\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'x'");
  });

  test("invalid/datetime/y10k-date", () => {
    const input: string = "# Maximum RFC3399 year is 9999.\nd = 10000-01-01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/datetime/y10k-datetime", () => {
    const input: string = "# Maximum RFC3399 year is 9999.\nd = 10000-01-01 00:00:00z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/encoding/bom-not-at-start-01", () => {
    const input: string = "# Contains UTF-8 BOM between = and 1\na=\ufeff1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0xEF)");
  });

  test("invalid/encoding/bom-not-at-start-02", () => {
    const input: string = "\ufeff\ufeff# Contains two UTF-8 BOMS at the start\na=1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0xEF)");
  });

  test("invalid/encoding/bom-not-at-start-03", () => {
    const input: string = "\ufeff\ufeffa=1\n# Contains two UTF-8 BOMS at the start\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0xEF)");
  });

  test("invalid/encoding/ideographic-space", () => {
    const input: string = '# First on next line is U+3000 IDEOGRAPHIC SPACE\n　foo = "bar"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0xE3)");
  });

  test("invalid/encoding/utf16-comment", () => {
    const input: string =
      "\u0000#\u0000 \u0000U\u0000T\u0000F\u0000-\u00001\u00006\u0000 \u0000w\u0000i\u0000t\u0000h\u0000o\u0000u\u0000t\u0000 \u0000B\u0000O\u0000M\u0000\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x00)");
  });

  test("invalid/encoding/utf16-key", () => {
    const input: string = '\u0000k\u0000 \u0000=\u0000 \u0000"\u0000v\u0000"\u0000\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x00)");
  });

  test("invalid/float/arabic-zero-01", () => {
    const input: string = "arabic-zero-01 = 1.٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/arabic-zero-02", () => {
    const input: string = "arabic-zero-02 = ٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0xD9)");
  });

  test("invalid/float/arabic-zero-03", () => {
    const input: string = "arabic-zero-03 = 1e٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/arabic-zero-04", () => {
    const input: string = "arabic-zero-04 = +٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found (0xD9)");
  });

  test("invalid/float/double-dot-01", () => {
    const input: string = "double-dot-01 = 0..1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/double-dot-02", () => {
    const input: string = "double-dot-02 = 0.1.2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '.'");
  });

  test("invalid/float/exp-dot-01", () => {
    const input: string = "exp-dot-01 = 1e2.3\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '.'");
  });

  test("invalid/float/exp-dot-02", () => {
    const input: string = "exp-dot-02 = 1.e2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/exp-dot-03", () => {
    const input: string = "exp-dot-03 = 3.e+20\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/exp-double-e-01", () => {
    const input: string = "exp-double-e-01 = 1ee2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/exp-double-e-02", () => {
    const input: string = "exp-double-e-02 = 1e2e3\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'e'");
  });

  test("invalid/float/exp-double-us", () => {
    const input: string = "exp-double-us = 1e__23\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/exp-leading-us", () => {
    const input: string = "exp-leading-us = 1e_23\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/exp-trailing-us-01", () => {
    const input: string = "exp-trailing-us-01 = 1_e2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/exp-trailing-us-02", () => {
    const input: string = "exp-trailing-us-02 = 1.2_e2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/exp-trailing-us", () => {
    const input: string = "exp-trailing-us = 1e23_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/inf-capital", () => {
    const input: string = "v = Inf\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "Inf"');
  });

  test("invalid/float/inf-incomplete-01", () => {
    const input: string = "inf-incomplete-01 = in\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "in"');
  });

  test("invalid/float/inf-incomplete-02", () => {
    const input: string = "inf-incomplete-02 = +in\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found 'i'");
  });

  test("invalid/float/inf-incomplete-03", () => {
    const input: string = "inf-incomplete-03 = -in\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found 'i'");
  });

  test("invalid/float/inf_underscore", () => {
    const input: string = "inf_underscore = in_f\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "in_f"');
  });

  test("invalid/float/leading-dot-neg", () => {
    const input: string = "leading-dot-neg = -.12345\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found '.'");
  });

  test("invalid/float/leading-dot-plus", () => {
    const input: string = "leading-dot-plus = +.12345\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found '.'");
  });

  test("invalid/float/leading-dot", () => {
    const input: string = "leading-dot = .12345\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '.'");
  });

  test("invalid/float/leading-us", () => {
    const input: string = "leading-us = _1.2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '_'");
  });

  test("invalid/float/leading-zero-neg", () => {
    const input: string = "leading-zero-neg = -03.14\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/float/leading-zero-plus", () => {
    const input: string = "leading-zero-plus = +03.14\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/float/leading-zero", () => {
    const input: string = "leading-zero = 03.14\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/float/nan-capital", () => {
    const input: string = "v = NaN\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "NaN"');
  });

  test("invalid/float/nan-incomplete-01", () => {
    const input: string = "nan-incomplete-01 = na\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "na"');
  });

  test("invalid/float/nan-incomplete-02", () => {
    const input: string = "nan-incomplete-02 = +na\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found 'n'");
  });

  test("invalid/float/nan-incomplete-03", () => {
    const input: string = "nan-incomplete-03 = -na\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found 'n'");
  });

  test("invalid/float/nan_underscore", () => {
    const input: string = "nan_underscore = na_n\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "na_n"');
  });

  test("invalid/float/trailing-dot-01", () => {
    const input: string = "trailing-point = 1.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-dot-02", () => {
    const input: string = "a = 1.\nb = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-dot-min", () => {
    const input: string = "trailing-dot-min = -1.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-dot-plus", () => {
    const input: string = "trailing-dot-plus = +1.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-dot", () => {
    const input: string = "trailing-dot = 1.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-exp-dot", () => {
    const input: string = "trailing-exp-dot =  0.e\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/trailing-exp-minus", () => {
    const input: string = "trailing-exp-minus = 0.0e-\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/trailing-exp-plus", () => {
    const input: string = "trailing-exp-plus = 0.0e+\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/trailing-exp", () => {
    const input: string = "trailing-exp = 0.0E\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: An exponent must contain at least one digit");
  });

  test("invalid/float/trailing-us-exp-01", () => {
    const input: string = "trailing-us-exp-1 = 1_e2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/trailing-us-exp-02", () => {
    const input: string = "trailing-us-exp-2 = 1.2_e2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/trailing-us", () => {
    const input: string = "trailing-us = 1.2_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/float/us-after-dot", () => {
    const input: string = "us-after-dot = 1._2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A decimal point must be followed by at least one digit",
    );
  });

  test("invalid/float/us-before-dot", () => {
    const input: string = "us-before-dot = 1_.2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/inline-table/bad-key-syntax", () => {
    const input: string = "tbl = { a = 1, [b] }\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '['");
  });

  test("invalid/inline-table/double-comma", () => {
    const input: string = "t = {x=3,,y=4}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ','");
  });

  test("invalid/inline-table/duplicate-key-01", () => {
    const input: string = "# Duplicate keys within an inline table are invalid\na={b=1, b=2}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/inline-table/duplicate-key-02", () => {
    const input: string = "table1 = { table2.dupe = 1, table2.dupe = 2 }\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'dupe'");
  });

  test("invalid/inline-table/duplicate-key-03", () => {
    const input: string = 'tbl = { fruit = { apple.color = "red" }, fruit.apple.texture = { smooth = true } }\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'fruit' with a dotted key");
  });

  test("invalid/inline-table/duplicate-key-04", () => {
    const input: string = 'tbl = { a.b = "a_b", a.b.c = "a_b_c" }\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/inline-table/empty-01", () => {
    const input: string = "t = {,}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ','");
  });

  test("invalid/inline-table/empty-02", () => {
    const input: string = "t = {,\n}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ','");
  });

  test("invalid/inline-table/empty-03", () => {
    const input: string = "t = {\n,\n}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ','");
  });

  test("invalid/inline-table/no-close-01", () => {
    const input: string = "a={\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated inline table; expected '}'");
  });

  test("invalid/inline-table/no-close-02", () => {
    const input: string = "a={b=1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ',' or '}' in an inline table but found end of file",
    );
  });

  test("invalid/inline-table/no-comma-01", () => {
    const input: string = "t = {x = 3 y = 4}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or '}' in an inline table but found 'y'");
  });

  test("invalid/inline-table/no-comma-02", () => {
    const input: string = "arrr = { comma-missing = true valid-toml = false }\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ',' or '}' in an inline table but found 'v'");
  });

  test("invalid/inline-table/overwrite-01", () => {
    const input: string =
      'a.b=0\n# Since table "a" is already defined, it can\'t be replaced by an inline table.\na={}\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a'");
  });

  test("invalid/inline-table/overwrite-02", () => {
    const input: string = "a={}\n# Inline tables are immutable and can't be extended\n[a.b]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend inline table 'a'");
  });

  test("invalid/inline-table/overwrite-03", () => {
    const input: string = "a = { b = 1 }\na.b = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'a' with a dotted key");
  });

  test("invalid/inline-table/overwrite-04", () => {
    const input: string = "inline-t = { nest = {} }\n\n[[inline-t.nest]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend inline table 'inline-t'");
  });

  test("invalid/inline-table/overwrite-05", () => {
    const input: string = "inline-t = { nest = {} }\n\n[inline-t.nest]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend inline table 'inline-t'");
  });

  test("invalid/inline-table/overwrite-06", () => {
    const input: string = "a = { b = 1, b.c = 2 }\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/inline-table/overwrite-07", () => {
    const input: string = 'tab = { inner.table = [{}], inner.table.val = "bad" }';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'table'");
  });

  test("invalid/inline-table/overwrite-08", () => {
    const input: string = 'tab = { inner = { dog = "best" }, inner.cat = "worst" }';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'inner' with a dotted key");
  });

  test("invalid/inline-table/overwrite-09", () => {
    const input: string = "[tab.nested]\ninline-t = { nest = {} }\n\n[tab]\nnested.inline-t.nest = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'nested' with a dotted key");
  });

  test("invalid/inline-table/overwrite-10", () => {
    const input: string =
      '# Set implicit "b", overwrite "b" (illegal!) and then set another implicit.\n#\n# Caused panic: https://github.com/BurntSushi/toml/issues/403\na = {b.a = 1, b = 2, b.c = 3}\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/integer/arabic-zero-01", () => {
    const input: string = "arabic-zero-01 = 1٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0xD9)");
  });

  test("invalid/integer/arabic-zero-02", () => {
    const input: string = "arabic-zero-02 = 1_0٠\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: (0xD9)");
  });

  test("invalid/integer/arabic-zero-03", () => {
    const input: string = "arabic-zero-03 = ٠.1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0xD9)");
  });

  test("invalid/integer/arabic-zero-04", () => {
    const input: string = "arabic-zero-04 = ٠e0\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found (0xD9)");
  });

  test("invalid/integer/capital-bin", () => {
    const input: string = "capital-bin = 0B0\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'B'");
  });

  test("invalid/integer/capital-hex", () => {
    const input: string = "capital-hex = 0X1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'X'");
  });

  test("invalid/integer/capital-oct", () => {
    const input: string = "capital-oct = 0O0\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'O'");
  });

  test("invalid/integer/double-sign-nex", () => {
    const input: string = "double-sign-nex = --99\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found '-'");
  });

  test("invalid/integer/double-sign-plus", () => {
    const input: string = "double-sign-plus = ++99\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a number but found '+'");
  });

  test("invalid/integer/double-us", () => {
    const input: string = "double-us = 1__23\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/integer/incomplete-bin", () => {
    const input: string = "incomplete-bin = 0b\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/incomplete-hex", () => {
    const input: string = "incomplete-hex = 0x\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/incomplete-oct", () => {
    const input: string = "incomplete-oct = 0o\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/invalid-bin", () => {
    const input: string = "invalid-bin = 0b0012\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid digit in number: '2'");
  });

  test("invalid/integer/invalid-hex-01", () => {
    const input: string = "invalid-hex-01 = 0xaafz\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid digit in number: 'z'");
  });

  test("invalid/integer/invalid-hex-02", () => {
    const input: string = "invalid-hex-02 = 0xgabba00f1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/invalid-hex-03", () => {
    const input: string = "a = 0x-1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/invalid-oct", () => {
    const input: string = "invalid-oct = 0o778\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid digit in number: '8'");
  });

  test("invalid/integer/leading-us-bin", () => {
    const input: string = "leading-us-bin = _0b1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '_'");
  });

  test("invalid/integer/leading-us-hex", () => {
    const input: string = "leading-us-hex = _0x1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '_'");
  });

  test("invalid/integer/leading-us-oct", () => {
    const input: string = "leading-us-oct = _0o1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '_'");
  });

  test("invalid/integer/leading-us", () => {
    const input: string = "leading-us = _123\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '_'");
  });

  test("invalid/integer/leading-zero-01", () => {
    const input: string = "leading-zero-01 = 01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/leading-zero-02", () => {
    const input: string = "leading-zero-02 = 00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/leading-zero-03", () => {
    const input: string = "leading-zero-03 = 0_0\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/leading-zero-sign-01", () => {
    const input: string = "leading-zero-sign-01 = -01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/leading-zero-sign-02", () => {
    const input: string = "leading-zero-sign-02 = +01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/leading-zero-sign-03", () => {
    const input: string = "leading-zero-sign-03 = +0_1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Leading zeros are not allowed in numbers");
  });

  test("invalid/integer/negative-bin", () => {
    const input: string = "negative-bin = -0b11010110\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/negative-hex", () => {
    const input: string = "negative-hex = -0xff\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/negative-oct", () => {
    const input: string = "negative-oct = -0o755\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/positive-bin", () => {
    const input: string = "positive-bin = +0b11010110\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/positive-hex", () => {
    const input: string = "positive-hex = +0xff\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/positive-oct", () => {
    const input: string = "positive-oct = +0o755\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A sign is not allowed on hexadecimal, octal, or binary integers",
    );
  });

  test("invalid/integer/text-after-integer", () => {
    const input: string = "answer = 42 the ultimate answer?\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/integer/trailing-us-bin", () => {
    const input: string = "trailing-us-bin = 0b1_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/integer/trailing-us-hex", () => {
    const input: string = "trailing-us-hex = 0x1_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/integer/trailing-us-oct", () => {
    const input: string = "trailing-us-oct = 0o1_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/integer/trailing-us", () => {
    const input: string = "trailing-us = 123_\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Underscores in numbers must be surrounded by digits");
  });

  test("invalid/integer/us-after-bin", () => {
    const input: string = "us-after-bin = 0b_1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/us-after-hex", () => {
    const input: string = "us-after-hex = 0x_1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/integer/us-after-oct", () => {
    const input: string = "us-after-oct = 0o_1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected at least one digit after the radix prefix");
  });

  test("invalid/key/after-array", () => {
    const input: string = '[[agencies]] owner = "S Cjelli"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a table header",
    );
  });

  test("invalid/key/after-table", () => {
    const input: string = '[error] this = "should not be here"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a table header",
    );
  });

  test("invalid/key/after-value", () => {
    const input: string = 'first = "Tom" last = "Preston-Werner" # INVALID\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/key/bare-invalid-character-01", () => {
    const input: string = "! = 123\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '!'");
  });

  test("invalid/key/bare-invalid-character-02", () => {
    const input: string = "bare!key = 123\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '!'");
  });

  test("invalid/key/dot", () => {
    const input: string = ". = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/key/dotdot", () => {
    const input: string = ".. = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/key/dotted-redefine-table-01", () => {
    const input: string = "a = false\na.b = true\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a'");
  });

  test("invalid/key/dotted-redefine-table-02", () => {
    const input: string = "# Defined a.b as int\na.b = 1\n# Tries to access it as table: error\na.b.c = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/key/duplicate-keys-01", () => {
    const input: string = 'name = "Tom"\nname = "Pradyun"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'name'");
  });

  test("invalid/key/duplicate-keys-02", () => {
    const input: string = "dupe = false\ndupe = true\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'dupe'");
  });

  test("invalid/key/duplicate-keys-03", () => {
    const input: string = 'spelling   = "favorite"\n"spelling" = "favourite"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'spelling'");
  });

  test("invalid/key/duplicate-keys-04", () => {
    const input: string = 'spelling   = "favorite"\n\'spelling\' = "favourite"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'spelling'");
  });

  test("invalid/key/duplicate-keys-05", () => {
    const input: string = 'a        = 1\n"\\u0061" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a'");
  });

  test("invalid/key/duplicate-keys-06", () => {
    const input: string = '"a\'b"      = 1\n"a\\u0027b" = 2\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a'b'");
  });

  test("invalid/key/duplicate-keys-07", () => {
    const input: string = '"" = 1\n"" = 2\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key ''");
  });

  test("invalid/key/duplicate-keys-08", () => {
    const input: string = "arr = [1]\narr = [2]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'arr'");
  });

  test("invalid/key/duplicate-keys-09", () => {
    const input: string = "tbl = {k=1}\ntbl = {kk=2}\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'tbl'");
  });

  test("invalid/key/empty", () => {
    const input: string = " = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '='");
  });

  test("invalid/key/end-in-escape", () => {
    const input: string = '"backslash is the last char\\\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x0A)");
  });

  test("invalid/key/escape", () => {
    const input: string = '\\u00c0 = "latin capital letter A with grave"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '\\'");
  });

  test("invalid/key/hash", () => {
    const input: string = "a# = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '#'");
  });

  test("invalid/key/multiline-key-01", () => {
    const input: string = '"""key""" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/multiline-key-02", () => {
    const input: string = "'''key''' = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '''");
  });

  test("invalid/key/multiline-key-03", () => {
    const input: string = '"""key""" = """v"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/multiline-key-04", () => {
    const input: string = "'''key''' = '''v'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '''");
  });

  test("invalid/key/newline-01", () => {
    const input: string = "barekey\n   = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/newline-02", () => {
    const input: string = '"quoted\nkey" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/key/newline-03", () => {
    const input: string = "'quoted\nkey' = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
  });

  test("invalid/key/newline-04", () => {
    const input: string = '"""long\nkey""" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/newline-05", () => {
    const input: string = "'''long\nkey''' = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '''");
  });

  test("invalid/key/newline-06", () => {
    const input: string = "key =\n1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Missing value after '='; values must be on the same line",
    );
  });

  test("invalid/key/no-eol-01", () => {
    const input: string = "a = 1 b = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/key/no-eol-02", () => {
    const input: string = "0=0r=false\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'r'");
  });

  test("invalid/key/no-eol-03", () => {
    const input: string = '0=""o=""m=""r=""00="0"q="""0"""e="""0"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/key/no-eol-04", () => {
    const input: string = '[[0000l0]]\n0="0"[[0000l0]]\n0="0"[[0000l0]]\n0="0"l="0"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/key/no-eol-05", () => {
    const input: string = '0=[0]00=[0,0,0]t=["0","0","0"]s=[1000-00-00T00:00:00Z,2000-00-00T00:00:00Z]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/key/no-eol-06", () => {
    const input: string = "0=0r0=0r=false\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'r'");
  });

  test("invalid/key/no-eol-07", () => {
    const input: string = "0=0r0=0r=falsefal=false\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: 'r'");
  });

  test("invalid/key/only-float", () => {
    const input: string = "1.1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/only-int", () => {
    const input: string = "1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/only-str", () => {
    const input: string = '""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/open-bracket", () => {
    const input: string = "[abc = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '='");
  });

  test("invalid/key/partial-quoted", () => {
    const input: string = 'partial"quoted" = 5\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/quoted-unclosed-01", () => {
    const input: string = '"key = x\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/key/quoted-unclosed-02", () => {
    const input: string = '"key\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/key/single-open-bracket", () => {
    const input: string = "[\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0A)");
  });

  test("invalid/key/space-quoted", () => {
    const input: string = '# Tab literal between a and b below.\n"a" "b" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/space", () => {
    const input: string = "a b = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found 'b'");
  });

  test("invalid/key/special-character", () => {
    const input: string = 'μ = "greek small letter mu"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0xCE)");
  });

  test("invalid/key/start-bracket", () => {
    const input: string = "[a]\n[xyz = 5\n[b]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '='");
  });

  test("invalid/key/start-dot", () => {
    const input: string = ".key = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/key/tab-quoted", () => {
    const input: string = '# Tab literal between a and b below.\n"a"\t"b" = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found '\"'");
  });

  test("invalid/key/tab", () => {
    const input: string = "# Tab literal between a and b below.\na\tb = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found 'b'");
  });

  test("invalid/key/two-equals-01", () => {
    const input: string = "key= = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '='");
  });

  test("invalid/key/two-equals-02", () => {
    const input: string = "a==1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '='");
  });

  test("invalid/key/two-equals-03", () => {
    const input: string = "a=b=1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "b"');
  });

  test("invalid/key/without-value-01", () => {
    const input: string = "key\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/without-value-02", () => {
    const input: string = "key = \n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Missing value after '='; values must be on the same line",
    );
  });

  test("invalid/key/without-value-03", () => {
    const input: string = '"key"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/without-value-04", () => {
    const input: string = '"key" = \n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Missing value after '='; values must be on the same line",
    );
  });

  test("invalid/key/without-value-05", () => {
    const input: string = "fs.fw\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected '=' after a key but found (0x0A)");
  });

  test("invalid/key/without-value-06", () => {
    const input: string = "fs.fw =\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Missing value after '='; values must be on the same line",
    );
  });

  test("invalid/key/without-value-07", () => {
    const input: string = "fs.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0A)");
  });

  test("invalid/local-date/day-1digit", () => {
    const input: string = "foo = 1997-09-9\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit day");
  });

  test("invalid/local-date/feb-29", () => {
    const input: string = '"not a leap year" = 2100-02-29\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-date/feb-30", () => {
    const input: string = '"only 28 or 29 days in february" = 1988-02-30\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-date/mday-over", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-32\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-date/mday-under", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-date/month-over", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2006-13-01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/local-date/month-under", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2007-00-01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/local-date/no-leads-with-milli", () => {
    const input: string = '# Day "5" instead of "05"; the leading zero is required.\nwith-milli = 1987-07-5\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit day");
  });

  test("invalid/local-date/no-leads", () => {
    const input: string = '# Month "7" instead of "07"; the leading zero is required.\nno-leads = 1987-7-05\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit month");
  });

  test("invalid/local-date/trailing-t", () => {
    const input: string = "# Date cannot end with trailing T\nd = 2006-01-30T\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: expected 2-digit hours");
  });

  test("invalid/local-date/y10k", () => {
    const input: string = "# Maximum RFC3399 year is 9999.\nd = 10000-01-01\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/local-date/year-3digits", () => {
    const input: string = "foo = 199-09-09\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/local-datetime/feb-29", () => {
    const input: string = '"not a leap year" = 2100-02-29T15:15:15\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-datetime/feb-30", () => {
    const input: string = '"only 28 or 29 days in february" = 1988-02-30T15:15:15\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-datetime/hour-over", () => {
    const input: string = "# time-hour       = 2DIGIT  ; 00-23\nd = 2006-01-01T24:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: hours must be between 00 and 23");
  });

  test("invalid/local-datetime/mday-over", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-32T00:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-datetime/mday-under", () => {
    const input: string =
      "# date-mday       = 2DIGIT  ; 01-28, 01-29, 01-30, 01-31 based on\n#                           ; month/year\nd = 2006-01-00T00:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: day is out of range for the month");
  });

  test("invalid/local-datetime/minute-over", () => {
    const input: string = "# time-minute     = 2DIGIT  ; 00-59\nd = 2006-01-01T00:60:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: minutes must be between 00 and 59");
  });

  test("invalid/local-datetime/month-over", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2006-13-01T00:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/local-datetime/month-under", () => {
    const input: string = "# date-month      = 2DIGIT  ; 01-12\nd = 2007-00-01T00:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: month must be between 01 and 12");
  });

  test("invalid/local-datetime/no-leads-with-milli", () => {
    const input: string =
      '# Day "5" instead of "05"; the leading zero is required.\nwith-milli = 1987-07-5T17:45:00.12\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit day");
  });

  test("invalid/local-datetime/no-leads", () => {
    const input: string = '# Month "7" instead of "07"; the leading zero is required.\nno-leads = 1987-7-05T17:45:00\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid date: expected a 2-digit month");
  });

  test("invalid/local-datetime/no-t", () => {
    const input: string = '# No "t" or "T" between the date and time.\nno-t = 1987-07-0517:45:00\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '1'");
  });

  test("invalid/local-datetime/second-over", () => {
    const input: string =
      "# time-second     = 2DIGIT  ; 00-58, 00-59, 00-60 based on leap second\n#                           ; rules\nd = 2006-01-01T00:00:61\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: seconds must be between 00 and 60");
  });

  test("invalid/local-datetime/time-no-leads", () => {
    const input: string = "# Leading 0 is always required.\nd = 2023-10-01T1:32:00Z\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: expected 2-digit hours");
  });

  test("invalid/local-datetime/y10k", () => {
    const input: string = "# Maximum RFC3399 year is 9999.\nd = 10000-01-01 00:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: '-'");
  });

  test("invalid/local-time/hour-over", () => {
    const input: string = "# time-hour       = 2DIGIT  ; 00-23\nd = 24:00:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: hours must be between 00 and 23");
  });

  test("invalid/local-time/minute-over", () => {
    const input: string = "# time-minute     = 2DIGIT  ; 00-59\nd = 00:60:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: minutes must be between 00 and 59");
  });

  test("invalid/local-time/second-over", () => {
    const input: string =
      "# time-second     = 2DIGIT  ; 00-58, 00-59, 00-60 based on leap second\n#                           ; rules\nd = 00:00:61\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: seconds must be between 00 and 60");
  });

  test("invalid/local-time/time-no-leads-01", () => {
    const input: string = "# Leading 0 is always required.\nd = 1:32:00\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unexpected character after a value: ':'");
  });

  test("invalid/local-time/time-no-leads-02", () => {
    const input: string = "# Leading 0 is always required.\nd = 01:32:0\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid time: expected 2-digit seconds");
  });

  test("invalid/local-time/trailing-dot", () => {
    const input: string = "t = 12:13:14.\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid time: expected at least one digit of fractional seconds",
    );
  });

  test("invalid/local-time/trailing-dotdot", () => {
    const input: string = "t = 12:13:14..\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Invalid time: expected at least one digit of fractional seconds",
    );
  });

  test("invalid/spec-1.1.0/common-16-0", () => {
    const input: string =
      'str4 = """Here are two quotation marks: "". Simple enough."""\nstr5 = """Here are three quotation marks: """."""  # INVALID\nstr5 = """Here are three quotation marks: ""\\"."""\nstr6 = """Here are fifteen quotation marks: ""\\"""\\"""\\"""\\"""\\"."""\n\n# "This," she said, "is just a pointless statement."\nstr7 = """"This," she said, "is just a pointless statement.""""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/spec-1.1.0/common-19-0", () => {
    const input: string =
      "quot15 = '''Here are fifteen quotation marks: \"\"\"\"\"\"\"\"\"\"\"\"\"\"\"'''\n\napos15 = '''Here are fifteen apostrophes: ''''''''''''''''''  # INVALID\napos15 = \"Here are fifteen apostrophes: '''''''''''''''\"\n\n# 'That,' she said, 'is still pointless.'\nstr = ''''That,' she said, 'is still pointless.''''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Too many quotes at the end of a multi-line string");
  });

  test("invalid/spec-1.1.0/common-2", () => {
    const input: string = "key = # INVALID\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a value but found '#'");
  });

  test("invalid/spec-1.1.0/common-46-0", () => {
    const input: string =
      '[fruit]\napple.color = "red"\napple.taste.sweet = true\n\n[fruit.apple]  # INVALID\n# [fruit.apple.taste]  # INVALID\n\n[fruit.apple.texture]  # you can add sub-tables\nsmooth = true\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'apple'");
  });

  test("invalid/spec-1.1.0/common-46-1", () => {
    const input: string =
      '[fruit]\napple.color = "red"\napple.taste.sweet = true\n\n# [fruit.apple]  # INVALID\n[fruit.apple.taste]  # INVALID\n\n[fruit.apple.texture]  # you can add sub-tables\nsmooth = true\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'taste'");
  });

  test("invalid/spec-1.1.0/common-49-0", () => {
    const input: string = '[product]\ntype = { name = "Nail" }\ntype.edible = false  # INVALID\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'type' with a dotted key");
  });

  test("invalid/spec-1.1.0/common-5", () => {
    const input: string =
      '= "no key name"           # INVALID\n"""key""" = "not allowed" # INVALID\n"" = "blank"              # VALID but discouraged\n\'\' = \'blank\'              # VALID but discouraged\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '='");
  });

  test("invalid/spec-1.1.0/common-50-0", () => {
    const input: string = '[product]\ntype.name = "Nail"\ntype = { edible = false }  # INVALID\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'type'");
  });

  test("invalid/string/bad-byte-escape", () => {
    const input: string = 'naughty = "\\xAg"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-concat", () => {
    const input: string = 'no_concat = "first" "second"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/string/bad-escape-01", () => {
    const input: string = 'invalid-escape = "This string has a bad \\a escape character."\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: 'a'");
  });

  test("invalid/string/bad-escape-02", () => {
    const input: string = 'invalid-escape = "This string has a bad \\  escape character."\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/bad-escape-03", () => {
    const input: string = 'backslash = "\\"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/string/bad-escape-04", () => {
    const input: string = 'a = "a \\\\\\ b"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/bad-escape-05", () => {
    const input: string = 'a = "a \\\\\\\\\\ b"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/bad-hex-esc-01", () => {
    const input: string = 'bad-hex-esc-01 = "\\x0g"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-hex-esc-02", () => {
    const input: string = 'bad-hex-esc-02 = "\\xG0"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-hex-esc-03", () => {
    const input: string = 'bad-hex-esc-03 = "\\x"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-hex-esc-04", () => {
    const input: string = 'bad-hex-esc-04 = "\\x 50"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-hex-esc-05", () => {
    const input: string = 'bad-hex-esc-5 = "\\x 50"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A hex escape must be followed by exactly 2 hex digits",
    );
  });

  test("invalid/string/bad-multiline", () => {
    const input: string = 'multi = "first line\nsecond line"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/string/bad-slash-escape", () => {
    const input: string = 'invalid-escape = "This string has a bad \\/ escape character."\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: '/'");
  });

  test("invalid/string/bad-uni-esc-01", () => {
    const input: string = 'bad-uni-esc-01 = "val\\ue"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 4 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-02", () => {
    const input: string = 'bad-uni-esc-02 = "val\\Ux"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-03", () => {
    const input: string = 'bad-uni-esc-03 = "val\\U0000000"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-04", () => {
    const input: string = 'bad-uni-esc-04 = "val\\U0000"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-05", () => {
    const input: string = 'bad-uni-esc-05 = "val\\Ugggggggg"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-06", () => {
    const input: string = 'bad-uni-esc-06 = "This string contains a non scalar unicode codepoint \\uD801"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/bad-uni-esc-07", () => {
    const input: string = 'bad-uni-esc-07 = "\\uabag"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 4 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-01", () => {
    const input: string = 'bad-uni-esc-ml-01 = """val\\ue"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 4 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-02", () => {
    const input: string = 'bad-uni-esc-ml-02 = """val\\Ux"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-03", () => {
    const input: string = 'bad-uni-esc-ml-03 = """val\\U0000000"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-04", () => {
    const input: string = 'bad-uni-esc-ml-04 = """val\\U0000"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-05", () => {
    const input: string = 'bad-uni-esc-ml-05 = """val\\Ugggggggg"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 8 hex digits",
    );
  });

  test("invalid/string/bad-uni-esc-ml-06", () => {
    const input: string = 'bad-uni-esc-ml-06 = """This string contains a non scalar unicode codepoint \\uD801"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/bad-uni-esc-ml-07", () => {
    const input: string = 'bad-uni-esc-ml-07 = """\\uabag"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: A Unicode escape must be followed by exactly 4 hex digits",
    );
  });

  test("invalid/string/basic-multiline-out-of-range-unicode-escape-01", () => {
    const input: string = 'a = """\\UFFFFFFFF"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/basic-multiline-out-of-range-unicode-escape-02", () => {
    const input: string = 'a = """\\U00D80000"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/basic-multiline-quotes", () => {
    const input: string = 'str5 = """Here are three quotation marks: """."""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/string/basic-multiline-unknown-escape", () => {
    const input: string = 'a = """\\@"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: '@'");
  });

  test("invalid/string/basic-out-of-range-unicode-escape-01", () => {
    const input: string = 'a = "\\UFFFFFFFF"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/basic-out-of-range-unicode-escape-02", () => {
    const input: string = 'a = "\\U00D80000"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Escaped code point must be a Unicode scalar value");
  });

  test("invalid/string/basic-unknown-escape", () => {
    const input: string = 'a = "\\@"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: '@'");
  });

  test("invalid/string/literal-multiline-quotes-01", () => {
    const input: string = "a = '''6 apostrophes: ''''''\n\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Too many quotes at the end of a multi-line string");
  });

  test("invalid/string/literal-multiline-quotes-02", () => {
    const input: string = "a = '''15 apostrophes: ''''''''''''''''''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Too many quotes at the end of a multi-line string");
  });

  test("invalid/string/missing-quotes-array", () => {
    const input: string = "name = [value]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "value"');
  });

  test("invalid/string/missing-quotes-inline-table", () => {
    const input: string = "name = { key = value }\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "value"');
  });

  test("invalid/string/missing-quotes", () => {
    const input: string = "name = value\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "value"');
  });

  test("invalid/string/multiline-bad-escape-01", () => {
    const input: string = 'k = """t\\a"""\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: 'a'");
  });

  test("invalid/string/multiline-bad-escape-02", () => {
    const input: string = '# \\<Space> is not a valid escape.\nk = """t\\ t"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/multiline-bad-escape-03", () => {
    const input: string = '# \\<Space> is not a valid escape.\nk = """t\\ """\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/multiline-bad-escape-04", () => {
    const input: string = 'backslash = """\\"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-escape-space-01", () => {
    const input: string = 'a = """\n  foo \\ \\n\n  bar"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/multiline-escape-space-02", () => {
    const input: string = 'bee = """\nhee \\\n\ngee \\   """\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x20)");
  });

  test("invalid/string/multiline-lit-no-close-01", () => {
    const input: string = "invalid = '''\n    this will fail\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-lit-no-close-02", () => {
    const input: string = "x='''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-lit-no-close-03", () => {
    const input: string = "not-closed= '''\ndiibaa\nblibae ete\neteta\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-lit-no-close-04", () => {
    const input: string = "bee = '''\nhee\ngee ''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-no-close-01", () => {
    const input: string = 'invalid = """\n    this will fail\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-no-close-02", () => {
    const input: string = 'x="""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-no-close-03", () => {
    const input: string = 'not-closed= """\ndiibaa\nblibae ete\neteta\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-no-close-04", () => {
    const input: string = 'bee = """\nhee\ngee ""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-no-close-05", () => {
    const input: string = 'bee = """\nhee\ngee\\\t \n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/multiline-quotes-01", () => {
    const input: string = 'a = """6 quotes: """"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Too many quotes at the end of a multi-line string");
  });

  test("invalid/string/no-close-01", () => {
    const input: string = 'no-ending-quote = "One time, at band camp\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/string/no-close-02", () => {
    const input: string = '"a-string".must-be = "closed\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/string/no-close-03", () => {
    const input: string = "no-ending-quote = 'One time, at band camp\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
  });

  test("invalid/string/no-close-04", () => {
    const input: string = "'a-string'.must-be = 'closed\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
  });

  test("invalid/string/no-close-05", () => {
    const input: string = '# No newline at end\nno-ending-quote = "One time, at band camp';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/no-close-06", () => {
    const input: string = '# No newline at end\n"a-string".must-be = "closed';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/no-close-07", () => {
    const input: string = "# No newline at end\nno-ending-quote = 'One time, at band camp";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/no-close-08", () => {
    const input: string = "# No newline at end\n'a-string'.must-be = 'closed";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Unterminated string");
  });

  test("invalid/string/no-close-09", () => {
    const input: string = '# Newlines are not allowed in "-strings.\na = "\n"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/string/no-close-10", () => {
    const input: string = "# Newlines are not allowed in '-strings.\na = '\n'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
  });

  test("invalid/string/no-open-01", () => {
    const input: string = 's = a"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-02", () => {
    const input: string = 'a = [a"]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-03", () => {
    const input: string = "s = a'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-04", () => {
    const input: string = "a = [a']\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-05", () => {
    const input: string = 'a = a"""\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-06", () => {
    const input: string = 'a = [a"""]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-07", () => {
    const input: string = "a = a'''\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/no-open-08", () => {
    const input: string = "a = [a''']\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe('TOML Parse error: Strings must be quoted: "a"');
  });

  test("invalid/string/text-after-string", () => {
    const input: string = 'string = "Is there life after strings?" No.\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a key/value pair",
    );
  });

  test("invalid/string/wrong-close", () => {
    const input: string = "bad-ending-quote = \"double and single'\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/table/append-with-dotted-keys-01", () => {
    const input: string =
      '# First a.b.c defines a table: a.b.c = {z=9}\n#\n# Then we define a.b.c.t = "str" to add a str to the above table, making it:\n#\n#   a.b.c = {z=9, t="..."}\n#\n# While this makes sense, logically, it was decided this is not valid TOML as\n# it\'s too confusing/convoluted.\n# \n# See: https://github.com/toml-lang/toml/issues/846\n#      https://github.com/toml-lang/toml/pull/859\n\n[a.b.c]\n  z = 9\n\n[a]\n  b.c.t = "Using dotted keys to add to [a.b.c] after explicitly defining it above is not allowed"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'b' with a dotted key");
  });

  test("invalid/table/append-with-dotted-keys-02", () => {
    const input: string =
      '# This is the same issue as in injection-1.toml, except that nests one level\n# deeper. See that file for a more complete description.\n\n[a.b.c.d]\n  z = 9\n\n[a]\n  b.c.d.k.t = "Using dotted keys to add to [a.b.c.d] after explicitly defining it above is not allowed"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'b' with a dotted key");
  });

  test("invalid/table/append-with-dotted-keys-03", () => {
    const input: string = "[[a.b]]\n\n[a]\nb.y = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/table/append-with-dotted-keys-04", () => {
    const input: string =
      '[dependencies.foo]\nversion = "0.16"\n\n[dependencies]\nlibc = "0.2"\n\n[dependencies]\nrand = "0.3.14"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'dependencies'");
  });

  test("invalid/table/append-with-dotted-keys-05", () => {
    const input: string = "a.b.c = 1\na.b = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b'");
  });

  test("invalid/table/append-with-dotted-keys-06", () => {
    const input: string = "a = 1\na.b = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a'");
  });

  test("invalid/table/append-with-dotted-keys-07", () => {
    const input: string = 'a = {k1 = 1, k1.name = "joe"}\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'k1'");
  });

  test("invalid/table/append-with-dotted-keys-08", () => {
    const input: string =
      '[a.b.c]\nz = 9\n\n[[totally_unrelated]]\nx = 123\n\n[a]\nb.c.t = "this should NOT be allowed"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend table 'b' with a dotted key");
  });

  test("invalid/table/array-empty", () => {
    const input: string = '[[]]\nname = "Born to Run"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ']'");
  });

  test("invalid/table/array-implicit", () => {
    const input: string =
      '# This test is a bit tricky. It should fail because the first use of\n# `[[albums.songs]]` without first declaring `albums` implies that `albums`\n# must be a table. The alternative would be quite weird. Namely, it wouldn\'t\n# comply with the TOML spec: "Each double-bracketed sub-table will belong to \n# the most *recently* defined table element *above* it."\n#\n# This is in contrast to the *valid* test, table-array-implicit where\n# `[[albums.songs]]` works by itself, so long as `[[albums]]` isn\'t declared\n# later. (Although, `[albums]` could be.)\n[[albums.songs]]\nname = "Glory Days"\n\n[[albums]]\nname = "Born in the USA"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'albums' as an array of tables");
  });

  test("invalid/table/array-no-close-01", () => {
    const input: string = '[[albums]\nname = "Born to Run"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found (0x0A)",
    );
  });

  test("invalid/table/array-no-close-02", () => {
    const input: string = "[[closing-bracket.missing]\nblaa=2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found (0x0A)",
    );
  });

  test("invalid/table/array-no-close-03", () => {
    const input: string = "[[a\n[[b]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found (0x0A)",
    );
  });

  test("invalid/table/array-no-close-04", () => {
    const input: string = "[[a\nb = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found (0x0A)",
    );
  });

  test("invalid/table/bare-invalid-character-01", () => {
    const input: string = "[!]\nk = 123\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '!'");
  });

  test("invalid/table/bare-invalid-character-02", () => {
    const input: string = "[bare!key]\nk = 123\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '!'");
  });

  test("invalid/table/dot", () => {
    const input: string = "[.]\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/table/dotdot", () => {
    const input: string = "[..]\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/table/duplicate-key-01", () => {
    const input: string = "[a]\nb = 1\n\n[a]\nc = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'a'");
  });

  test("invalid/table/duplicate-key-02", () => {
    const input: string = '[fruit]\ntype = "apple"\n\n[fruit.type]\napple = "yes"\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'type' as a table");
  });

  test("invalid/table/duplicate-key-03", () => {
    const input: string = '[fruit]\napple.color = "red"\n\n[[fruit.apple]]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'apple' as an array of tables");
  });

  test("invalid/table/duplicate-key-04", () => {
    const input: string = '[fruit]\napple.color = "red"\n\n[fruit.apple] # INVALID\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'apple'");
  });

  test("invalid/table/duplicate-key-05", () => {
    const input: string = "[fruit]\napple.taste.sweet = true\n\n[fruit.apple.taste] # INVALID\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'taste'");
  });

  test("invalid/table/duplicate-key-06", () => {
    const input: string = "[tbl]\n[[tbl]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'tbl' as an array of tables");
  });

  test("invalid/table/duplicate-key-07", () => {
    const input: string = "[[tbl]]\n[tbl]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine array of tables 'tbl' as a table");
  });

  test("invalid/table/duplicate-key-08", () => {
    const input: string = "[a]\nb = { c = 2, d = {} }\n[a.b]\nc = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine inline table 'b'");
  });

  test("invalid/table/duplicate-key-09", () => {
    const input: string = '[a]\nfoo="bar"\n[a.b]\nfoo="bar"\n[a]\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'a'");
  });

  test("invalid/table/duplicate-key-10", () => {
    const input: string = "a = []\n[[a.b]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot extend array 'a'");
  });

  test("invalid/table/duplicate-key-11", () => {
    const input: string = "[a]\n[a.b]\n[a.b]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'b'");
  });

  test("invalid/table/duplicate-key-12", () => {
    const input: string = "[a]\n[a.b]\nc = 1\n[a.b]\nc = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'b'");
  });

  test("invalid/table/empty-implicit-table", () => {
    const input: string = "[naughty..naughty]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '.'");
  });

  test("invalid/table/empty", () => {
    const input: string = "[]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ']'");
  });

  test("invalid/table/equals-sign", () => {
    const input: string = "[name=bad]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '='");
  });

  test("invalid/table/llbrace", () => {
    const input: string = "[ [table]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found '['");
  });

  test("invalid/table/multiline-key-01", () => {
    const input: string = '["""tbl"""]\nk = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '\"'");
  });

  test("invalid/table/multiline-key-02", () => {
    const input: string = "['''tbl''']\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '''");
  });

  test("invalid/table/nested-brackets-close", () => {
    const input: string = "[a]b]\nzyx = 42\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a table header",
    );
  });

  test("invalid/table/nested-brackets-open", () => {
    const input: string = "[a[b]\nzyx = 42\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '['");
  });

  test("invalid/table/newline-01", () => {
    const input: string = "[tbl\n]\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0x0A)",
    );
  });

  test("invalid/table/newline-02", () => {
    const input: string = '["tbl\n"]\nk = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/table/newline-03", () => {
    const input: string = '["tbl"\n]\nk = 1\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0x0A)",
    );
  });

  test("invalid/table/newline-04", () => {
    const input: string = "[tbl.\n]\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0A)");
  });

  test("invalid/table/newline-05", () => {
    const input: string = "[tbl\n.sub]\nk = 1\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0x0A)",
    );
  });

  test("invalid/table/no-close-01", () => {
    const input: string = "[where will it end\nname = value\n\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found 'w'");
  });

  test("invalid/table/no-close-02", () => {
    const input: string = "[closing-bracket.missingö\nblaa=2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0xC3)",
    );
  });

  test("invalid/table/no-close-03", () => {
    const input: string = '["where will it end]\nname = value\n\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; newlines must be escaped in basic strings",
    );
  });

  test("invalid/table/no-close-04", () => {
    const input: string = "[\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found (0x0A)");
  });

  test("invalid/table/no-close-05", () => {
    const input: string = "[fwfw.wafw\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0x0A)",
    );
  });

  test("invalid/table/no-close-06", () => {
    const input: string = "[a\n[b]\n[c\n[d]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']' to close a table header but found (0x0A)",
    );
  });

  test("invalid/table/no-close-07", () => {
    const input: string = "[']\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Unterminated string; literal strings cannot contain newlines",
    );
  });

  test("invalid/table/no-close-08", () => {
    const input: string = "[''']\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '''");
  });

  test("invalid/table/no-close-09", () => {
    const input: string = '["where will it end""]\nname = value\n';
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '\"'");
  });

  test("invalid/table/overwrite-array-in-parent", () => {
    const input: string = "[[parent-table.arr]]\n[parent-table]\nnot-arr = 1\narr = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'arr'");
  });

  test("invalid/table/overwrite-bool-with-array", () => {
    const input: string = "a=true\n[[a]]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a' as an array of tables");
  });

  test("invalid/table/overwrite-with-deep-table", () => {
    const input: string = "a=1\n[a.b.c.d]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'a' as a table");
  });

  test("invalid/table/redefine-01", () => {
    const input: string = "# Define b as int, and try to use it as a table: error\n[a]\nb = 1\n\n[a.b]\nc = 2\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'b' as a table");
  });

  test("invalid/table/redefine-02", () => {
    const input: string =
      "# Define t2 as a table via dotted key in [t1] block, and then redefine [t1.t2]\n[t1]\nt2.t3.v = 0\n[t1.t2]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 't2'");
  });

  test("invalid/table/redefine-03", () => {
    const input: string =
      "# Define t2.t3 as a table via dotted key in [t1] block, and then redefine [t1.t2.t3]\n[t1]\nt2.t3.v = 0\n[t1.t2.t3]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 't3'");
  });

  test("invalid/table/rrbrace", () => {
    const input: string = "[[table] ]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected ']]' to close an array-of-tables header but found (0x20)",
    );
  });

  test("invalid/table/super-twice", () => {
    const input: string = "[a.b]\n[a]\n[a]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine table 'a'");
  });

  test("invalid/table/text-after-table", () => {
    const input: string = "[error] this shouldn't be here\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe(
      "TOML Parse error: Expected a newline or end of file after a table header",
    );
  });

  test("invalid/table/trailing-dot", () => {
    const input: string = "[a.]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected a key but found ']'");
  });

  test("invalid/table/whitespace", () => {
    const input: string = "[invalid key]\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found 'k'");
  });

  test("invalid/table/with-pound", () => {
    const input: string = "[key#group]\nanswer = 42\n";
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Expected ']' to close a table header but found '#'");
  });
});

// These inputs are not valid UTF-8, so they are passed as raw bytes; a TOML
// document must be valid UTF-8 as a whole.
describe("toml-test/invalid-encoding", () => {
  test("invalid/encoding/bad-codepoint", () => {
    const input = Buffer.from("IyBJbnZhbGlkIGNvZGVwb2ludCBVK0Q4MDAgOiDtoIAK", "base64");
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-at-end", () => {
    const input = Buffer.from(
      "IyBUaGVyZSBpcyBhIDB4ZGEgYXQgYWZ0ZXIgdGhlIHF1b3RlcywgYW5kIG5vIEVPTCBhdCB0aGUgZW5kIG9mIHRoZSBmaWxlLgojCiMgVGhpcyBpcyBhIGJpdCBvZiBhbiBlZGdlIGNhc2U6IFRoaXMgaW5kaWNhdGVzIHRoZXJlIHNob3VsZCBiZSB0d28gYnl0ZXMKIyAoMGIxMTAxXzEwMTApIGJ1dCB0aGVyZSBpcyBubyBieXRlIHRvIGZvbGxvdyBiZWNhdXNlIGl0J3MgdGhlIGVuZCBvZiB0aGUgZmlsZS4KeCA9ICIiIiIiIto=",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-array", () => {
    const input = Buffer.from(
      "IyBodHRwczovL2dpdGh1Yi5jb20vbWFyemVyL3RvbWxwbHVzcGx1cy9pc3N1ZXMvMTAwCmZsID1bIFtbW1tbW1tbW1tbW1tbWzaAhgAAAC02wp8gAA==",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-comment", () => {
    const input = Buffer.from("IyDDCg==", "base64");
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-multiline-literal", () => {
    const input = Buffer.from(
      "IyBUaGUgZm9sbG93aW5nIGxpbmUgY29udGFpbnMgYW4gaW52YWxpZCBVVEYtOCBzZXF1ZW5jZS4KYmFkID0gJycnwycnJwo=",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-multiline", () => {
    const input = Buffer.from(
      "IyBUaGUgZm9sbG93aW5nIGxpbmUgY29udGFpbnMgYW4gaW52YWxpZCBVVEYtOCBzZXF1ZW5jZS4KYmFkID0gIiIiwyIiIgo=",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-string-literal", () => {
    const input = Buffer.from(
      "IyBUaGUgZm9sbG93aW5nIGxpbmUgY29udGFpbnMgYW4gaW52YWxpZCBVVEYtOCBzZXF1ZW5jZS4KYmFkID0gJ8MnCg==",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/bad-utf8-in-string", () => {
    const input = Buffer.from(
      "IyBUaGUgZm9sbG93aW5nIGxpbmUgY29udGFpbnMgYW4gaW52YWxpZCBVVEYtOCBzZXF1ZW5jZS4KYmFkID0gIsMiCg==",
      "base64",
    );
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });

  test("invalid/encoding/utf16-bom", () => {
    const input = Buffer.from("/v8AIwAgAFUAVABGAC0AMQA2ACAAdwBpAHQAaAAgAEIATwBNAAo=", "base64");
    let err: unknown;
    try {
      TOML.parse(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SyntaxError);
    expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid UTF-8 byte sequence");
  });
});
