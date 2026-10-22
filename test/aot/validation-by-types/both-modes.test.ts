// `bun run --aot` checks a program and then runs it from its source. Only compiled code has the checks of `JSON.parse<T>(text)` and `validate<T>(value)`,
// so a program that validates by type is compiled and run for real there too: the expected output of each program is that of the executable.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const programs = join(import.meta.dir, "..", "programs", "data-from-outside");

test.each(["validate-returns-a-copy", "validate-takes-what-is-not-json", "json-parse-type-argument-by-declared-types", "validation-compiled-and-interpreted-agree"])(
  "bun run --aot %s.ts",
  async name => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", join(programs, name + ".ts")], cwd: programs, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({ stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"), stderr: "", exitCode: 0 });
  },
  isASAN || isDebug ? 450_000 : 120_000,
);

test("without --aot the import of validate is an error", async () => {
  using dir = tempDir("validation-without-aot", { "program.ts": `import { validate } from "bun:bundle"; console.log(validate<number>(1));` });
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "./program.ts"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`"bun:bundle" has no export named "validate"`);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});
