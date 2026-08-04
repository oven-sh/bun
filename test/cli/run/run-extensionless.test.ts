import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles, tmpdirSync } from "harness";
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

  // `--loader` takes an empty extension, which maps files that have none. `<T>(x: T) => x`
  // is a generic arrow to the ts loader and an unclosed tag to the tsx loader, so it parses
  // only when the mapping took effect.
  test("--loader with an empty extension sets the loader for extensionless files", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "cool"), "const id = <T>(x: T) => x; console.log(id('hello world'));");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--loader=:ts", join(dir, "./cool")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("[loader] with an empty extension sets the loader for extensionless files", async () => {
    const dir = tempDirWithFiles("bunfig-loader-extensionless", {
      cool: "const id = <T>(x: T) => x; console.log(id('hello world'));",
      "bunfig.toml": '[loader]\n"" = "ts"\n',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "./cool")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("--loader with an empty extension applies to imported extensionless files", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "dep"), "export const id = <T>(x: T) => x;");
    await Bun.write(join(dir, "main.ts"), "import { id } from './dep'; console.log(id('hello world'));");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--loader=:ts", join(dir, "./main.ts")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });
});
