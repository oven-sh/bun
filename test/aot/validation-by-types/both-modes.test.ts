// `bun run --aot` runs a program with ordinary Bun under the rules of --aot. `JSON.parse<T>(text)` and `Bun.validate<T>(value)` give
// there what they give in the executable: the expected output of each program is that of the executable.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const programs = join(import.meta.dir, "..", "programs", "data-from-outside");

test.each(["bun-validate-returns-a-copy", "json-parse-type-argument-by-declared-types", "validation-compiled-and-interpreted-agree"])(
  "bun run --aot %s.ts",
  async name => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", join(programs, name + ".ts")], cwd: programs, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({ stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"), stderr: "", exitCode: 0 });
  },
  isASAN || isDebug ? 450_000 : 120_000,
);

test("without --aot Bun.validate<T>() says what it needs", async () => {
  using dir = tempDir("validation-without-aot", { "program.ts": `try { Bun.validate<number>(1); } catch (error: any) { console.log(error.constructor.name, error.message); }` });
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "./program.ts"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toStartWith("TypeError Bun.validate<T>() checks a value against a TypeScript type");
  expect(stdout).toContain("bun run --aot");
  expect(exitCode).toBe(0);
});
