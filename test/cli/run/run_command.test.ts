import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isPosix, isWindows, tempDir } from "harness";
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

// A package whose `bin` is an executable script with no shebang (e.g. a plain
// shell script) makes execve() return ENOEXEC. npx runs the bin through /bin/sh
// in that case; `bun run` must do the same so `bun run <bin>` works wherever
// `npx <bin>` does. https://github.com/oven-sh/bun/issues/5386
//
// The `--silent` variant is what bunx uses (bunx_command.rs sets
// ctx.debug.silent = true), which on macOS routes through POSIX_SPAWN_SETEXEC
// instead of the ordinary fork+exec path.
describe.if(isPosix)("bun run <bin> executes a no-shebang bin through /bin/sh", () => {
  for (const silent of [false, true]) {
    test(silent ? "with --silent (bunx path)" : "default", () => {
      using dir = tempDir("run-no-shebang-bin", {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { "no-shebang-bin": "1.0.0" },
        }),
        "node_modules/no-shebang-bin/package.json": JSON.stringify({
          name: "no-shebang-bin",
          version: "1.0.0",
          bin: { "no-shebang-bin": "./bin.sh" },
        }),
        "node_modules/no-shebang-bin/bin.sh": 'echo "hello from bin $1"\n',
      });
      const cwd = String(dir);
      chmodSync(join(cwd, "node_modules/no-shebang-bin/bin.sh"), 0o755);
      mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
      symlinkSync("../no-shebang-bin/bin.sh", join(cwd, "node_modules/.bin/no-shebang-bin"));

      const { exitCode, stdout, stderr } = spawnSync({
        cwd,
        cmd: [bunExe(), ...(silent ? ["--silent"] : []), "run", "no-shebang-bin", "world"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe("hello from bin world\n");
      expect(exitCode).toBe(0);
    });
  }
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
