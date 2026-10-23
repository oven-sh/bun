import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
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

  // `<T>(x: T) => x` is a generic arrow function to the ts loader and an unclosed tag to the tsx loader.
  test.each([
    ["--loader=:ts", {}, ["--loader=:ts"]],
    [`"" = "ts" under [loader] in bunfig.toml`, { "bunfig.toml": `[loader]\n"" = "ts"\n` }, []],
  ])("%s sets the loader of a file with no extension", async (_, files, args) => {
    using dir = tempDir("run-extensionless-loader", {
      ...files,
      "cool": `const id = <T>(x: T) => x; console.log(id("hello world"));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, "./cool"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });
});
