import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { test } from "./supported";

// `bun run --aot`, and the compiled code under `--debug-aot`, print what plain Bun prints.
const programs = join(import.meta.dir, "programs");

async function ran(...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", ...args],
    cwd: programs,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
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
