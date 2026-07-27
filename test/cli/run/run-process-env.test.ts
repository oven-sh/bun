import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

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

  // https://github.com/oven-sh/bun/issues/21088
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
      env: { ...bunEnv, INIT_CWD: "/should/be/overwritten" },
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

  test("INIT_CWD is reset by a nested bun run", async () => {
    const dir = tempDirWithFiles("init-cwd-nested", {
      "package.json": JSON.stringify({
        scripts: { outer: `'${bunExe()}' run --silent --cwd packages/foo inner` },
      }),
      "packages/foo/package.json": JSON.stringify({
        scripts: { inner: `'${bunExe()}' ../../print-env.js` },
      }),
      "print-env.js": `process.stdout.write(JSON.stringify({ INIT_CWD: process.env.INIT_CWD }));`,
    });
    const root = fs.realpathSync(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--silent", "outer"],
      env: { ...bunEnv, INIT_CWD: "/should/be/overwritten" },
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ INIT_CWD: path.join(root, "packages", "foo") });
    expect(exitCode).toBe(0);
  });
});
