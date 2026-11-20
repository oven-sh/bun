import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { locksEnvironment } from "./hardened";
import { withoutCoreDump } from "./harness/commands";
import { run } from "./harness/run";
import { test } from "./supported";

// BUN_JSC_crashIfInterpreterIsUsed=1 makes a compiled program crash instead of silently running bytecode. It covers regular
// expressions too: a literal of the program must have its machine code in the file that was built.
async function compileAndRun(source: string | Buffer) {
  using dir = tempDir("aot-regexp-literals", { "main.ts": source });
  const cwd = String(dir);
  const { stderr: buildErrors, exitCode: buildExitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "app"],
    cwd,
  );
  expect({ buildErrors, buildExitCode }).toEqual({
    buildErrors: expect.not.stringMatching(/^error\b/m),
    buildExitCode: 0,
  });
  const results = [];
  for (const crashIfInterpreterIsUsed of ["0", "1"]) {
    await using proc = Bun.spawn({
      cmd: withoutCoreDump([join(cwd, "app")]),
      cwd,
      env: {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: crashIfInterpreterIsUsed,
        ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
        BUN_ENABLE_CRASH_REPORTING: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    results.push({ stdout, stderr, hasFailed: exitCode !== 0 || proc.signalCode !== null });
  }
  return { withoutTheOption: results[0], withTheOption: results[1] };
}

// What plain Bun prints for the same text.
async function runPlain(source: string | Buffer) {
  using dir = tempDir("aot-regexp-literals", { "main.ts": source });
  const { stdout, exitCode } = await run([bunExe(), "./main.ts"], String(dir));
  return { stdout, hasFailed: exitCode !== 0 };
}

test("a written empty pattern given to the constructor is compiled", async () => {
  const { withoutTheOption, withTheOption } = await compileAndRun(`
console.log(new RegExp("").test("a"), RegExp("").exec("a")?.index, "abc".replace(new RegExp(""), "-"), "abc".replace(new RegExp("", "g"), "-"), new RegExp("").source, new RegExp("" + "").test(""));
`);
  expect(withTheOption).toEqual(withoutTheOption);
  expect({ stdout: withTheOption.stdout, hasFailed: withTheOption.hasFailed }).toEqual({
    stdout: "true 0 -abc -a-b-c- (?:) true\n",
    hasFailed: false,
  });
});

test("compiled literals, plain-text literals and expressions built at run time go on", async () => {
  const { withoutTheOption, withTheOption } = await compileAndRun(`
const unknownAtBuildTime = Date.now() < 0 ? "x" : "";
const subjects = ["", "abc", "a1-b22", "key = value", "\\u4e2d\\u6587 abc", "2026-10-15", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"];
const expressions = [
  /abc/, /abc/g, /[a-z]+\\d*/, /(?<key>\\w+)\\s*=\\s*(?<value>\\w+)/, /\\p{L}+/u, /(\\d{4})-(\\d{2})-(\\d{2})/, /(a|aa)+b/, /(?<=-)b/, /^$/,
  new RegExp("[a-z]+" + unknownAtBuildTime), new RegExp("abc" + unknownAtBuildTime, "g"), new RegExp("(\\\\d+)-" + unknownAtBuildTime),
];
for (const expression of expressions)
  console.log(String(expression), subjects.map(subject => JSON.stringify(subject.match(expression))).join(" "));
`);
  expect(withTheOption).toEqual(withoutTheOption);
  expect(withTheOption.hasFailed).toBe(false);
  expect(withTheOption.stdout.split("\n").length).toBe(13);
});

test("a literal is compiled as it is written, and a message quotes it so", async () => {
  // U+D800 as a file that is not UTF-8 writes it: the build leaves a pattern with half a surrogate pair to RegExp.
  const half = Buffer.from([0xed, 0xa0, 0x80]);
  const source = Buffer.concat([
    Buffer.from(`
const show = (expression: RegExp, ...subjects: string[]) =>
  console.log(JSON.stringify([expression.source, String(expression), ...subjects.map(subject => expression.test(subject))]));
show(/café/, "café", "cafe");
show(/中文+/u, "中文文", "中");
show(/^[😀-😃]$/u, "😁", "😄");
show(/a\\éb/, "aéb", "a\\\\u00E9b");
show(/[\\–\\—]/, "3", "—");
show(/a\tb/, "a\\tb");
show(/^[\0é]$/v, "\\0", "é", "u");
show(/[\\\\\0]/v, "\\\\", "\\0");
show(/a\0b/v, "a\\0b");
show(/v\0/, "v\\0");
const holder: any = {};
try {
  holder.nothing(/字é😀/u, /a\tb/, /[\0]/v);
} catch (error) {
  console.log(JSON.stringify(String(error)));
}
show(/[`),
    half,
    Buffer.from(`-\\uE000]/, "\\ud900", "a");
`),
  ]);
  const { withoutTheOption, withTheOption } = await compileAndRun(source);
  const plain = await runPlain(source);
  const printed = [
    ["café", "/café/", true, false],
    ["中文+", "/中文+/u", true, false],
    ["^[😀-😃]$", "/^[😀-😃]$/u", true, false],
    ["a\\éb", "/a\\éb/", true, false],
    ["[\\–\\—]", "/[\\–\\—]/", false, true],
    ["a\tb", "/a\tb/", true],
    // Only a raw U+0000 that no backslash escapes, under the v flag, is printed as an escape (oven-sh/WebKit#595).
    ["^[\\u0000é]$", "/^[\\u0000é]$/v", true, true, false],
    ["[\\\\\\u0000]", "/[\\\\\\u0000]/v", true, true],
    ["a\\u0000b", "/a\\u0000b/v", true],
    ["v\0", "/v\0/", true],
    "TypeError: holder.nothing is not a function. (In 'holder.nothing(/字é😀/u, /a\tb/, /[\\u0000]/v)', 'holder.nothing' is undefined)",
    ["[\ud800-\\uE000]", "/[\ud800-\\uE000]/", true, false],
  ];
  const stdout = printed.map(line => JSON.stringify(line) + "\n").join("");
  expect(withTheOption).toEqual(withoutTheOption);
  expect({ stdout: withTheOption.stdout, hasFailed: withTheOption.hasFailed }).toEqual({ stdout, hasFailed: false });
  expect(plain).toEqual({ stdout, hasFailed: false });
});
