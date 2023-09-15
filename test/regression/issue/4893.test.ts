import { bunEnv, bunExe } from "harness";
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

it("correctly handles CRLF multiline string in CRLF terminated files", async () => {
  const testDir = mkdtempSync(join(tmpdir(), "issue4893-"));

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
