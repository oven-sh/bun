import { describe, expect, test } from "bun:test";
import { bunExe, bunRunAsScript, tempDir } from "harness";

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = "start:dev";

    using dir = tempDir("processenv", {
      "package.json": JSON.stringify({ "scripts": { [`${scriptName}`]: `'${bunExe()}' run index.ts` } }),
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });
    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });

  // https://github.com/oven-sh/bun/issues/3589
  test("npm_lifecycle_event should have the value of the last call", () => {
    using dir = tempDir("processenv_ls_call", {
      "package.json": JSON.stringify({ scripts: { first: `'${bunExe()}' run --cwd lsc second` } }),
      "lsc": {
        "package.json": JSON.stringify({ scripts: { second: `'${bunExe()}' run index.ts` } }),
        "index.ts": "console.log(process.env.npm_lifecycle_event);",
      },
    });
    const { stdout } = bunRunAsScript(dir, "first");
    expect(stdout).toBe("second");
  });
});
