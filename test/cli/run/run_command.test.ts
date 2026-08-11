import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { dirname, join } from "path";

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

// On Windows, `bun <absolute path>` normalized the path into a fixed 1024-byte
// scratch buffer before checking its length, so any longer path aborted the
// process ("range end index N out of range for slice of length 1024") instead
// of being opened. Windows itself allows paths up to 32767 characters.
describe.concurrent.skipIf(!isWindows)("[windows] absolute script path longer than 1024 bytes", () => {
  async function run(args: string[], cwd?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("an existing script runs", async () => {
    // 6 directories of 200 characters each, so the path is long regardless of
    // where the temporary directory lives (a single component may not exceed
    // 255 characters).
    const deep = Array.from({ length: 6 }, () => Buffer.alloc(200, "d").toString()).join("/");
    using dir = tempDir("run-long-abs-path", {
      [`${deep}/script.js`]: `console.log("ran");`,
    });
    const script = join(String(dir), deep, "script.js");
    expect(script).toMatch(/^[A-Za-z]:\\/);
    expect(script.length).toBeGreaterThan(1024);

    const variants = {
      backslashes: await run([script]),
      "forward slashes": await run([script.replaceAll("\\", "/")]),
      // Resolved against the drive of the cwd first.
      "no drive letter": await run([script.slice(2)], dirname(String(dir))),
      "bun run": await run(["run", script]),
    };
    const ran = { stdout: "ran\n", stderr: "", exitCode: 0 };
    expect(variants).toEqual({
      backslashes: ran,
      "forward slashes": ran,
      "no drive letter": ran,
      "bun run": ran,
    });
  });

  test("a missing script is reported as not found", async () => {
    const missing = "C:\\" + Buffer.alloc(1100, "a").toString() + ".js";
    for (const args of [[missing], ["run", missing]]) {
      const { stdout, stderr, exitCode } = await run(args);
      expect(stdout).toBe("");
      expect(stderr).toContain(`Module not found "${missing}"`);
      expect(exitCode).toBe(1);
    }
  });
});
