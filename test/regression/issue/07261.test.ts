import { bunEnv, bunExe } from "harness";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

it("imports tsconfig.json with abritary keys", async () => {
  const testDir = mkdtempSync(join(tmpdir(), "issue7261-"));

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test tsconfig.json
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "tsconfig.json"), '{ "key-with-hyphen": true }');

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", `require('${join(testDir, "tsconfig.json").replace(/\\/g, "\\\\")}').compilerOptions`],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
});
