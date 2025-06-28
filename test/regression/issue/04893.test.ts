import { expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

it("correctly handles CRLF multiline string in CRLF terminated files", async () => {
  const testDir = tmpdirSync();

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test CRLF terminated file
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "crlf.js"), '"a\\\r\nb"');

  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(testDir, "crlf.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
});
