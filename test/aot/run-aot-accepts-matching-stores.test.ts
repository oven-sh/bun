import { expect } from "bun:test";
import { bunExe } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun run --aot`, and the compiled code under `--debug-aot`, print what plain Bun prints.
const programs = join(import.meta.dir, "programs");

async function ran(...args: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "run", ...args], programs);
  return { stdout, exitCode };
}

test.concurrent.each(["type-rules/bit-flag-enums"])(
  "%s",
  async name => {
    const plain = await ran(join(programs, name + ".ts"));
    expect({ exitCode: plain.exitCode, isSilent: plain.stdout === "" }).toEqual({ exitCode: 0, isSilent: false });
    for (const flag of ["--aot", "--debug-aot"])
      expect({ flag, ...(await ran(flag, join(programs, name + ".ts"))) }).toEqual({ flag, ...plain });
  },
  120_000,
);
