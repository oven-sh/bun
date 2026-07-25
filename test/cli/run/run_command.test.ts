import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isPosix, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { open } from "node:fs/promises";
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

// https://github.com/oven-sh/bun/issues/7102
describe.skipIf(!isPosix)("entry point is a pipe/FIFO", () => {
  test.concurrent("runs a named FIFO entry point", async () => {
    using dir = tempDir("run-fifo", {});
    const fifo = join(String(dir), "script");
    mkfifo(fifo);

    await using proc = Bun.spawn({
      cmd: [bunExe(), fifo, "extra"],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const feed = (async () => {
      const w = await open(fifo, "w");
      await w.writeFile(`console.log(JSON.stringify({ argv: process.argv.slice(1), main: import.meta.main }));\n`);
      await w.close();
    })();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited, feed]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ argv: [fifo, "extra"], main: true });
    expect(exitCode).toBe(0);
  });

  const bash = Bun.which("bash");
  test.concurrent.skipIf(!bash)("runs a process-substitution entry point (bash <())", async () => {
    const script = `console.log(JSON.stringify({ argv1: process.argv[1], main: import.meta.main, sum: 1 + 2 }))`;
    await using proc = Bun.spawn({
      cmd: [bash!, "-c", `exec "$BUN" <(printf %s "$SCRIPT")`],
      env: { ...bunEnv, BUN: bunExe(), SCRIPT: script },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.argv1).toMatch(/^\/dev\/fd\/\d+$/);
    expect(parsed).toEqual({ argv1: parsed.argv1, main: true, sum: 3 });
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!bash)("error output references a path, not 'pipe:[inode]'", async () => {
    await using proc = Bun.spawn({
      cmd: [bash!, "-c", `exec "$BUN" <(printf %s 'throw new Error("boom")')`],
      env: { ...bunEnv, BUN: bunExe() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("boom");
    expect(stderr).toContain("[stdin]:1");
    expect(stderr).not.toMatch(/pipe:\[\d+\]/);
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
