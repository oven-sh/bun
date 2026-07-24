import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// https://github.com/oven-sh/bun/issues/5995
// With `--bun`, the shim directory that provides a `node` symlink to bun also
// provides `npm` and `npx`, so scripts and tools that spawn `npm`/`npx` via
// child_process work when neither is installed on the host.
describe("fake npm/npx cli", () => {
  // A PATH that contains no node/npm/npx: just the dir of the bun-under-test.
  // `bun run` locates a shell via hardcoded fallbacks when PATH has none; on
  // Windows, System32 is needed for cmd.exe.
  const barePATH = isWindows
    ? [dirname(bunExe()), process.env.SystemRoot + "\\System32", process.env.SystemRoot].join(";")
    : dirname(bunExe());
  const stripEnv = {
    ...bunEnv,
    PATH: barePATH,
    Path: undefined,
    npm_execpath: undefined,
    npm_node_execpath: undefined,
    NODE: undefined,
  };

  async function runScript(dir: string, name: string, extraArgs: string[] = []) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", name, ...extraArgs],
      cwd: dir,
      env: stripEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("child_process.spawn('npm'|'npx') resolves via the shim when not in PATH", async () => {
    using dir = tempDir("fake-npm-spawn", {
      "package.json": JSON.stringify({
        name: "fake-npm-spawn",
        scripts: { go: `${bunExe()} spawn-npm.js` },
      }),
      "spawn-npm.js": `
        const { spawnSync } = require("child_process");
        for (const cmd of ["npm", "npx"]) {
          const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: ${isWindows} });
          if (r.error) {
            console.log(cmd + " ERR " + (r.error.code || r.error.message));
          } else {
            console.log(cmd + " OK " + r.stdout.trim());
          }
        }
      `,
    });

    const { stdout, stderr, exitCode } = await runScript(String(dir), "go");
    expect(stderr).not.toContain("ENOENT");
    expect(stdout.trim().split("\n")).toEqual([
      expect.stringMatching(/^npm OK \d+\.\d+\.\d+/),
      expect.stringMatching(/^npx OK \d+\.\d+\.\d+/),
    ]);
    expect(exitCode).toBe(0);
  });

  // When invoked via argv[0] == "npm" / "npx", bun must recognize itself and
  // behave as its package manager / bunx, not try to run a file called
  // "install" or "some-pkg".
  describe("argv[0] dispatch", () => {
    function fakePmRun(dir: string, argv0: "npm" | "npx", args: string[]) {
      const link = join(dir, argv0 + (isWindows ? ".exe" : ""));
      try {
        if (isWindows) copyFileSync(bunExe(), link);
        else symlinkSync(bunExe(), link);
      } catch {}
      const r = Bun.spawnSync({
        cmd: [link, ...args],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      return { stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8"), exitCode: r.exitCode };
    }

    test.concurrent("npm test runs the package.json script, not bun's test runner", () => {
      using dir = tempDir("fake-npm-test", {
        "package.json": JSON.stringify({ scripts: { test: "echo TEST-SCRIPT-RAN" } }),
      });
      const r = fakePmRun(String(dir), "npm", ["test"]);
      expect(r.stdout).toContain("TEST-SCRIPT-RAN");
      expect(r.stdout).not.toContain("bun test v");
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("npm start / npm run <script> run the package.json script", () => {
      using dir = tempDir("fake-npm-start", {
        "package.json": JSON.stringify({ scripts: { start: "echo STARTED", other: "echo OTHER" } }),
      });
      expect(fakePmRun(String(dir), "npm", ["start"]).stdout).toContain("STARTED");
      expect(fakePmRun(String(dir), "npm", ["run", "other"]).stdout).toContain("OTHER");
    });

    test.concurrent("npm install drops npm-only value-taking flags", () => {
      using dir = tempDir("fake-npm-install", {
        "package.json": JSON.stringify({ name: "p", version: "0.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // create-react-app's invocation shape. The `error` and `silent` tokens
      // are values for `--loglevel`/`--logs-dir`, not packages to install.
      const r = fakePmRun(String(dir), "npm", [
        "install",
        "--no-audit",
        "--save",
        "--save-exact",
        "--loglevel",
        "error",
        "--logs-dir",
        "silent",
        "--dry-run",
      ]);
      // It ran as `bun install` (no positionals), not `bun add error silent`.
      expect(r.stdout).toContain("bun install");
      expect(r.stdout).not.toContain("bun add");
      expect(r.stdout + r.stderr).not.toMatch(/\berror\b.*@/);
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("npm --version prints a version", () => {
      using dir = tempDir("fake-npm-ver", { "package.json": "{}" });
      const r = fakePmRun(String(dir), "npm", ["--version"]);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expect(r.exitCode).toBe(0);
    });

    test.concurrent("npx dispatches as bunx", () => {
      using dir = tempDir("fake-npx", { "package.json": "{}" });
      const r = fakePmRun(String(dir), "npx", ["--help"]);
      expect(r.stdout + r.stderr).toContain("Usage: bunx");
    });

    test.concurrent("pnpm as argv0 is not treated as npm", () => {
      using dir = tempDir("fake-pnpm", {
        "package.json": JSON.stringify({ scripts: { test: "echo SHOULD-NOT-RUN" } }),
      });
      const link = join(String(dir), "pnpm" + (isWindows ? ".exe" : ""));
      try {
        if (isWindows) copyFileSync(bunExe(), link);
        else symlinkSync(bunExe(), link);
      } catch {}
      const r = Bun.spawnSync({ cmd: [link, "test"], cwd: String(dir), env: bunEnv });
      // falls through to bun's own `test` command, not `run test`
      expect(r.stdout.toString()).not.toContain("SHOULD-NOT-RUN");
    });
  });
});
