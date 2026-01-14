import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-extensionless", () => {
  test("running extensionless file works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "cool"), "const x: Test = 2; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "./cool")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test.skipIf(isWindows)("running shebang typescript file works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cool"), `#!${bunExe()}\nconst x: Test = 2; console.log('hello world');`, { mode: 0o777 });

    await using proc = Bun.spawn({
      cmd: [join(dir, "./cool")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });
});
