import { expect, it } from "bun:test";
import { bunExe } from "./bunExe.ts";
import { bunEnv } from "./bunEnv.ts";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";

it("JSON strings escaped properly", async () => {
  // Clean up from prior runs if necessary
  rmSync("./repro_631/", { recursive: true });

  // Create a directory with our test package file
  mkdirSync("./repro_631");
  writeFileSync("./repro_631/package.json", String.raw`{"testRegex":"\\a\n\\b\\"}`);

  // Attempt to add a package, causing the package file to be parsed, modified,
  //  written, and reparsed.  This verifies that escaped backslashes in JSON
  //  survive the roundtrip
  const {exitCode, stderr} = Bun.spawnSync({
    cmd: [bunExe(), "add", "left-pad"],
    env: bunEnv,
    cwd: import.meta.dir + "/repro_631/"
  });
  console.log(stderr.toString());
  expect(exitCode).toBe(0);

  const packageContents = readFileSync("./repro_631/package.json", { encoding: "utf8" });
  expect(packageContents).toBe(String.raw
`{
  "testRegex": "\\a\n\\b\\",
  "dependencies": {
    "left-pad": "^1.3.0"
  }
}`);

  //// If successful clean up test artifacts
  rmSync("./repro_631/", { recursive: true });
})
