// `bun run --aot` checks a program and then runs it from its source. Only compiled code has the checks of `JSON.parse<T>(text)` and `validate<T>(value)`,
// so a program that validates by type is compiled and run for real there too: the expected output of each program is that of the executable.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const programs = join(import.meta.dir, "..", "programs", "data-from-outside");

// With AddressSanitizer the last has not ended in seven and a half minutes.
if (isASAN)
  console.error(
    "SKIPPED: bun run --aot validation-compiled-and-interpreted-agree.ts: it takes too long with AddressSanitizer",
  );

test.each([
  "validate-returns-a-copy",
  "validate-takes-what-is-not-json",
  "json-parse-type-argument-by-declared-types",
  "a-type-computed-by-conditional-aliases-that-name-one-another",
  "an-object-type-without-members-that-is-closed",
  ...(isASAN ? [] : ["validation-compiled-and-interpreted-agree"]),
])(
  "bun run --aot %s.ts",
  async name => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "run", "--aot", join(programs, name + ".ts")], programs);
    expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"),
      stderr: "",
      exitCode: 0,
    });
  },
  isASAN || isDebug ? 450_000 : 120_000,
);

test("without --aot the import of validate is an error", async () => {
  using dir = tempDir("validation-without-aot", {
    "program.ts": `import { validate } from "bun:bundle"; console.log(validate<number>(1));`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "run", "./program.ts"], String(dir));
  expect(stderr).toContain(`"bun:bundle" has no export named "validate"`);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});
