import { describe, expect, test } from "bun:test";
import { bunRunAsScript, tempDirWithFiles } from "harness";

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = "start:dev";

    const dir = tempDirWithFiles("processenv", {
      "package.json": `{'scripts': {'${scriptName}': 'bun run index.ts'}}`,
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });

    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });
});
