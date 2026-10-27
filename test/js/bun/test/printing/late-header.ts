import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Calls that a test can make, for the reporters that print the file header late (`--dots`, `--only-failures`). `prints`
 * is what the call writes to stdout or stderr. An empty string is a call that writes nothing. The calls run in this
 * order in one process, so a timer or a counter from one entry is still there for the next entries.
 */
const calls = [
  // No console.time() has run in the process yet.
  { name: "timeEnd-before-any-timer", call: `console.timeEnd("early")`, prints: "" },
  { name: "timeLog-before-any-timer", call: `console.timeLog("early")`, prints: "" },

  { name: "count", call: `console.count("count-label")`, prints: "count-label: 1\n" },
  {
    name: "timeEnd",
    call: `console.time("end-label"); console.timeEnd("end-label")`,
    prints: "[<elapsed>] end-label\n",
  },
  {
    name: "timeLog",
    call: `console.time("log-label"); console.timeLog("log-label")`,
    prints: "[<elapsed>] log-label\n",
  },
  {
    name: "timeLog-arguments",
    call: `console.timeLog("log-label", "extra", 1)`,
    prints: "[<elapsed>] log-label extra 1\n",
  },
  { name: "assert-false", call: `console.assert(false)`, prints: "Assertion failed\n" },

  { name: "log", call: `console.log("log-line")`, prints: "log-line\n" },
  { name: "log-no-arguments", call: `console.log()`, prints: "\n" },
  { name: "warn", call: `console.warn("warn-line")`, prints: "warn-line\n" },
  { name: "assert-message", call: `console.assert(false, "assert-message")`, prints: "assert-message\n" },
  // The test runner prints the reason when the promise of a custom matcher rejects.
  {
    name: "rejected-matcher",
    call: `expect.extend({ toRejectLater: () => Promise.reject("matcher-rejected") });
  try {
    expect(1).toRejectLater();
  } catch {}`,
    prints: "error: matcher-rejected\nmatcher-rejected\n",
  },

  { name: "timeEnd-unknown-label", call: `console.timeEnd("unknown-label")`, prints: "" },
  { name: "timeLog-unknown-label", call: `console.timeLog("unknown-label")`, prints: "" },
  // The "timeEnd" entry ended this timer.
  { name: "timeEnd-ended-timer", call: `console.timeEnd("end-label")`, prints: "" },
  { name: "timeLog-ended-timer", call: `console.timeLog("end-label")`, prints: "" },
  { name: "time", call: `console.time("time-label")`, prints: "" },
  { name: "countReset", call: `console.countReset("count-label")`, prints: "" },
  { name: "assert-true", call: `console.assert(true)`, prints: "" },
  // Colors are off in the test environment, so this writes no escape sequence.
  { name: "clear", call: `console.clear()`, prints: "" },
];

/** One test file per call: a test that passes, a test that makes the call, a test that passes. */
export const lateHeaderFiles = calls.map(({ name, call, prints }, index) => ({
  file: `${String(index).padStart(2, "0")}-${name}.test.ts`,
  source: `import { expect, test } from "bun:test";
test("before", () => {});
test("call", () => {
  ${call};
});
test("after", () => {});
`,
  prints,
}));

/**
 * Runs `lateHeaderFiles` under `bun test <reporter>`. stdout and stderr share one file, so `output` has the order a
 * terminal shows.
 */
export async function runLateHeaderFiles(reporter: "--dots" | "--only-failures") {
  using dir = tempDir("late-header", Object.fromEntries(lateHeaderFiles.map(({ file, source }) => [file, source])));
  const log = join(String(dir), "output.log");
  const fd = openSync(log, "w");
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", reporter, ...lateHeaderFiles.map(({ file }) => `./${file}`)],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // A console.assert that fails aborts a build that validates exception checks: #44950.
        BUN_JSC_validateExceptionChecks: undefined,
        BUN_JSC_dumpSimulatedThrows: undefined,
      },
      stdout: fd,
      stderr: fd,
    });
    const exitCode = await proc.exited;
    const output = readFileSync(log, "utf8")
      .replaceAll("\r\n", "\n")
      .replaceAll(Bun.version_with_sha, "<version> (<revision>)")
      .replace(/\[\d+\.\d+m?s\]/g, "[<elapsed>]");
    return { output, exitCode };
  } finally {
    closeSync(fd);
  }
}
