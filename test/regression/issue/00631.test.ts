import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, tmpdirSync } from "../../harness.js";

describe.concurrent("issue/00631", () => {
  it("JSON strings escaped properly", async () => {
    const testDir = tmpdirSync();

    // Clean up from prior runs if necessary
    rmSync(testDir, { recursive: true, force: true });

    // Create a directory with our test package file
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package.json"), String.raw`{"testRegex":"\\a\n\\b\\"}`);

    // Attempt to add a package, causing the package file to be parsed, modified,
    //  written, and reparsed.  This verifies that escaped backslashes in JSON
    //  survive the roundtrip
    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "left-pad"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      console.log(stderr);
    }
    expect(exitCode).toBe(0);

    const packageContents = readFileSync(join(testDir, "package.json"), { encoding: "utf8" });
    expect(packageContents).toBe(String.raw`{
  "testRegex": "\\a\n\\b\\",
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`);

    //// If successful clean up test artifacts
    rmSync(testDir, { recursive: true });
  });
});
