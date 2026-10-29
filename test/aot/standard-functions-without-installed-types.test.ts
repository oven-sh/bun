// programs/type-rules/standard-functions-keep-their-declared-types.ts, built where no types of Bun are installed: the only
// declarations of Bun's are those that the compiler brings along.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("JSON.parse and json() keep their declared types", async () => {
  using dir = tempDir("standard-functions-without-installed-types", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, lib: ["esnext", "dom"], typeRoots: ["./no-types-here"] },
    }),
    "program.ts": readFileSync(
      join(import.meta.dir, "programs", "type-rules", "standard-functions-keep-their-declared-types.ts"),
      "utf8",
    ),
  });
  const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode: built } = await run(
    [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
    String(dir),
  );
  expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
  const { stdout, exitCode } = await run([outfile], String(dir));
  expect({ stdout, exitCode }).toEqual({
    stdout: '1 2 2 3 ["4","undefined"] {"ok":true} function function\n',
    exitCode: 0,
  });
}, 120_000);
