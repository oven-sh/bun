import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { test } from "./supported";

// BUN_JSC_crashIfInterpreterIsUsed=1 makes a compiled program crash instead of silently running bytecode. It covers regular
// expressions too: a literal of the program must have its machine code in the file that was built.
async function compileAndRun(source: string) {
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
        BUN_CRASH_REPORT_URL: "",
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

// TODO: with the option the program runs on and names no literal.
test.todo("a literal that cannot be compiled is named and stops the program", async () => {
  // No string is long enough to match, and the compiler of regular expressions does not take counts beyond 2 ** 31 - 1.
  const { withoutTheOption, withTheOption } = await compileAndRun(
    `console.log("before");\nconsole.log(/a{2147483648}/.test("aaa"));\n`,
  );
  expect({ stdout: withoutTheOption.stdout, hasFailed: withoutTheOption.hasFailed }).toEqual({
    stdout: "before\nfalse\n",
    hasFailed: false,
  });
  expect(withTheOption.stderr).toContain("crashIfInterpreterIsUsed: regular expression /a{2147483648}/");
  expect({ stdout: withTheOption.stdout, hasFailed: withTheOption.hasFailed }).toEqual({
    stdout: "before\n",
    hasFailed: true,
  });
});

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
