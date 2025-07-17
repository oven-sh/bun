import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import { bunEnv, bunExe } from "harness";
import os from "os";
import path from "path";

describe("parseArgs default args", () => {
  let temp_dir;

  beforeAll(async () => {
    temp_dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "bun-run.test." + Math.trunc(Math.random() * 9999999).toString(32))),
    );
    await fs.writeFile(
      path.join(temp_dir, "package.json"),
      `{
                "scripts": {
                    "script-test": "file-test.js"
                }
            }`,
    );
    await fs.writeFile(
      path.join(temp_dir, "file-test.js"),
      `console.log(JSON.stringify({ argv: process.argv, execArgv: process.execArgv, ...require("node:util").parseArgs({ strict: false }) }));`,
    );
  });
  afterAll(async () => {
    await fs.rm(temp_dir, { force: true, recursive: true });
  });

  async function spawnBun(...args) {
    const subprocess = spawn({
      cmd: [bunExe(), ...args],
      cwd: temp_dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: {
        ...bunEnv,
      },
    });
    subprocess.stdin.end();
    let exited = false;
    let timer = setTimeout(() => {
      if (!exited) {
        subprocess.kill();
      }
    }, 5000);
    const exitCode = await subprocess.exited;
    exited = true;
    clearTimeout(timer);
    const stdout = await subprocess.stdout.text();
    expect(exitCode).toBe(0);
    return { stdout };
  }

  test.each([
    ["file-test.js --foo asdf", ["foo"], ["asdf"], []], // implicit run
    ["run file-test.js --foo asdf", ["foo"], ["asdf"], []], // explicit run
    ["--bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // implicit run, with bun "--bun" arg (should not appear in argv)
    ["run --bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // explicit run, with bun "--bun" arg (after the run)
    ["--bun run file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // explicit run, with bun "--bun" arg (before the run)
    ["--bun run --env-file='' file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun", "--env-file=''"]], // explicit run, multiple bun args
    ["run file-test.js --bun", ["bun"], [], []], // passing --bun only to the program
    ["--bun run file-test.js --foo asdf -- --foo2 -- --foo3", ["foo"], ["asdf", "--foo2", "--", "--foo3"], ["--bun"]],
    //[`--bun -e ${evalSrc} --foo asdf`, ["foo"], ["asdf"]], // eval seems to crash when triggered from tests
    //[`--bun --eval ${evalSrc} --foo asdf`, ["foo"], ["asdf"]],
    //[`--eval "require('./file-test.js')" -- --foo asdf -- --bar`, ["foo"], ["asdf"]],
  ])('running "bun %s"', async (argline, valuesKeys, positionals, execArgv) => {
    const result = await spawnBun(...argline.split(/\s+/));
    let output;
    expect(() => (output = JSON.parse(result.stdout))).not.toThrow();
    expect(Object.keys(output?.values ?? {}).sort()).toEqual(valuesKeys.sort());
    expect(output?.positionals).toEqual(positionals);
    if (execArgv) {
      expect(output?.execArgv).toEqual(execArgv);
    }
  });
});
