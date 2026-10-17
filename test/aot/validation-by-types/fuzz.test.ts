// Generated types and generated values: see generate.ts. Each test builds one generated program with `bun build --compile --aot`
// and runs it. Where zod 4 can be resolved from here, the program asks zod as well.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "../supported";
import { program } from "./generate";

function folderOfZod(): string | undefined {
  try {
    const manifest = require.resolve("zod/package.json");
    return Number(require(manifest).version.split(".")[0]) >= 4 ? dirname(manifest) : undefined;
  } catch {
    return undefined;
  }
}
const zod = folderOfZod();

test.concurrent.each([1, 2, 3, 4, 5, 6])(
  "60 generated types, seed %d",
  async seed => {
    using dir = tempDir("validation-by-types", { "program.ts": program(seed, 60, zod !== undefined) });
    if (zod !== undefined) {
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(zod, join(String(dir), "node_modules", "zod"));
    }
    const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [said, built] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
    await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
    const lines = stdout.trim().split("\n");
    expect(lines.filter(line => !/^(T\d+|Tree|Json|all) /.test(line))).toEqual([]);
    expect(lines.at(-1)).toContain(" disagreements 0 ");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  },
  600_000,
);
