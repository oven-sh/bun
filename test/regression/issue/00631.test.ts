import { expect, it } from "bun:test";
import { bunExe, bunEnv } from "../../harness.js";
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

it("JSON strings escaped properly", async () => {
  const testDir = mkdtempSync(join(tmpdir(), "issue631-"));

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test package file
  mkdirSync(testDir, { recursive: true });
  writeFileSync(testDir + "package.json", String.raw`{"testRegex":"\\a\n\\b\\"}`);

  // Attempt to add a package, causing the package file to be parsed, modified,
  //  written, and reparsed.  This verifies that escaped backslashes in JSON
  //  survive the roundtrip
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "add", "left-pad"],
    env: bunEnv,
    cwd: testDir,
  });
  expect(exitCode).toBe(0);

  console.log(testDir);
  const packageContents = readFileSync(testDir + "package.json", { encoding: "utf8" });
  expect(packageContents).toBe(String.raw`{
  "testRegex": "\\a\n\\b\\",
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`);

  //// If successful clean up test artifacts
  rmSync(testDir, { recursive: true });
});
