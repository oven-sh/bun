import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await exited;
  const err = (await stderr.text()).replaceAll("\r\n", "\n");
  const out = (await stdout.text()).replaceAll("\r\n", "\n");
  const expected = (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll(
    "\r\n",
    "\n",
  );

  const errMatch = err === "uh oh\n";
  const outmatch = out === expected;

  if (errMatch && outmatch && exitCode === 0) {
    expect().pass();
    return;
  }

  console.error(err);
  console.log("Length of output:", out.length);
  console.log("Length of expected:", expected.length);
  console.log("Exit code:", exitCode);

  expect(out).toBe(expected);
  expect(err).toBe("uh oh\n");
  expect(exitCode).toBe(0);
});

it("long arrays get cutoff", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(Array(1000).fill(0))).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]",
  );
});

it("long arrays get cutoff at a nested indent", () => {
  const row = "          4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,\n";
  expect(Bun.inspect([[[[Array(1000).fill(4)]]]], { depth: 5 })).toEqual(
    "[\n  [\n    [\n      [\n        [\n" +
      row +
      row +
      row +
      row +
      "          4, 4, 4, 4,\n" +
      "          ... 900 more items\n" +
      "        ]\n      ]\n    ]\n  ]\n]",
  );
});

it("console.dir treats a BigInt depth like the same number", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let o = {}, c = o; for (let i = 0; i < 40; i++) { c.n = {}; c = c.n; }
       for (const depth of [7n, 7, -1n, -1]) {
         console.dir(o, { depth, colors: false });
         console.log("--");
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [big7, num7, bigNegative, numNegative] = stdout.split("--\n");
  expect(big7).toBe(num7);
  expect(bigNegative).toBe(numNegative);
  expect(exitCode).toBe(0);
});

