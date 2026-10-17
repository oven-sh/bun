// programs/type-rules/standard-functions-keep-their-declared-types.ts, built where no types of Bun are installed: the only
// declarations of Bun's are those that the compiler brings along.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";

test("JSON.parse and json() keep their declared types", async () => {
  using dir = tempDir("standard-functions-without-installed-types", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, lib: ["esnext", "dom"], typeRoots: ["./no-types-here"] },
    }),
    "program.ts": readFileSync(
      join(import.meta.dir, "..", "programs", "type-rules", "standard-functions-keep-their-declared-types.ts"),
      "utf8",
    ),
  });
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
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: '1 2 2 3 ["4","undefined"] {"ok":true} function function\n',
    exitCode: 0,
  });
}, 120_000);
