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

  test("importing an extensionless file treats it as tsx", async () => {
    using dir = tempDir("run-extensionless-import", {
      "dep": `export const kind: string = "dep"; export default (<T,>(x: T) => x)("default");`,
      "static.ts": `import def, { kind } from "./dep"; console.log("static", def, kind);`,
      "dynamic.ts": `const m = await import("./dep"); console.log("dynamic", m.default, m.kind);`,
      "require.cjs": `const m = require("./dep"); console.log("require", m.default, m.kind);`,
    });
    for (const [file, expected] of [
      ["static.ts", "static default dep\n"],
      ["dynamic.ts", "dynamic default dep\n"],
      ["require.cjs", "require default dep\n"],
    ] as const) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), file],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
    }
  });

  // The empty extension maps files that have none, which overrides the tsx
  // default: `--loader :<name>` on the CLI, `"" = "<name>"` under `[loader]`
  // in bunfig.toml.
  for (const [via, files, args] of [
    ["--loader :", {}, ["--loader", ":text"]],
    ["bunfig [loader]", { "bunfig.toml": `[loader]\n"" = "text"\n` }, []],
  ] as const) {
    test(`${via} overrides the loader for extensionless files`, async () => {
      using dir = tempDir("run-extensionless-override", {
        ...files,
        "LICENSE": `not (valid) typescript: at all`,
        "entry.ts": `import text from "./LICENSE"; console.log(JSON.stringify(text));`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args, "entry.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(`"not (valid) typescript: at all"\n`);
      expect(exitCode).toBe(0);
    });
  }

  // The override also reaches an extensionless entry point. `<T>(x: T) => x` is
  // a generic arrow to the ts loader and an unclosed tag to the tsx loader, so
  // it parses only when the mapping took effect.
  for (const [via, files, args] of [
    ["--loader :", {}, ["--loader=:ts"]],
    ["bunfig [loader]", { "bunfig.toml": `[loader]\n"" = "ts"\n` }, []],
  ] as const) {
    test(`${via} overrides the loader for an extensionless entry point`, async () => {
      using dir = tempDir("run-extensionless-entry-override", {
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
      expect(stderr).toBe("");
      expect(stdout).toBe("hello world\n");
      expect(exitCode).toBe(0);
    });
  }
});
