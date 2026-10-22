import { expect } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

// Untyped code stores what it likes into an object of a declared type. Nothing is thrown for it: `bun run --aot`, and the compiled code under `--debug-aot`, print what plain Bun prints.
const programs = join(import.meta.dir, "programs");

async function ran(file: string, ...flags: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, file], cwd: dirname(file), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

test.concurrent.each([
  "type-rules/nullish-in-fields",
  "type-rules/objects-reaching-untyped-code-indirectly",
  "type-rules/required-fields-cannot-be-cleared",
  "typed-objects/ts-unsoundness-into-primitive-types",
  "type-rules/discriminated-literals-keep-structure",
])("%s", async name => {
  const file = existsSync(join(programs, name + ".ts")) ? join(programs, name + ".ts") : join(programs, name, "main.ts");
  const plain = await ran(file);
  expect({ exitCode: plain.exitCode, isSilent: plain.stdout === "" }).toEqual({ exitCode: 0, isSilent: false });
  for (const flag of ["--aot", "--debug-aot"]) expect({ flag, ...(await ran(file, flag)) }).toEqual({ flag, ...plain });
}, 120_000);
