import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isMacOS, isWindows, tempDir } from "harness";
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

// Windows never produces either failure: a directory in use as a cwd cannot be
// deleted, and a cwd cannot outgrow the 32K-character buffer bun gives it.
describe.skipIf(isWindows)("startup when getcwd fails", () => {
  // PATH_MAX counts the trailing NUL: 4096 on Linux, 1024 on macOS.
  const PATH_MAX = isMacOS ? 1024 : 4096;
  const component = Buffer.alloc(200, "c").toString();

  // chdir(2) only limits the length of each path argument, so a process can
  // end up in a directory whose absolute path is longer than PATH_MAX; that
  // directory exists and works, but getcwd(2) fails for it. Nothing can name
  // it with an absolute path, so the test process parks itself in a directory
  // that still comfortably has one and does everything else with relative paths.
  function runBunFromCwdLongerThanPathMax(...args: string[]) {
    using dir = tempDir("deep-cwd", {});
    let reachable = String(dir);
    while (reachable.length + 1 + component.length <= PATH_MAX - 256) {
      reachable = join(reachable, component);
    }
    mkdirSync(reachable, { recursive: true });
    const unreachable = join(component, component, component);
    expect(reachable.length + 1 + unreachable.length).toBeGreaterThan(PATH_MAX);

    const previousCwd = process.cwd();
    process.chdir(reachable);
    try {
      mkdirSync(unreachable, { recursive: true });
      writeFileSync(join(unreachable, "x.cjs"), `console.log("ran x.cjs from the deep cwd");`);
      const { stdout, stderr, exitCode } = spawnSync({
        cmd: [bunExe(), ...args],
        cwd: unreachable,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    } finally {
      process.chdir(previousCwd);
    }
  }

  // Before this was an error, bun silently used the directory containing its
  // own executable instead: `bun x.cjs` here ran that directory's x.cjs and
  // ignored this one, and `-e` resolved relative requires there.
  test.each([
    ["-e", ["-e", "console.log(__dirname)"]],
    ["x.cjs", ["x.cjs"]],
    ["run x.cjs", ["run", "x.cjs"]],
    ["--cwd . x.cjs", ["--cwd", ".", "x.cjs"]],
    ["test", ["test"]],
  ])("`bun %s` refuses to start from a cwd longer than PATH_MAX", (_, args) => {
    const { stdout, stderr, exitCode } = runBunFromCwdLongerThanPathMax(...args);
    expect(stderr).toMatch(/^(ERANGE|ENAMETOOLONG): .*Could not get the current working directory \(getcwd\)\n$/);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // Node boots in a deleted cwd and lets process.cwd() throw (its
  // test-cwd-enoent tests); that is the one getcwd failure the runtime still
  // starts through.
  test("bun -e still starts from a deleted cwd", () => {
    using dir = tempDir("deleted-cwd", { victim: {} });
    const victim = join(String(dir), "victim");
    const previousCwd = process.cwd();
    process.chdir(victim);
    try {
      rmdirSync(victim);
      const { stdout, stderr, exitCode } = spawnSync({
        cmd: [bunExe(), "-e", `try { process.cwd(); console.log("cwd ok"); } catch (e) { console.log(e.code); }`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stdout.toString()).toBe("ENOENT\n");
      expect(stderr.toString()).toBe("");
      expect(exitCode).toBe(0);
    } finally {
      process.chdir(previousCwd);
    }
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
