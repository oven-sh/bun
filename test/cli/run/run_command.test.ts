import { $, spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isPosix, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

let cwd: string;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

test.if(isWindows)("[windows] A file in drive root runs", () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});

// Regression test for #4011
describe.concurrent("issue/04011", () => {
  test("running a missing script should return non zero exit code", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "missing.ts"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    expect(await proc.exited).toBe(1);
  });
});

// Regression test for #10132
let issue10132Dir = "";
beforeAll(() => {
  issue10132Dir = tempDirWithFiles("issue-10132", {
    "subdir/one/two/three/hello.txt": "hello",
    "node_modules/.bin/bun-hello": `#!/usr/bin/env bash
echo "My name is bun-hello"
    `,
    "node_modules/.bin/bun-hello.cmd": `@echo off
echo My name is bun-hello
    `,
    "subdir/one/two/package.json": JSON.stringify(
      {
        name: "issue-10132",
        version: "0.0.0",
        scripts: {
          "other-script": "echo hi",
        },
      },
      null,
      2,
    ),
    "subdir/one/two/node_modules/.bin/bun-hello2": `#!/usr/bin/env bash
echo "My name is bun-hello2"
    `,
    "subdir/one/two/node_modules/.bin/bun-hello2.cmd": `@echo off
echo My name is bun-hello2
    `,
    "package.json": JSON.stringify(
      {
        name: "issue-10132",
        version: "0.0.0",
        scripts: {
          "get-pwd": "pwd",
        },
      },
      null,
      2,
    ),
  });

  if (isPosix) {
    chmodSync(join(issue10132Dir, "node_modules/.bin/bun-hello"), 0o755);
    chmodSync(join(issue10132Dir, "subdir/one/two/node_modules/.bin/bun-hello2"), 0o755);
  }
});

test("bun run sets cwd for script, matching npm", async () => {
  $.cwd(issue10132Dir);
  const currentPwd = (await $`${bunExe()} run get-pwd`.text()).trim();
  expect(currentPwd).toBe(issue10132Dir);

  const currentPwd2 = join(currentPwd, "subdir", "one");
  $.cwd(currentPwd2);
  expect((await $`${bunExe()} run get-pwd`.text()).trim()).toBe(issue10132Dir);

  $.cwd(process.cwd());
});

test("issue #10132, bun run sets PATH", async () => {
  async function run(dir: string) {
    $.cwd(dir);
    const [first, second] = await Promise.all([$`${bunExe()} bun-hello`.quiet(), $`${bunExe()} run bun-hello`.quiet()]);

    expect(first.text().trim()).toBe("My name is bun-hello");
    expect(second.text().trim()).toBe("My name is bun-hello");
  }

  await Promise.all(
    [
      issue10132Dir,
      join(issue10132Dir, "subdir"),
      join(issue10132Dir, "subdir", "one"),
      join(issue10132Dir, "subdir", "one", "two"),
      join(issue10132Dir, "subdir", "one", "two", "three"),
    ].map(run),
  );
});
