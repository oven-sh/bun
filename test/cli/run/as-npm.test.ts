import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, copyFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// https://github.com/oven-sh/bun/issues/5995
// The shim directory that provides a `node` symlink to bun for `--bun` / hosts
// without node also provides `npm` and `npx` fallbacks, so tools that spawn
// `npm`/`npx` via child_process work on a bun-only host.
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

  const spawnNpmFixture = `
    const { spawnSync } = require("child_process");
    for (const cmd of ["npm", "npx"]) {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: ${isWindows} });
      if (r.error) {
        console.log(cmd + " ERR " + (r.error.code || r.error.message));
      } else {
        console.log(cmd + " OK " + r.stdout.trim());
      }
    }
  `;

  // The shim directory is shared (`/tmp/bun-node-*`), so the two tests that
  // exercise its creation cannot run concurrently with each other (or with
  // anything else that passes `--bun` with a different PATH).
  test("child_process.spawn('npm'|'npx') resolves via the shim when not in PATH", async () => {
    using dir = tempDir("fake-npm-spawn", {
      "package.json": JSON.stringify({
        name: "fake-npm-spawn",
        scripts: { go: `${bunExe()} spawn-npm.js` },
      }),
      "spawn-npm.js": spawnNpmFixture,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", "go"],
      cwd: String(dir),
      env: stripEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("ENOENT");
    expect(stdout.trim().split("\n")).toEqual([
      expect.stringMatching(/^npm OK \d+\.\d+\.\d+/),
      expect.stringMatching(/^npx OK \d+\.\d+\.\d+/),
    ]);
    expect(exitCode).toBe(0);
  });

  test("does not shadow a real npm in PATH under --bun", async () => {
    using dir = tempDir("fake-npm-noshadow", {
      "package.json": JSON.stringify({
        name: "fake-npm-noshadow",
        scripts: { go: `${bunExe()} spawn-npm.js` },
      }),
      "spawn-npm.js": spawnNpmFixture,
      "fakebin/placeholder": "",
    });
    for (const name of ["npm", "npx"]) {
      const f = join(String(dir), "fakebin", name + (isWindows ? ".cmd" : ""));
      writeFileSync(f, isWindows ? `@echo REAL-${name}\r\n` : `#!/bin/sh\necho REAL-${name}\n`);
      if (!isWindows) chmodSync(f, 0o755);
    }
    const sep = isWindows ? ";" : ":";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", "go"],
      cwd: String(dir),
      env: { ...stripEnv, PATH: barePATH + sep + join(String(dir), "fakebin") },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim().split("\n")).toEqual(["npm OK REAL-npm", "npx OK REAL-npx"]);
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

    test.concurrent("npx / npm exec dispatch as bunx", () => {
      using dir = tempDir("fake-npx", { "package.json": "{}" });
      expect(fakePmRun(String(dir), "npx", ["--help"]).stderr).toContain("Usage: bunx");
      expect(fakePmRun(String(dir), "npm", ["exec", "--help"]).stderr).toContain("Usage: bunx");
    });

    test.concurrent("npm init <x> / npm create <x> dispatch as bun create, not bun init", () => {
      using dir = tempDir("fake-npm-init", {
        "package.json": "{}",
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // `bun create <name>` runs `bunx create-<name>`; with an unreachable
      // registry that fails fast without scaffolding anything. `bun init
      // <name>` would instead mkdir `<name>/` and write index.ts into it.
      for (const cmd of ["init", "create"]) {
        const r = fakePmRun(String(dir), "npm", [cmd, "nonexistent-template"]);
        expect(r.stdout + r.stderr).toContain("create-nonexistent-template");
        expect(r.stdout + r.stderr).not.toContain("index.ts");
      }
      // Bare `npm init` still means `bun init`.
      const bare = fakePmRun(String(dir), "npm", ["init", "--help"]);
      expect(bare.stdout + bare.stderr).toContain("bun init");
    });

    test.concurrent("npm run -w <pkg> / --prefix <dir> are translated, not dropped", () => {
      using dir = tempDir("fake-npm-ws", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { go: "echo ROOT" },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", scripts: { go: "echo FROM-A" } }),
      });
      const r = fakePmRun(String(dir), "npm", ["run", "go", "-w", "a"]);
      expect(r.stdout).toContain("FROM-A");
      expect(r.stdout).not.toContain("ROOT");

      const r2 = fakePmRun(String(dir), "npm", ["run", "go", "--workspace=a"]);
      expect(r2.stdout).toContain("FROM-A");

      // `--prefix` → `--cwd`
      const r3 = fakePmRun(String(dir), "npm", ["--prefix", join(String(dir), "packages", "a"), "run", "go"]);
      expect(r3.stdout).toContain("FROM-A");
    });

    test.concurrent("-- stops flag translation", () => {
      using dir = tempDir("fake-npm-dd", {
        "package.json": JSON.stringify({ scripts: { go: "echo ARGS:" } }),
      });
      const r = fakePmRun(String(dir), "npm", ["run", "go", "--", "--loglevel", "error"]);
      expect(r.stdout).toContain("ARGS: --loglevel error");
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
