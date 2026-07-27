import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, tempDirWithFiles } from "harness";
import path from "node:path";
import fs from "node:fs";

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = "start:dev";

    const dir = tempDirWithFiles("processenv", {
      "package.json": JSON.stringify({ "scripts": { [`${scriptName}`]: `'${bunExe()}' run index.ts` } }),
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });
    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });

  // https://github.com/oven-sh/bun/issues/3589
  test("npm_lifecycle_event should have the value of the last call", () => {
    const dir = tempDirWithFiles("processenv_ls_call", {
      "package.json": JSON.stringify({ scripts: { first: `'${bunExe()}' run --cwd lsc second` } }),
      "lsc": {
        "package.json": JSON.stringify({ scripts: { second: `'${bunExe()}' run index.ts` } }),
        "index.ts": "console.log(process.env.npm_lifecycle_event);",
      },
    });
    const { stdout } = bunRunAsScript(dir, "first");
    expect(stdout).toBe("second");
  });

  test("INIT_CWD is set to the directory bun run was invoked from", async () => {
    const dir = tempDirWithFiles("init-cwd", {
      "package.json": JSON.stringify({
        name: "p",
        version: "1.0.0",
        scripts: { envcheck: `'${bunExe()}' print-env.js` },
      }),
      "print-env.js": `process.stdout.write(JSON.stringify({ INIT_CWD: process.env.INIT_CWD, cwd: process.cwd() }));`,
      "sub/deep/.keep": "",
    });
    const invokeFrom = fs.realpathSync(path.join(dir, "sub", "deep"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--silent", "envcheck"],
      env: { ...bunEnv, INIT_CWD: undefined },
      cwd: invokeFrom,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      INIT_CWD: invokeFrom,
      cwd: fs.realpathSync(dir),
    });
    expect(exitCode).toBe(0);
  });
});
