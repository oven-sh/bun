import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import path from "node:path";

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

  test("an empty-string script value is not a runnable script", () => {
    using dir = tempDir("empty-script", {
      "package.json": JSON.stringify({ scripts: { build: "" } }),
    });
    // Zig `asPropertyStringMap` drops empty-valued script entries; an empty
    // `build` must report "Script not found" and exit 1, not run an empty
    // `$ ` command and exit 0. (npm runs empty scripts and exits 0 — Bun
    // intentionally diverges here to match its own prior/Zig behavior.)
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: String(dir),
      cmd: [bunExe(), "run", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/13984
describe.concurrent("process.argv passthrough", () => {
  const argvJs = `process.stdout.write(JSON.stringify(process.argv.slice(2)));`;

  async function runFile(args: string[], entry = "argv.js") {
    using dir = tempDir("argv-passthrough", { "argv.js": argvJs });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args.map(a => (a === "<file>" ? entry : a))],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.each([
    // [argv after bunExe, expected process.argv.slice(2)]
    [
      ["<file>", "--", "rest"],
      ["--", "rest"],
    ],
    [["<file>", "--"], ["--"]],
    [
      ["<file>", "--", "--", "rest"],
      ["--", "--", "rest"],
    ],
    [
      ["<file>", "foo", "--", "rest"],
      ["foo", "--", "rest"],
    ],
    [
      ["<file>", "--", "--watch"],
      ["--", "--watch"],
    ],
    [
      ["run", "<file>", "--", "rest"],
      ["--", "rest"],
    ],
    [["run", "<file>", "--"], ["--"]],
    [
      ["run", "<file>", "foo", "--", "rest"],
      ["foo", "--", "rest"],
    ],
    [
      ["--", "<file>", "--", "rest"],
      ["--", "rest"],
    ],
  ] as const)("bun %j -> %j", async (args, expected) => {
    expect(await runFile([...args])).toEqual([...expected]);
  });

  test.each([
    [
      ["--", "a", "b"],
      ["a", "b"],
    ],
    [
      ["a", "b"],
      ["a", "b"],
    ],
    [
      ["--", "--", "a"],
      ["--", "a"],
    ],
  ] as const)("package.json script: bun run go %j -> %j (npm compat)", async (extra, expected) => {
    using dir = tempDir("argv-script", {
      "argv.js": argvJs,
      "package.json": JSON.stringify({
        scripts: { go: `${JSON.stringify(bunExe())} argv.js` },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--silent", "run", "go", ...extra],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual([...expected]);
  });

  test("node_modules/.bin binary still strips one leading --", async () => {
    const binName = isWindows ? "mybin.cmd" : "mybin";
    const binBody = isWindows
      ? `@"${bunExe()}" "%~dp0\\..\\mybin\\argv.js" %*\r\n`
      : `#!/bin/sh\nexec "${bunExe()}" "$(dirname "$0")/../mybin/argv.js" "$@"\n`;
    using dir = tempDir("argv-bin", {
      "package.json": JSON.stringify({ name: "consumer" }),
      [path.join("node_modules", ".bin", binName)]: binBody,
      [path.join("node_modules", "mybin", "argv.js")]: argvJs,
    });
    if (!isWindows) {
      chmodSync(path.join(String(dir), "node_modules", ".bin", binName), 0o755);
    }
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--silent", "run", "mybin", "--", "a", "b"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["a", "b"]);
  });
});

test.if(isWindows)("[windows] A file in drive root runs", async () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = await bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});
