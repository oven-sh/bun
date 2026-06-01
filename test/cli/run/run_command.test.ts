import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";

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

// https://github.com/oven-sh/bun/issues/13984
// Node.js preserves '--' in process.argv when running a script file.
// Bun was stripping it in the CLI arg parser's stop_after_positional_at codepath.
describe("should preserve '--' in process.argv", () => {
  test("bun -e <code> -- rest (separator consumed)", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "-e", "console.log(JSON.stringify(process.argv))", "--", "rest", "--foo=bar"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const argv = JSON.parse(stdout.toString());
    // With -e, '--' is consumed as a separator (same as Node.js)
    expect(argv.slice(1)).toEqual(["rest", "--foo=bar"]);
    expect(exitCode).toBe(0);
  });

  test("bun run script.js -- rest (preserved in argv)", () => {
    using dir = tempDir("test-double-dash", {
      "test.js": "console.log(JSON.stringify(process.argv))",
    });

    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "run", "test.js", "--", "rest", "--foo=bar"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const argv = JSON.parse(stdout.toString());
    // argv[0] is the bun executable, argv[1] is the script path
    // '--' must be preserved in argv[2], matching Node.js behavior
    expect(argv.slice(2)).toEqual(["--", "rest", "--foo=bar"]);
    expect(exitCode).toBe(0);
  });

  test("bun run script.js -- with multiple double dashes", () => {
    using dir = tempDir("test-double-dash-multi", {
      "test.js": "console.log(JSON.stringify(process.argv))",
    });

    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "run", "test.js", "--", "abc", "--", "def"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const argv = JSON.parse(stdout.toString());
    expect(argv.slice(2)).toEqual(["--", "abc", "--", "def"]);
    expect(exitCode).toBe(0);
  });

  test("bun run <pkg-script> -- args (separator consumed, npm compat)", () => {
    using dir = tempDir("test-double-dash-pkg", {
      "echo.js": "console.log(JSON.stringify(process.argv))",
      "package.json": JSON.stringify({
        scripts: {
          echo: `${bunExe()} echo.js`,
        },
      }),
    });

    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "run", "echo", "--", "rest", "value"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const lines = stdout.toString().trim().split("\n");
    const argv = JSON.parse(lines[lines.length - 1]);
    // For package scripts, '--' is consumed as an npm-style separator
    // (matching npm/yarn), so only the args after it are forwarded.
    // The inner script sees: [bun, echo.js, rest, value]
    expect(argv.slice(2)).toEqual(["rest", "value"]);
    expect(exitCode).toBe(0);
  });

  test("bun run <pkg-script> -- args strips separator for Bun shell $1", () => {
    using dir = tempDir("test-double-dash-pkg-shell", {
      "package.json": JSON.stringify({
        scripts: {
          show: 'echo "$1|$2" #',
        },
      }),
    });

    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "run", "show", "--", "rest", "value"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Bun shell reads $1/$2 from ctx.passthrough; the leading '--'
    // must be stripped so $1 = "rest", $2 = "value" (npm compat).
    expect(stdout.toString().trim().split("\n").at(-1)).toBe("rest|value");
    expect(exitCode).toBe(0);
  });
});
