// The characters of a text that is matched several times are loaded once, and once more behind an await. The compiler's own check of machine code says where they are not.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = await Bun.file(
  join(import.meta.dir, "parallel/suspended-frames/texts-matched-across-awaits.ts"),
).text();

test("characters that are read behind an await are loaded behind it", async () => {
  using dir = tempDir("aot-texts-matched-across-awaits", { "main.ts": program });
  const cwd = String(dir);
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, isWindows ? "app.exe" : "app")],
    cwd,
    { ...bunEnv, BUN_JSC_verifyAOTMachineCode: "1" },
  );
  expect(stderr).not.toContain("InnerPointerWithoutOwner");
  expect(stderr).not.toMatch(/^error\b/m);
  expect(exitCode).toBe(0);
});
