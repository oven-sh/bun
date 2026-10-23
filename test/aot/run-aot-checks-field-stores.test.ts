import { expect } from "bun:test";
import { existsSync } from "fs";
import { bunExe } from "harness";
import { dirname, join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// Untyped code stores what it likes into an object of a declared type. Nothing is thrown for it: `bun run --aot`, and the compiled code under `--debug-aot`, print what plain Bun prints.
const programs = join(import.meta.dir, "programs");

async function ran(file: string, ...flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "run", ...flags, file], dirname(file));
  return { stdout, exitCode };
}

test.concurrent.each([
  "type-rules/nullish-in-fields",
  "type-rules/objects-reaching-untyped-code-indirectly",
  "type-rules/required-fields-cannot-be-cleared",
  "typed-objects/ts-unsoundness-into-primitive-types",
  "type-rules/discriminated-literals-keep-structure",
])(
  "%s",
  async name => {
    const file = existsSync(join(programs, name + ".ts"))
      ? join(programs, name + ".ts")
      : join(programs, name, "main.ts");
    const plain = await ran(file);
    expect({ exitCode: plain.exitCode, isSilent: plain.stdout === "" }).toEqual({ exitCode: 0, isSilent: false });
    for (const flag of ["--aot", "--debug-aot"])
      expect({ flag, ...(await ran(file, flag)) }).toEqual({ flag, ...plain });
  },
  120_000,
);
