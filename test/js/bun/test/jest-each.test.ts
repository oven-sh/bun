import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

describe.concurrent("titles", () => {
  /** Runs `test.each(<table>)(<title>, () => {})` for every `[title, table]` and returns the names of the tests. */
  async function titlesOf(cases: [title: string, table: string][], prelude = "") {
    using dir = tempDir("jest-each-titles", {
      "each.test.ts": [
        `import { test } from "bun:test";`,
        prelude,
        ...cases.map(([title, table]) => `test.each(${table})(${JSON.stringify(title)}, () => {});`),
      ].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "each.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const titles = stderr
      .split("\n")
      .filter(line => line.startsWith("(pass) "))
      .map(line => line.slice("(pass) ".length).replace(/ \[[\d.]+ms\]$/, ""));
    return { titles, exitCode };
  }

  // https://github.com/oven-sh/bun/issues/37821
  it("fills a placeholder whatever the type of the value", async () => {
    expect(
      await titlesOf([
        ["string via %s: %s", `["alpha"]`],
        ["integer via %s: %s", `[1]`],
        ["float via %s: %s", `[0.8]`],
        ["mixed tuple via %s: %s then %s", `[["x", 1]]`],
        ["integers via %i: %i and %i", `[[1, 2]]`],
        ["float via %i: %i", `[0.8]`],
        ["float via %d: %d", `[0.8]`],
        ["float via %f: %f", `[0.8]`],
        ["float via %p: %p", `[0.8]`],
        ["row %j shows %s", `[[{ a: 1 }, false], [{ a: 2 }, undefined]]`],
        ["flag %s gives %j", `[[true, [1, 2]]]`],
        ["value %s", `[[undefined], [null]]`],
        ["number %s", `[[1], [0]]`],
      ]),
    ).toEqual({
      titles: [
        "string via alpha: %s",
        "integer via 1: %s",
        "float via 0.8: %s",
        "mixed tuple via x: 1 then %s",
        "integers via 1: 2 and %i",
        "float via 0: %i",
        "float via 0.8: %d",
        "float via 0.8: %f",
        "float via 0.8: %p",
        'row {"a":1} shows false',
        'row {"a":2} shows undefined',
        "flag true gives [1,2]",
        "value undefined",
        "value null",
        "number 1",
        "number 0",
      ],
      exitCode: 0,
    });
  });

  it("%s is String(value), and objects without their own toString() are printed", async () => {
    expect(
      await titlesOf(
        [
          ["%s", `["", "a%sb", "$a", -0, 1.5, NaN, -Infinity, 1e21, 10n, true, Symbol("sym"), Symbol()]`],
          [
            "%s",
            `[[{}], [{ a: 1, s: "x" }], [{ a: { b: [1, { c: 2 }] } }], [[]], [[1, [2, "x"]]], [Object.create(null)]]`,
          ],
          ["%s", `[[new Plain()], [new Custom()], [new Inherits()], [{ toString: () => "own" }], [{ toString: 1 }]]`],
          [
            "%s",
            `[[new CustomArray()], [new Date(0)], [/re/g], [new Map([[1, 2]])], [new Set([1])], [new Uint8Array(2)]]`,
          ],
          ["%s", `[[new TypeError("boom")], [new URL("http://a.b/c")], [() => 1]]`],
        ],
        `
          class Plain { x = 1 }
          class Custom { toString() { return "custom"; } }
          class Inherits extends Custom {}
          class CustomArray extends Array { toString() { return "custom array"; } }
        `,
      ),
    ).toEqual({
      titles: [
        "",
        "a%sb",
        "$a",
        "-0",
        "1.5",
        "NaN",
        "-Infinity",
        "1e+21",
        "10n",
        "true",
        "Symbol(sym)",
        "Symbol()",
        "{}",
        '{ a: 1, s: "x" }',
        "{ a: { b: [ 1, { c: 2 } ] } }",
        "[]",
        '[ 1, [ 2, "x" ] ]',
        "[Object: null prototype] {}",
        "Plain { x: 1 }",
        "custom",
        "custom",
        "own",
        "{ toString: 1 }",
        "custom array",
        "1970-01-01T00:00:00.000Z",
        "/re/g",
        "Map(1) { 1: 2 }",
        "Set(1) { 1 }",
        "0,0",
        "TypeError: boom",
        "http://a.b/c",
        "() => 1",
      ],
      exitCode: 0,
    });
  });

  it("%d is Number(value), %i is parseInt(value), %f is parseFloat(value)", async () => {
    const values = `[-0, 1.9, -1.9, 1e21, 1e-7, NaN, Infinity, 10n, true, null, undefined, Symbol("s"), {}, [], [7.5], new Date(5),
      { valueOf: () => 7 }, "", "42", " \\n\\u00a012.5px", "-7.9", "+3", "0x1F", "-0x10", "0x", "1e3", ".5", "-.5e1", "-0", "-Infinity", "Infinityx", "abc"]`;
    const { titles, exitCode } = await titlesOf([["%d|%i|%f", `${values}.map(value => [value, value, value])`]]);
    expect({ titles, exitCode }).toEqual({
      titles: [
        "-0|0|0",
        "1.9|1|1.9",
        "-1.9|-1|-1.9",
        "1e+21|1|1e+21",
        "1e-7|1|1e-7",
        "NaN|NaN|NaN",
        "Infinity|NaN|Infinity",
        "10n|10n|10",
        "1|NaN|NaN",
        "0|NaN|NaN",
        "NaN|NaN|NaN",
        "NaN|NaN|NaN",
        "NaN|NaN|NaN",
        "0|NaN|NaN",
        "7.5|7|7.5",
        "5|NaN|NaN",
        "7|NaN|NaN",
        "0|NaN|NaN",
        "42|42|42",
        "NaN|12|12.5",
        "-7.9|-7|-7.9",
        "3|3|3",
        "31|31|0",
        "NaN|-16|-0",
        "NaN|NaN|0",
        "1000|1|1000",
        "0.5|NaN|0.5",
        "-5|NaN|-5",
        "-0|-0|-0",
        "-Infinity|NaN|-Infinity",
        "NaN|NaN|Infinity",
        "NaN|NaN|NaN",
      ],
      exitCode: 0,
    });
  });

  it("%j is JSON.stringify(value)", async () => {
    expect(
      await titlesOf(
        [
          [
            "%j",
            `[["x"], [-0], [NaN], [undefined], [() => {}], [Symbol("s")], [{ a: [1, { b: null }], c: undefined }], [new Date(0)], [cyclic], [1n], [{ a: [1n] }]]`,
          ],
        ],
        `const cyclic: any = { a: 1 }; cyclic.self = cyclic;`,
      ),
    ).toEqual({
      titles: [
        '"x"',
        "0",
        "null",
        "undefined",
        "undefined",
        "undefined",
        '{"a":[1,{"b":null}]}',
        '"1970-01-01T00:00:00.000Z"',
        "[Circular]",
        "1n",
        "{ a: [ 1n ] }",
      ],
      exitCode: 0,
    });
  });

  it("%p, %o and %O print the value on one line", async () => {
    expect(
      await titlesOf([
        [
          "%p|%o|%O",
          `["x", -0, 1n, null, undefined, Symbol("s"), { a: { b: "x" }, c: [1, "y"] }, [[1, [2]]], function named() {}, new RangeError("boom")].map(value => [value, value, value])`,
        ],
      ]),
    ).toEqual({
      titles: [
        '"x"|"x"|"x"',
        "-0|-0|-0",
        "1n|1n|1n",
        "null|null|null",
        "undefined|undefined|undefined",
        "Symbol(s)|Symbol(s)|Symbol(s)",
        '{ a: { b: "x" }, c: [ 1, "y" ] }|{ a: { b: "x" }, c: [ 1, "y" ] }|{ a: { b: "x" }, c: [ 1, "y" ] }',
        "[ [ 1, [ 2 ] ] ]|[ [ 1, [ 2 ] ] ]|[ [ 1, [ 2 ] ] ]",
        "[Function: named]|[Function: named]|[Function: named]",
        "[RangeError: boom]|[RangeError: boom]|[RangeError: boom]",
      ],
      exitCode: 0,
    });
  });

  it("%#, %$ and %% take no value, and anything else after a % is kept", async () => {
    expect(
      await titlesOf([
        ["%# %$ %# %$ %s", `["a", "b"]`],
        ["%s is 100%% %# %$", `["a"]`],
        ["%%s %%%s %%%%", `["a"]`],
        ["%x %z%s %", `["a"]`],
        ["%s %s %d %j", `[["a"]]`],
        ["%s", `[["a", "b", "c"]]`],
        ["none", `[["a", "b"]]`],
        ["%s %% %# %$", `[[]]`],
        ["%s %s", `[["%s", "%%"]]`],
        ["%j %s", `[[{ a: "%s" }, "b"]]`],
        ["%c%s", `[["css", "b"]]`],
        ["%s|%s", `[[, 1]]`],
      ]),
    ).toEqual({
      titles: [
        "0 1 0 1 a",
        "1 2 1 2 b",
        "a is 100% 0 1",
        "%s %a %%",
        "%x %za %",
        "a %s %d %j",
        "a",
        "none",
        "%s % 0 1",
        "%s %%",
        '{"a":"%s"} b',
        "b",
        "undefined|1",
      ],
      exitCode: 0,
    });
  });

  it("$variable reads the row", async () => {
    expect(
      await titlesOf([
        [
          "$a",
          `[{ a: 1 }, { a: "s" }, { a: "" }, { a: null }, { a: undefined }, { a: -0 }, { a: 1n }, { a: Symbol("q") }]`,
        ],
        ["$a", `[{ a: { b: { c: "x" } } }, { a: [1, "x"] }, { a: new Error("boom") }, { get a() { return "got"; } }]`],
        [
          "$a.b.c|$a.b|$a.length|$a.0",
          `[{ a: { b: { c: 1 } } }, { a: { b: null } }, { a: null }, { a: "str" }, { a: [5] }, {}]`,
        ],
        ["$# $a $#", `[{ a: 1 }, { a: 2 }]`],
        ["$missing $a|$ab $abc", `[{ a: 1, ab: 2 }]`],
        ["$a. $a, ($a) $a-b $" + "{a} $1 $ $", `[{ a: 1 }]`],
        ["$_a $a_b $a1 $$d", `[{ _a: 1, a_b: 2, a1: 3, $d: 4 }]`],
        ["$hé $名前 $a→ $aé", `[{ "hé": 1, "名前": 2, a: 3 }]`],
        ["$a 100%% %# %$ %s", `[{ a: 1 }]`],
        ["$a", `[{ a: "%s $b", b: 2 }]`],
        ["$a $b %s", `[[{ a: 1 }, { b: 2 }]]`],
        ["$a $#", `[1, "s", null, [1]]`],
      ]),
    ).toEqual({
      titles: [
        "1",
        "s",
        "",
        "null",
        "undefined",
        "-0",
        "1n",
        "Symbol(q)",
        '{ b: { c: "x" } }',
        '[ 1, "x" ]',
        "[Error: boom]",
        "got",
        "1|{ c: 1 }|$a.length|$a.0",
        "$a.b.c|null|$a.length|$a.0",
        "$a.b.c|$a.b|$a.length|$a.0",
        "$a.b.c|$a.b|3|s",
        "$a.b.c|$a.b|1|5",
        "$a.b.c|$a.b|$a.length|$a.0",
        "0 1 0",
        "1 2 1",
        "$missing 1|2 $abc",
        "1. 1, (1) 1-b $" + "{a} $1 $ $",
        "1 2 3 4",
        "1 2 3→ $aé",
        "1 100% 0 1 { a: 1 }",
        "%s $b",
        "1 $b { a: 1 }",
        "$a $#",
        "$a $#",
        "$a $#",
        "$a $#",
      ],
      exitCode: 0,
    });
  });

  it("describe.each formats its title the same way", async () => {
    using dir = tempDir("jest-each-describe-titles", {
      "each.test.ts": `
        import { describe, test } from "bun:test";
        describe.each([[1, { a: 1 }], [null, [2]]])("%s and %j (%#)", () => {
          test("inner", () => {});
        });
        describe.each([{ n: 0 }])("$n is row $#", () => {
          test("inner", () => {});
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "each.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({
      titles: stderr
        .split("\n")
        .filter(line => line.startsWith("(pass) "))
        .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
      exitCode,
    }).toEqual({
      titles: ['(pass) 1 and {"a":1} (0) > inner', "(pass) null and [2] (1) > inner", "(pass) 0 is row 0 > inner"],
      exitCode: 0,
    });
  });

  it("an error thrown while a placeholder reads its value is thrown by each()()", async () => {
    using dir = tempDir("jest-each-title-throws", {
      "each.test.ts": `
        import { expect, test } from "bun:test";
        const thrower = () => { throw new Error("thrown by the value"); };
        for (const [title, table] of [
          ["%s", [[{ toString: thrower }]]],
          ["%d", [[{ valueOf: thrower }]]],
          ["%i", [[{ toString: thrower }]]],
          ["%f", [[{ toString: thrower }]]],
          ["%j", [[{ toJSON: thrower }]]],
          ["$a", [{ get a() { thrower(); } }]],
        ] as const) {
          expect(() => test.each(table)(title, () => {})).toThrow("thrown by the value");
        }
        test("after", () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "each.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ passed: stderr.split("\n").filter(line => line.startsWith("(pass) ")).length, exitCode }).toEqual({
      passed: 1,
      exitCode: 0,
    });
  });
});

it("prints rows that are not an array as the messages of matchers print values", () => {
  const rows = {
    get computed() {
      return 1;
    },
  };
  // @ts-expect-error
  expect(() => it.each(rows)).toThrow("Expected array, got {\n  computed: 1,\n}");
  // @ts-expect-error
  expect(() => describe.for(rows)).toThrow("Expected array, got {\n  computed: 1,\n}");
  // @ts-expect-error
  expect(() => it.each("text")).toThrow("Expected array, got text");
});
