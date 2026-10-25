// Each rule of `Schema` that JSON Schema needs, and tuples with optional and rest elements, written as types in ./programs.
// A program holds its own table of verdicts and of results, and prints what departs from it. Its last line also counts the getters and traps that were asked
// a second time, and the methods of a value and replaced built-ins that were called: there are none.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const programs = join(import.meta.dir, "programs");

test.each([
  "unique-items",
  "contains",
  "not",
  "if",
  "one-of",
  "all-of",
  "pattern-properties",
  "property-names",
  "member-counts",
  "dependent-required",
  "dependent-schemas",
  "formats",
  "tuples",
  "a-test-builds-nothing",
  "values-that-the-program-makes",
  "built-ins-that-are-replaced",
  "time-is-linear",
  "depth-ends-in-a-range-error",
  "a-check-that-ended-early-leaves-nothing-behind",
  "a-search-that-gives-up",
])(
  "%s.ts",
  async name => {
    using dir = tempDir("validation-rule-" + name, {});
    const executable = join(String(dir), process.platform === "win32" ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", join(programs, name + ".ts"), "--outfile", executable],
      programs,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([executable], String(dir));
    expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stdout: expect.stringMatching(/^same [1-9][0-9]* other 0 read again 0 called 0\n$/),
      stderr: "",
      exitCode: 0,
    });
  },
  isASAN || isDebug ? 900_000 : 240_000,
);

// TODO: an object is copied once for each place it stands at. A check with a rule of `Schema` ends in a RangeError at 16,777,216 objects, after seconds.
// A check without one goes on until the heap is full. When an object that is met twice is copied and judged once, this program joins the list above.
test.todo(
  "shared-objects.ts",
  async () => {
    using dir = tempDir("validation-rule-shared-objects", {});
    const executable = join(String(dir), process.platform === "win32" ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", join(programs, "shared-objects.ts"), "--outfile", executable],
      programs,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([executable], String(dir));
    expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stdout: expect.stringMatching(/^same [1-9][0-9]* other 0 read again 0 called 0\n$/),
      stderr: "",
      exitCode: 0,
    });
  },
  isASAN || isDebug ? 900_000 : 240_000,
);

// TODO: each search has a budget of its own, so none of the four checks ends in a RangeError. When all the searches of a call share one, this program joins the list above.
test(
  "one-budget-a-call.ts",
  async () => {
    using dir = tempDir("validation-rule-one-budget-a-call", {});
    const executable = join(String(dir), process.platform === "win32" ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", join(programs, "one-budget-a-call.ts"), "--outfile", executable],
      programs,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([executable], String(dir));
    expect({ lastLine: stdout.trimEnd().split("\n").at(-1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
      lastLine: "same 0 other 4 read again 0 called 0",
      stderr: "",
      exitCode: 0,
    });
  },
  isASAN || isDebug ? 900_000 : 240_000,
);
