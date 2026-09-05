import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, copyFileSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
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

  test("does not shadow a vendored node_modules/.bin npm", async () => {
    using dir = tempDir("fake-npm-binshadow", {
      "package.json": JSON.stringify({
        name: "fake-npm-binshadow",
        scripts: { go: `${bunExe()} spawn-npm.js` },
      }),
      "spawn-npm.js": spawnNpmFixture,
      "node_modules/.bin/placeholder": "",
    });
    for (const name of ["npm", "npx"]) {
      const f = join(String(dir), "node_modules", ".bin", name + (isWindows ? ".cmd" : ""));
      writeFileSync(f, isWindows ? `@echo BIN-${name}\r\n` : `#!/bin/sh\necho BIN-${name}\n`);
      if (!isWindows) chmodSync(f, 0o755);
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", "go"],
      cwd: String(dir),
      env: stripEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim().split("\n")).toEqual(["npm OK BIN-npm", "npx OK BIN-npx"]);
    expect(exitCode).toBe(0);
  });

  // When invoked via argv[0] == "npm" / "npx", bun must recognize itself and
  // behave as its package manager / bunx, not try to run a file called
  // "install" or "some-pkg".
  describe("argv[0] dispatch", () => {
    function linkAs(dir: string, argv0: string): string {
      const link = join(dir, argv0 + (isWindows ? ".exe" : ""));
      // A test may invoke the same link several times in the same dir.
      if (!existsSync(link)) {
        if (isWindows) copyFileSync(bunExe(), link);
        else symlinkSync(bunExe(), link);
      }
      return link;
    }

    async function fakePmRun(dir: string, argv0: "npm" | "npx" | "pnpm", args: string[]) {
      await using proc = Bun.spawn({
        cmd: [linkAs(dir, argv0), ...args],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("npm test runs the package.json script, not bun's test runner", async () => {
      using dir = tempDir("fake-npm-test", {
        "package.json": JSON.stringify({ scripts: { test: "echo TEST-SCRIPT-RAN" } }),
      });
      const r = await fakePmRun(String(dir), "npm", ["test"]);
      expect(r.stdout).toContain("TEST-SCRIPT-RAN");
      expect(r.stdout).not.toContain("bun test v");
      expect(r.exitCode).toBe(0);
    });

    test("npm start / npm run <script> run the package.json script", async () => {
      using dir = tempDir("fake-npm-start", {
        "package.json": JSON.stringify({ scripts: { start: "echo STARTED", other: "echo OTHER" } }),
      });
      expect((await fakePmRun(String(dir), "npm", ["start"])).stdout).toContain("STARTED");
      expect((await fakePmRun(String(dir), "npm", ["run", "other"])).stdout).toContain("OTHER");
    });

    test("npm install drops npm-only value-taking flags", async () => {
      using dir = tempDir("fake-npm-install", {
        "package.json": JSON.stringify({ name: "p", version: "0.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // create-react-app's invocation shape. The `error` and `silent` tokens
      // are values for `--loglevel`/`--logs-dir`, not packages to install.
      const r = await fakePmRun(String(dir), "npm", [
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

    test("npm publish keeps --tag/--access/--otp", async () => {
      using dir = tempDir("fake-npm-publish", {
        "package.json": JSON.stringify({ name: "fake-npm-publish", version: "1.2.3" }),
        // A token so publish gets past the auth check; --dry-run stops
        // before any network request.
        "bunfig.toml": `[install]\nregistry = { url = "http://127.0.0.1:1/", token = "fake" }\n`,
      });
      // `--tag` before the subcommand pins that the keep list applies to
      // pre-subcommand flags too; npm accepts config flags in any position.
      const r = await fakePmRun(String(dir), "npm", ["--tag", "beta", "publish", "--dry-run", "--access", "public"]);
      expect(r.stdout).toContain("Tag: beta");
      expect(r.stdout).toContain("Access: public");
      expect(r.exitCode).toBe(0);
    });

    test("npm upgrade dispatches as bun update, not bun's self-upgrader", async () => {
      using dir = tempDir("fake-npm-upgrade", { "package.json": "{}" });
      const r = await fakePmRun(String(dir), "npm", ["upgrade", "--help"]);
      expect(r.stdout).toContain("bun update");
      expect(r.exitCode).toBe(0);
      // A leading `--` still names the subcommand in npm, so the mapping
      // must apply to it too.
      const dd = await fakePmRun(String(dir), "npm", ["--", "upgrade", "--help"]);
      expect(dd.stdout).toContain("bun update");
      expect(dd.exitCode).toBe(0);
    });

    test("npm cache dispatches as bun pm cache", async () => {
      using dir = tempDir("fake-npm-cache", { "package.json": "{}" });
      const r = await fakePmRun(String(dir), "npm", ["cache"]);
      // `bun pm cache` prints the cache directory path.
      expect(existsSync(r.stdout.trim())).toBe(true);
      expect(r.exitCode).toBe(0);
    });

    test("npm install --save-dev writes to devDependencies", async () => {
      using dir = tempDir("fake-npm-savedev", {
        "package.json": JSON.stringify({ name: "root", version: "1.0.0" }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "dep2/package.json": JSON.stringify({ name: "dep2", version: "1.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      const r = await fakePmRun(String(dir), "npm", ["install", "--save-dev", "./dep"]);
      expect(r.exitCode).toBe(0);
      // npm's `-O` short means --save-optional.
      const r2 = await fakePmRun(String(dir), "npm", ["install", "-O", "./dep2"]);
      expect(r2.exitCode).toBe(0);
      const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
      expect(pkg.devDependencies).toEqual({ dep: "./dep" });
      expect(pkg.optionalDependencies).toEqual({ dep2: "./dep2" });
      expect(pkg.dependencies).toBeUndefined();
    });

    test("npm install -P does not enable bun's production mode", async () => {
      using dir = tempDir("fake-npm-saveprod", {
        "package.json": JSON.stringify({
          name: "root",
          version: "1.0.0",
          devDependencies: { dep: "./dep" },
        }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // npm's -P is --save-prod, a no-op default; bun's own -P is --prod,
      // which would skip devDependencies.
      const r = await fakePmRun(String(dir), "npm", ["install", "-P"]);
      expect(existsSync(join(String(dir), "node_modules", "dep"))).toBe(true);
      expect(r.exitCode).toBe(0);
    });

    test("npm config value flags before the subcommand do not eat it", async () => {
      using dir = tempDir("fake-npm-preflag", {
        "package.json": JSON.stringify({ name: "p", version: "0.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // `dev` is --omit's value, not the subcommand; --omit itself is a
      // flag bun install accepts and must reach it.
      const r = await fakePmRun(String(dir), "npm", ["--omit", "dev", "install", "--dry-run"]);
      expect(r.stdout).toContain("bun install");
      expect(r.exitCode).toBe(0);
    });

    test("npm version dispatches as bun pm version", async () => {
      using dir = tempDir("fake-npm-version", {
        "package.json": JSON.stringify({ name: "fake-npm-version", version: "1.2.3" }),
      });
      const r = await fakePmRun(String(dir), "npm", ["version", "patch", "--no-git-tag-version"]);
      expect(r.stdout).toContain("v1.2.4");
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(await Bun.file(join(String(dir), "package.json")).text()).version).toBe("1.2.4");
      // npm's -m shorthand takes a value; it must not eat the subcommand.
      const m = await fakePmRun(String(dir), "npm", ["-m", "a message", "version", "patch", "--no-git-tag-version"]);
      expect(m.stdout).toContain("v1.2.5");
      expect(m.exitCode).toBe(0);
    });

    test("npm pack dispatches as bun pm pack, rewriting --pack-destination", async () => {
      using dir = tempDir("fake-npm-pack", {
        "package.json": JSON.stringify({ name: "fake-npm-pack", version: "1.0.0" }),
      });
      const r = await fakePmRun(String(dir), "npm", ["pack", "--pack-destination", "./tarballs"]);
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(String(dir), "tarballs", "fake-npm-pack-1.0.0.tgz"))).toBe(true);
      // `-w` is dropped here (bun pm pack has no --filter); the workspace
      // name must not leak into the pm subcommand position.
      const ws = await fakePmRun(String(dir), "npm", ["pack", "-w", "whatever"]);
      expect(ws.exitCode).toBe(0);
      expect(existsSync(join(String(dir), "fake-npm-pack-1.0.0.tgz"))).toBe(true);
    });

    test("npm --version prints a version", async () => {
      using dir = tempDir("fake-npm-ver", { "package.json": "{}" });
      const r = await fakePmRun(String(dir), "npm", ["--version"]);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expect(r.exitCode).toBe(0);
    });

    test("npx / npm exec dispatch as bunx", async () => {
      using dir = tempDir("fake-npx", { "package.json": "{}" });
      expect((await fakePmRun(String(dir), "npx", ["--help"])).stderr).toContain("Usage: bunx");
      expect((await fakePmRun(String(dir), "npm", ["exec", "--help"])).stderr).toContain("Usage: bunx");
      // npm's -p before the subcommand must not become bunx's --package,
      // which would take the mapped "x" token for the package name.
      expect((await fakePmRun(String(dir), "npm", ["-p", "exec", "--help"])).stderr).toContain("Usage: bunx");
      // After the subcommand too: npm's -p is --parseable, not --package.
      expect((await fakePmRun(String(dir), "npm", ["exec", "-p", "--help"])).stderr).toContain("Usage: bunx");
    });

    test("npm lowercase shorts are not bun's production/yarn flags", async () => {
      using dir = tempDir("fake-npm-shorts", {
        "package.json": JSON.stringify({
          name: "root",
          version: "1.0.0",
          devDependencies: { dep: "./dep" },
        }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "dep2/package.json": JSON.stringify({ name: "dep2", version: "1.0.0" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // npm's -p is --parseable, not bun's --production.
      const r = await fakePmRun(String(dir), "npm", ["install", "-p"]);
      expect(existsSync(join(String(dir), "node_modules", "dep"))).toBe(true);
      expect(r.exitCode).toBe(0);
      // npm's -y is --yes, not bun's --yarn.
      const y = await fakePmRun(String(dir), "npm", ["-y", "install"]);
      expect(existsSync(join(String(dir), "yarn.lock"))).toBe(false);
      expect(y.exitCode).toBe(0);
      // npm's -dd is a loglevel shorthand, not a chained bun -d -d (--dev).
      const dd = await fakePmRun(String(dir), "npm", ["install", "-dd", "./dep2"]);
      expect(dd.exitCode).toBe(0);
      const pkg = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
      expect(pkg.dependencies).toEqual({ dep2: "./dep2" });
    });

    test("npx drops npm config flags before the package name", async () => {
      using dir = tempDir("fake-npx-flags", {
        "package.json": "{}",
        // `error` must not be taken for the package name; the registry
        // override keeps an unfixed bun from reaching the network.
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      const r = await fakePmRun(String(dir), "npx", ["--loglevel", "error", "--version"]);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expect(r.exitCode).toBe(0);
      // `--package <pkg>` is bunx's own value flag; config flags after it
      // must still be stripped so their value is not taken for the binary
      // name, which makes bunx ask for one.
      const pkg = await fakePmRun(String(dir), "npx", ["--package", "some-pkg", "--loglevel", "error"]);
      expect(pkg.stdout + pkg.stderr).toContain("you must specify the binary");
    });

    test("npm init <x> / npm create <x> dispatch as bun create, not bun init", async () => {
      using dir = tempDir("fake-npm-init", {
        "package.json": "{}",
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // `bun create <name>` runs `bunx create-<name>`; with an unreachable
      // registry that fails fast without scaffolding anything. `bun init
      // <name>` would instead mkdir `<name>/` and write index.ts into it.
      for (const cmd of ["init", "create"]) {
        const r = await fakePmRun(String(dir), "npm", [cmd, "nonexistent-template"]);
        expect(r.stdout + r.stderr).toContain("create-nonexistent-template");
        expect(r.stdout + r.stderr).not.toContain("index.ts");
      }
      // Bare `npm init` still means `bun init`.
      const bare = await fakePmRun(String(dir), "npm", ["init", "--help"]);
      expect(bare.stdout + bare.stderr).toContain("bun init");
    });

    test("npm init flags do not leak into the template name", async () => {
      using dir = tempDir("fake-npm-init-flags", {
        "package.json": "{}",
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // A value-flag's value is not an initializer.
      const flags = await fakePmRun(String(dir), "npm", ["init", "--loglevel", "error", "--help"]);
      expect(flags.stdout + flags.stderr).toContain("bun init");
      // `-w client` must not become the template: `bun create`'s scanner
      // takes the first non-flag token, so translated flags are not hoisted
      // into it.
      const ws = await fakePmRun(String(dir), "npm", ["init", "nonexistent-template", "-w", "client"]);
      expect(ws.stdout + ws.stderr).toContain("create-nonexistent-template");
      expect(ws.stdout + ws.stderr).not.toContain("create-client");
    });

    test("npm init separators and boolean flags do not leak into the template", async () => {
      using dir = tempDir("fake-npm-init-sep", {
        "package.json": "{}",
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      // Everything after `--` is positional in npm, so it still names a
      // template, and a short boolean flag is not one.
      const dd = await fakePmRun(String(dir), "npm", ["init", "--", "nonexistent-template"]);
      expect(dd.stdout + dd.stderr).toContain("create-nonexistent-template");
      const y = await fakePmRun(String(dir), "npm", ["init", "-y", "nonexistent-template"]);
      expect(y.stdout + y.stderr).toContain("create-nonexistent-template");
      expect(y.stdout + y.stderr).not.toContain("create--y");
    });

    test("npm init --scope's value does not become the template", async () => {
      using dir = tempDir("fake-npm-init-scope", {
        "package.json": "{}",
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      const scoped = await fakePmRun(String(dir), "npm", ["init", "--scope", "@myorg", "nonexistent-template"]);
      expect(scoped.stdout + scoped.stderr).toContain("create-nonexistent-template");
      expect(scoped.stdout + scoped.stderr).not.toContain("@myorg");
    });

    test("npm run -w <pkg> / --prefix <dir> are translated, not dropped", async () => {
      using dir = tempDir("fake-npm-ws", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { go: "echo ROOT" },
        }),
        "packages/a/package.json": JSON.stringify({ name: "a", scripts: { go: "echo FROM-A" } }),
      });
      const r = await fakePmRun(String(dir), "npm", ["run", "go", "-w", "a"]);
      expect(r.stdout).toContain("FROM-A");
      expect(r.stdout).not.toContain("ROOT");

      const r2 = await fakePmRun(String(dir), "npm", ["run", "go", "--workspace=a"]);
      expect(r2.stdout).toContain("FROM-A");

      // `--prefix` → `--cwd`
      const r3 = await fakePmRun(String(dir), "npm", ["--prefix", join(String(dir), "packages", "a"), "run", "go"]);
      expect(r3.stdout).toContain("FROM-A");
    });

    test("npm test --prefix <dir> runs the script in that directory", async () => {
      using dir = tempDir("fake-npm-test-prefix", {
        "package.json": JSON.stringify({ name: "root" }),
        "client/package.json": JSON.stringify({ name: "client", scripts: { test: "echo CLIENT-TEST" } }),
      });
      // The translated --cwd must land between `run` and the script name;
      // anything after the script name is forwarded to the script.
      const r = await fakePmRun(String(dir), "npm", ["test", "--prefix", "./client"]);
      expect(r.stdout).toContain("CLIENT-TEST");
      expect(r.exitCode).toBe(0);
    });

    test("npm run flags after the script name are npm's, not the script's", async () => {
      using dir = tempDir("fake-npm-postflag", {
        "package.json": JSON.stringify({ name: "p", scripts: { go: "echo ARGS:" } }),
      });
      // npm consumes config flags anywhere before `--`; only args after `--`
      // reach the script.
      const r = await fakePmRun(String(dir), "npm", ["run", "go", "--silent"]);
      expect(r.stdout).not.toContain("ARGS: --silent");
      expect(r.exitCode).toBe(0);
      // `--if-present` after the script name must reach bun run, so a
      // missing script exits 0.
      const ip = await fakePmRun(String(dir), "npm", ["run", "missing-script", "--if-present"]);
      expect(ip.exitCode).toBe(0);
    });

    test("npm run value flags consume their value like npm's parser", async () => {
      using dir = tempDir("fake-npm-pairflag", {
        "package.json": JSON.stringify({ name: "p", scripts: { go: "echo ARGS:" } }),
      });
      // Neither the flag nor its value may shift the script name or reach
      // the script.
      const pair = await fakePmRun(String(dir), "npm", ["run", "go", "--port", "3000"]);
      expect(pair.stdout).toContain("ARGS:");
      expect(pair.stdout).not.toContain("3000");
      expect(pair.exitCode).toBe(0);
      // A boolean npm flag before the script name must not eat it.
      const short = await fakePmRun(String(dir), "npm", ["run", "-s", "go"]);
      expect(short.stdout).toContain("ARGS:");
      expect(short.exitCode).toBe(0);
    });

    test("npm run boolean flags do not eat the script name", async () => {
      using dir = tempDir("fake-npm-boolflag", {
        "package.json": JSON.stringify({ name: "p", scripts: { go: "echo ARGS:" } }),
      });
      const force = await fakePmRun(String(dir), "npm", ["run", "--force", "go"]);
      expect(force.stdout).toContain("ARGS:");
      expect(force.exitCode).toBe(0);
      // npm shorts before the subcommand must not reach bun's parser, where
      // -d means --define and would consume "run".
      const pre = await fakePmRun(String(dir), "npm", ["-d", "run", "go"]);
      expect(pre.stdout).toContain("ARGS:");
      expect(pre.exitCode).toBe(0);
      // npm's -l (--long) is boolean and must not pair with the script name.
      const l = await fakePmRun(String(dir), "npm", ["run", "-l", "go"]);
      expect(l.stdout).toContain("ARGS:");
      expect(l.exitCode).toBe(0);
    });

    test("npm -y init does not scaffold into a folder named init", async () => {
      using dir = tempDir("fake-npm-yinit", {
        "package.json": "{}",
        // init runs an install afterwards; keep it off the network.
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/nope"\n`,
      });
      await fakePmRun(String(dir), "npm", ["-y", "init"]);
      expect(existsSync(join(String(dir), "init"))).toBe(false);
      expect(existsSync(join(String(dir), "index.ts"))).toBe(true);
    });

    test("-- stops flag translation", async () => {
      using dir = tempDir("fake-npm-dd", {
        "package.json": JSON.stringify({ scripts: { go: "echo ARGS:" } }),
      });
      const r = await fakePmRun(String(dir), "npm", ["run", "go", "--", "--loglevel", "error"]);
      expect(r.stdout).toContain("ARGS: --loglevel error");
    });

    test("pnpm as argv0 is not treated as npm", async () => {
      using dir = tempDir("fake-pnpm", {
        "package.json": JSON.stringify({ scripts: { test: "echo SHOULD-NOT-RUN" } }),
      });
      const r = await fakePmRun(String(dir), "pnpm", ["test"]);
      // falls through to bun's own `test` command, not `run test`
      expect(r.stdout).toContain("bun test v");
      expect(r.stdout).not.toContain("SHOULD-NOT-RUN");
    });
  });
});
