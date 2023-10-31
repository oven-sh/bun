// test/regression/issue/03830.test.ts

import { it, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

it("macros should not lead to seg faults under any given input", async () => {
  // this test code follows the same structure as and
  // is based on the code for testing issue 4893

  const testDir = mkdtempSync(join(tmpdir(), "issue3830-"));

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test file
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "macro.ts"), "export function fn(str) { return str; }");
  writeFileSync(join(testDir, "index.ts"), "import { fn } from './macro' assert { type: 'macro' };\nfn(`©${''}`);");

  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "build", join(testDir, "index.ts")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
});
