import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe.concurrent("issue/00631", () => {
  it("JSON strings escaped properly", async () => {
    using testDir = tempDir("issue-00631", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
      "package.json": String.raw`{"testRegex":"\\a\n\\b\\"}`,
    });

    // Attempt to add a package, causing the package file to be parsed, modified,
    //  written, and reparsed.  This verifies that escaped backslashes in JSON
    //  survive the roundtrip
    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "no-deps"],
      env: bunEnv,
      cwd: String(testDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

    const packageContents = readFileSync(join(String(testDir), "package.json"), { encoding: "utf8" });
    expect(packageContents).toBe(String.raw`{
  "testRegex": "\\a\n\\b\\",
  "dependencies": {
    "no-deps": "^2.0.0"
  }
}`);
  });
});
