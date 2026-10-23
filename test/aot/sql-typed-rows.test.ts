import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("sql<Row[]> output matches bun run", async () => {
  using dir = tempDir("aot-sql-typed-rows", {});
  const folder = join(import.meta.dir, "programs", "data-from-outside");
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./sql-typed-rows.ts", "--outfile", executable],
    folder,
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^(error|warn)\b/m),
    exitCode: 0,
  });
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const expected = await run([bunExe(), "run", "./sql-typed-rows.ts"], folder, bunEnv);
  expect(ran.stdout).toBe(expected.stdout);
}, 240_000);
