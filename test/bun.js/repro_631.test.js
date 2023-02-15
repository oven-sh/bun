import { expect, it } from "bun:test";
import { bunExe } from "./bunExe.ts";
import { bunEnv } from "./bunEnv.ts";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";

it("JSON strings escaped properly", async () => {
  const testDir = import.meta.dir + "/repro_631/";

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true });

  // Create a directory with our test package file
  mkdirSync(testDir);
  writeFileSync(testDir + "package.json", String.raw`{"testRegex":"\\a\n\\b\\"}`);

  // Attempt to add a package, causing the package file to be parsed, modified,
  //  written, and reparsed.  This verifies that escaped backslashes in JSON
  //  survive the roundtrip
  const {exitCode, stderr} = Bun.spawnSync({
    cmd: [bunExe(), "add", "left-pad"],
    env: bunEnv,
    cwd: testDir
  });
  console.log(stderr.toString());
  expect(exitCode).toBe(0);

  const packageContents = readFileSync(testDir + "package.json", { encoding: "utf8" });
  expect(packageContents).toBe(String.raw
`{
  "testRegex": "\\a\n\\b\\",
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`);

  //// If successful clean up test artifacts
  rmSync(testDir, { recursive: true });
})