it("console.group", async () => {
  const filepath = join(import.meta.dir, "console-group.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv, "BUN_JSC_showPrivateScriptsInStackTraces": "0" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  let stdout = proc.stdout
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>");
  let stderr = proc.stderr
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>")
    // Normalize line numbers for consistency between debug and release builds
    .replace(/\(\d+:\d+\)/g, "(N:NN)")
    .replace(/<file>:\d+:\d+/g, "<file>:NN:NN");
  expect(stdout).toMatchInlineSnapshot(`
"Basic group
  Inside basic group
Outer group
  Inside outer group
  Inner group
    Inside inner group
  Back to outer group
Level 1
  Level 2
    Level 3
      Deep inside
undefined
Empty nested
Test extra end
  Inside
Different logs
  Regular log
  Info log
  Debug log
Complex types
  {
    a: 1,
    b: 2,
  }
  [ 1, 2, 3 ]
null
  undefined
    0
      false
        
          Inside falsy groups
🎉 Unicode!
  Inside unicode group
  Tab\tNewline
Quote"Backslash
    Special chars"
`);
  expect(stderr).toMatchInlineSnapshot(`
"Warning log
  warn: console.warn an error
      at <file>:NN:NN

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                       ^
error: console.error an error
      at <file>:NN:NN

  53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
58 | console.error(new NamedError("console.error a named error"));
                   ^
NamedError: console.error a named error
      at <file>:NN:NN

  NamedError: console.warn a named error
      at <file>:NN:NN

  Error log"
`);
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

describe.concurrent("console %d, %i and %f", () => {
  async function run(script: string, env: NodeJS.Dict<string> = bunEnv) {
    await using proc = spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A value, then what console.log("%d", value), console.log("%i", value) and console.log("%f", value) print.
  // The %i and %f columns are what node v26.3.0 prints. %d prints the integer part of Number(value).
  const rows: [value: string, d: string, i: string, f: string][] = [
    // int32
    ["0", "0", "0", "0"],
    ["42", "42", "42", "42"],
    ["-7", "-7", "-7", "-7"],
    ["2147483647", "2147483647", "2147483647", "2147483647"],
    ["-2147483648", "-2147483648", "-2147483648", "-2147483648"],
    // Numbers that hold an integer
    ["2147483648", "2147483648", "2147483648", "2147483648"],
    ["-2147483649", "-2147483649", "-2147483649", "-2147483649"],
    ["4294967296", "4294967296", "4294967296", "4294967296"],
    ["1700000000000", "1700000000000", "1700000000000", "1700000000000"],
    ["2 ** 53 - 1", "9007199254740991", "9007199254740991", "9007199254740991"],
    ["-(2 ** 53 - 1)", "-9007199254740991", "-9007199254740991", "-9007199254740991"],
    ["2 ** 53", "9007199254740992", "9007199254740992", "9007199254740992"],
    ["2 ** 53 + 2", "9007199254740994", "9007199254740994", "9007199254740994"],
    ["2 ** 60", "1152921504606847000", "1152921504606847000", "1152921504606847000"],
    ["2 ** 63", "9223372036854776000", "9223372036854776000", "9223372036854776000"],
    ["2 ** 64", "18446744073709552000", "18446744073709552000", "18446744073709552000"],
    ["123456789012345680000", "123456789012345680000", "123456789012345680000", "123456789012345680000"],
    ["1e21", "1", "1", "1e+21"],
    ["-1e21", "-1", "-1", "-1e+21"],
    ["1.5e300", "1", "1", "1.5e+300"],
    ["Number.MAX_VALUE", "1", "1", "1.7976931348623157e+308"],
    // Numbers with a fraction, and the Numbers that are not finite
    ["3.9", "3", "3", "3.9"],
    ["-3.9", "-3", "-3", "-3.9"],
    ["0.5", "0", "0", "0.5"],
    ["-0.5", "0", "-0", "-0.5"],
    ["-0", "0", "0", "0"],
    ["0.1 + 0.2", "0", "0", "0.30000000000000004"],
    ["2147483648.7", "2147483648", "2147483648", "2147483648.7"],
    ["-2147483649.7", "-2147483649", "-2147483649", "-2147483649.7"],
    ["-0.9999999", "0", "-0", "-0.9999999"],
    ["0.000001", "0", "0", "0.000001"],
    ["0.00000099", "9", "9", "9.9e-7"],
    ["999999999999998.25", "999999999999998", "999999999999998", "999999999999998.2"],
    ["-1000000000000000.25", "-1000000000000000", "-1000000000000000", "-1000000000000000.2"],
    ["5e-7", "5", "5", "5e-7"],
    ["-8.5e-12", "-8", "-8", "-8.5e-12"],
    ["Number.MIN_VALUE", "5", "5", "5e-324"],
    ["Number.MIN_VALUE * 1.5", "1", "1", "1e-323"],
    ["Infinity", "NaN", "NaN", "Infinity"],
    ["-Infinity", "NaN", "NaN", "-Infinity"],
    ["NaN", "NaN", "NaN", "NaN"],
    // Strings
    ["'42'", "42", "42", "42"],
    ["'42abc'", "NaN", "42", "42"],
    ["'3.14xyz'", "NaN", "3", "3.14"],
    ["''", "0", "NaN", "NaN"],
    ["'abc'", "NaN", "NaN", "NaN"],
    ["'0xff'", "255", "255", "0"],
    ["'0XFF'", "255", "255", "0"],
    ["'-0x1A'", "NaN", "-26", "-0"],
    ["'  12  '", "12", "12", "12"],
    ["'\\t\\n 7'", "7", "7", "7"],
    ["'1e3'", "1000", "1", "1000"],
    ["'-0'", "0", "-0", "-0"],
    ["'-0.0'", "0", "-0", "-0"],
    ["'+5'", "5", "5", "5"],
    ["'-.5'", "0", "NaN", "-0.5"],
    ["'.5'", "0", "NaN", "0.5"],
    ["'5.'", "5", "5", "5"],
    ["'Infinity'", "NaN", "NaN", "Infinity"],
    ["'-Infinity'", "NaN", "NaN", "-Infinity"],
    ["'+Infinity'", "NaN", "NaN", "Infinity"],
    ["'Infinityx'", "NaN", "NaN", "Infinity"],
    ["'infinity'", "NaN", "NaN", "NaN"],
    ["'NaN'", "NaN", "NaN", "NaN"],
    ["'1_000'", "NaN", "1", "1"],
    ["'0b11'", "3", "0", "0"],
    ["'0o17'", "15", "0", "0"],
    ["'12345678901234567890'", "12345678901234567000", "12345678901234567000", "12345678901234567000"],
    ["'9007199254740993'", "9007199254740992", "9007199254740992", "9007199254740992"],
    ["'1e400'", "NaN", "1", "Infinity"],
    ["'-1e400'", "NaN", "-1", "-Infinity"],
    // Strings that are not ASCII, in 8 bits and in 16 bits
    ["'\\u00a042.5'", "42", "42", "42.5"],
    ["'\\u00e942'", "NaN", "NaN", "NaN"],
    ["'42\\u00e9'", "NaN", "42", "42"],
    ["'\\ufeff42.5'", "42", "42", "42.5"],
    ["'\\u300042.5px'", "NaN", "42", "42.5"],
    ["'\\u202842'", "42", "42", "42"],
    ["'\\u180e42'", "NaN", "NaN", "NaN"],
    ["'4\\uff12'", "NaN", "4", "4"],
    ["'\\u0663'", "NaN", "NaN", "NaN"],
    ["'42.5\\u{1f600}'", "NaN", "42", "42.5"],
    ["'Infinity\\u{1f600}'", "NaN", "NaN", "Infinity"],
    ["'\\u3000-Infinityx'", "NaN", "NaN", "-Infinity"],
    // BigInt
    ["12n", "12n", "12n", "12"],
    ["0n", "0n", "0n", "0"],
    ["-12345678901234567890n", "-12345678901234567890n", "-12345678901234567890n", "-12345678901234567000"],
    ["2n ** 64n", "18446744073709551616n", "18446744073709551616n", "18446744073709552000"],
    ["Object(5n)", "5", "5", "5"],
    ["({ valueOf() { return 5n; } })", "5", "NaN", "NaN"],
    // Symbol
    ["Symbol('x')", "NaN", "NaN", "NaN"],
    ["Symbol.iterator", "NaN", "NaN", "NaN"],
    // The rest: ToNumber for %d, ToString for %i and %f
    ["null", "0", "NaN", "NaN"],
    ["undefined", "NaN", "NaN", "NaN"],
    ["true", "1", "NaN", "NaN"],
    ["false", "0", "NaN", "NaN"],
    ["[]", "0", "NaN", "NaN"],
    ["[5]", "5", "5", "5"],
    ["[1, 2, 3, 4, 5]", "NaN", "1", "1"],
    ["[3.9]", "3", "3", "3.9"],
    ["['0x10']", "16", "16", "0"],
    ["[[7]]", "7", "7", "7"],
    ["({})", "NaN", "NaN", "NaN"],
    ["({ valueOf() { return 7; } })", "7", "NaN", "NaN"],
    ["({ toString() { return '8.5'; } })", "8", "8", "8.5"],
    ["({ [Symbol.toPrimitive](hint) { return hint === 'string' ? '9' : 5; } })", "5", "9", "9"],
    ["new Date(0)", "0", "NaN", "NaN"],
    ["new Number(4.5)", "4", "4", "4.5"],
    ["new String('6.5')", "6", "6", "6.5"],
    ["new Boolean(true)", "1", "NaN", "NaN"],
    ["(function () {})", "NaN", "NaN", "NaN"],
    ["/7/", "NaN", "NaN", "NaN"],
    ["new Map()", "NaN", "NaN", "NaN"],
  ];

  it.each([
    ["NO_COLOR", bunEnv],
    ["FORCE_COLOR", { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" }],
  ])("print the rows of the table (%s)", async (_, env) => {
    const { stdout, exitCode } = await run(
      `
      const values = ${JSON.stringify(rows.map(row => row[0]))}.map(source => new Function("return " + source)());
      for (const value of values) {
        for (const specifier of ["%d", "%i", "%f"]) {
          try {
            console.log(specifier, value);
          } catch (e) {
            console.log("throws " + e);
          }
        }
      }
    `,
      env,
    );
    const lines = stdout.split("\n");
    expect({
      printed: rows.map(([value], index) => [value, ...lines.slice(index * 3, index * 3 + 3)]),
      lines: lines.length,
      exitCode,
    }).toEqual({ printed: rows, lines: rows.length * 3 + 1, exitCode: 0 });
  });

  it("print what util.format returns for %i and %f, and the integer part for %d, of generated values", async () => {
    const { stdout, exitCode } = await run(`
      import util from "node:util";
      let seed = 0x2f6e2b1;
      const random = () => {
        seed ^= seed << 13;
        seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        seed >>>= 0;
        return seed;
      };
      const pick = list => list[random() % list.length];
      const values = [];

      // Numbers: any bit pattern, then steps around the values where the text changes its form or its digits tie.
      const bits = new DataView(new ArrayBuffer(8));
      for (let index = 0; index < 60; index++) {
        bits.setUint32(0, random());
        bits.setUint32(4, random());
        values.push(bits.getFloat64(0));
      }
      for (const edge of [1e15, -1e15, 2 ** 53, 1e21, 1e-6, -1]) {
        for (let step = -3; step <= 3; step++) values.push(edge + step * 0.25, edge * (1 + step / 64));
      }

      // Strings: each one flat, as a rope and as a substring of a longer string.
      const prefixes = ["", "", " ", "\\t\\n", "\\u00a0", "\\ufeff", "\\u2028", "\\u3000", "\\u180e"];
      const signs = ["", "", "+", "-", "--"];
      const bodies = [
        "42", "42.5", "0x1f", "0X1F", "0b11", "0o17", ".5", "5.", "1e3", "1e400", "1e-7", "Infinity", "Infinit", "infinity",
        "NaN", "", "1_000", "12345678901234567890123", "9007199254740993", "0.0000001", "007", "\\u0663", "\\uff11",
      ];
      const suffixes = ["", "", " ", "px", "e", ".5", "\\u00e9", "\\u3000", "\\u{1f600}", "n", ",2"];
      const texts = bodies.flatMap(body => [0, 1].map(() => pick(prefixes) + pick(signs) + body + pick(suffixes)));
      for (const text of JSON.parse(JSON.stringify(texts))) {
        const half = text.length >> 1;
        const padded = "<<" + text + ">>";
        padded.charCodeAt(0);
        values.push(text, text.slice(0, half) + text.slice(half), padded.slice(2, padded.length - 2));
      }

      // console.log() runs first: util.format() would flatten the rope.
      const specifiers = ["%d", "%i", "%f"];
      for (const value of values) for (const specifier of specifiers) console.log(specifier, value);
      // %d: the integer part of Number(value). Its zero has no sign.
      const integerPart = value => String(parseInt(Number(value)) + 0);
      console.log(JSON.stringify(values.map(value => [integerPart(value), util.format("%i", value), util.format("%f", value)])));
    `);
    const lines = stdout.split("\n");
    const expected: string[][] = JSON.parse(lines[lines.length - 2]);
    expect({
      printed: expected.map((_, index) => lines.slice(index * 3, index * 3 + 3)),
      values: expected.length,
      lines: lines.length,
      exitCode,
    }).toEqual({ printed: expected, values: 282, lines: 282 * 3 + 2, exitCode: 0 });
  });

  it("convert the same way at every console method and in a Worker", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const value = [1, 2, 3, 4, 5];
      for (const method of ["log", "info", "debug", "warn", "error", "trace", "dirxml", "group", "groupCollapsed"]) {
        console[method](method + " %i|", value);
        if (method.startsWith("group")) console.groupEnd();
      }
      const source = 'console.log("Worker %i|", [1, 2, 3, 4, 5]);';
      new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));
    `);
    // console.trace() prints a stack trace after its line.
    const substituted = (output: string) => output.split("\n").filter(line => line.endsWith("|"));
    expect({ stdout: substituted(stdout), stderr: substituted(stderr), exitCode }).toEqual({
      stdout: ["log 1|", "info 1|", "debug 1|", "trace 1|", "dirxml 1|", "group 1|", "groupCollapsed 1|", "Worker 1|"],
      stderr: ["warn 1|", "error 1|"],
      exitCode: 0,
    });
  });

  // The test runner sets BUN_JSC_validateExceptionChecks=1 for debug and ASAN builds. There console.assert(false) aborts
  // in consoleProtoFuncAssert, with or without a format string. #44950 (oven-sh/WebKit#790) fixes that. Remove the gate with it.
  it.todoIf(isDebug || isASAN)("convert the same way at console.assert", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.assert(false, "assert %i %d %f|", [1, 2, 3, 4, 5], 12n, "2.5px");`,
    );
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "assert 1 12n 2.5|\n", exitCode: 0 });
  });

  it("run the conversion of each argument once and in order, and pass on what it throws", async () => {
    const { stdout, exitCode } = await run(`
      const calls = [];
      const tracked = name => ({
        toString() { calls.push(name + ".toString"); return "7.5"; },
        valueOf() { calls.push(name + ".valueOf"); return 3.5; },
      });
      console.log("%i %d %f", tracked("i"), tracked("d"), tracked("f"), tracked("extra"));
      console.log(JSON.stringify(calls.splice(0)));

      for (const specifier of ["%d", "%i", "%f"]) {
        try {
          console.log(specifier, {
            toString() { throw new RangeError("toString for " + specifier); },
            valueOf() { throw new RangeError("valueOf for " + specifier); },
          });
        } catch (e) {
          console.log("caught " + e.name + ": " + e.message);
        }
      }

      // A Symbol prints NaN and runs no code.
      for (const key of ["toString", "valueOf", Symbol.toPrimitive]) {
        Object.defineProperty(Symbol.prototype, key, { value() { calls.push("Symbol.prototype"); return 1; } });
      }
      console.log("%d %i %f", Symbol("d"), Symbol("i"), Symbol("f"));
      console.log(JSON.stringify(calls));

      // The conversions are the intrinsic ones.
      globalThis.parseInt = Number.parseInt = globalThis.parseFloat = Number.parseFloat = globalThis.Number = () => 99;
      console.log("%i %f %d", "5", "5.5", "5");
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "7 3 7.5 {",
          "  toString: [Function: toString],",
          "  valueOf: [Function: valueOf],",
          "}",
          '["i.toString","d.valueOf","f.toString"]',
          "caught RangeError: valueOf for %d",
          "caught RangeError: toString for %i",
          "caught RangeError: toString for %f",
          "NaN NaN NaN",
          "[]",
          "5 5.5 5",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });
});
