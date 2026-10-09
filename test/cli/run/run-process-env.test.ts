import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = "start:dev";

    using dir = tempDir("processenv", {
      "package.json": JSON.stringify({ "scripts": { [`${scriptName}`]: `'${bunExe()}' run index.ts` } }),
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });
    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });

  // https://github.com/oven-sh/bun/issues/3589
  test("npm_lifecycle_event should have the value of the last call", () => {
    using dir = tempDir("processenv_ls_call", {
      "package.json": JSON.stringify({ scripts: { first: `'${bunExe()}' run --cwd lsc second` } }),
      "lsc": {
        "package.json": JSON.stringify({ scripts: { second: `'${bunExe()}' run index.ts` } }),
        "index.ts": "console.log(process.env.npm_lifecycle_event);",
      },
    });
    const { stdout } = bunRunAsScript(dir, "first");
    expect(stdout).toBe("second");
  });
});

// https://github.com/oven-sh/bun/issues/21088
// Not concurrent: a debug build starts slowly, and a case that starts a second bun next to
// twenty other cases can pass the test timeout.
describe("INIT_CWD", () => {
  // `forCmd`: the scripts are for cmd.exe, which is `--shell=system` on Windows.
  function project(forCmd = false) {
    const show = (label: string) => (forCmd ? `echo ${label}=%INIT_CWD%` : `echo ${label}=$INIT_CWD`);
    const dir = tempDir("run-init-cwd", {
      "package.json": JSON.stringify({
        name: "init-cwd",
        version: "1.0.0",
        workspaces: ["packages/*"],
        scripts: {
          preshow: show("pre"),
          show: show("main"),
          postshow: show("post"),
          // The inner bun starts in `sub`: not the package root and not the `--cwd` target.
          outer: `${show("outer")} && cd sub && '${bunExe()}' run --silent --cwd deep show`,
          prepack: show("prepack"),
          postpack: show("postpack"),
          prepublishOnly: show("prepublishOnly"),
          preversion: show("preversion"),
          version: show("version"),
          postversion: show("postversion"),
        },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          show: show("member"),
          // Runs a script of the root, as `npm --prefix ../.. run show` does.
          up: `'${bunExe()}' run --silent --cwd=../.. show`,
        },
      }),
      // `bun publish --dry-run` sends nothing. The registry only has to have a token.
      "bunfig.toml": `[install]\nregistry = { url = "http://localhost:1/", token = "not-a-token" }\n`,
      "sub/deep/file.js": "console.log('file=' + process.env.INIT_CWD);",
      "other/.keep": "",
      ...(isWindows
        ? {
            "node_modules/.bin/show-init-cwd.cmd": "@echo bin=%INIT_CWD%\r\n",
            "node_modules/.bin/node-gyp.cmd": "@echo gyp=%INIT_CWD%\r\n",
          }
        : {
            "node_modules/.bin/show-init-cwd": "#!/bin/sh\necho bin=$INIT_CWD\n",
            "node_modules/.bin/node-gyp": "#!/bin/sh\necho gyp=$INIT_CWD\n",
          }),
    });
    if (!isWindows) {
      for (const bin of ["show-init-cwd", "node-gyp"]) chmodSync(join(String(dir), "node_modules", ".bin", bin), 0o755);
    }
    const root = String(dir);
    return Object.assign(dir, {
      root,
      deep: join(root, "sub", "deep"),
      other: join(root, "other"),
      member: join(root, "packages", "a"),
    });
  }

  // The environment of the runner can hold an INIT_CWD of its own, so each run states the value it inherits.
  async function run(args: string[], cwd: string, env: Record<string, string | undefined> = { INIT_CWD: "inherited" }) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split(/\r?\n/), stderr, exitCode };
  }

  const lines = (text: string) => text.trim().split(/\r?\n/);
  const allThree = (dir: string) => ({ stdout: [`pre=${dir}`, `main=${dir}`, `post=${dir}`], stderr: "", exitCode: 0 });

  test.each([
    ["bun run", ["run", "--silent", "show"]],
    ["bun <script>", ["--silent", "show"]],
    ["--shell=bun", ["run", "--silent", "--shell=bun", "show"]],
    ["--shell=system", ["run", "--silent", "--shell=system", "show"]],
  ])("%s: a script and its pre and post scripts get the directory bun was started in", async (name, args) => {
    using dir = project(isWindows && name === "--shell=system");
    expect(await run(args, dir.deep)).toEqual(allThree(dir.deep));
  });

  test("is set when the environment has none", async () => {
    using dir = project();
    expect(await run(["run", "--silent", "show"], dir.deep, { INIT_CWD: undefined })).toEqual(allThree(dir.deep));
  });

  // `--cwd` names where bun goes. INIT_CWD is where it was started, as with `npm --prefix` and `pnpm -C`.
  test.each([
    ["a relative", (_root: string) => "../sub/deep"],
    ["an absolute", (root: string) => join(root, "sub", "deep")],
  ])("%s --cwd does not change it", async (_, target) => {
    using dir = project();
    expect(await run(["run", "--silent", "--cwd", target(dir.root), "show"], dir.other)).toEqual(allThree(dir.other));
  });

  test("a nested bun run sets its own", async () => {
    using dir = project();
    const inner = allThree(join(dir.root, "sub"));
    expect(await run(["run", "--silent", "outer"], dir.other)).toEqual({
      ...inner,
      stdout: [`outer=${dir.other}`, ...inner.stdout],
    });
  });

  test("a root script that a member runs with --cwd=../.. gets the member directory", async () => {
    using dir = project();
    expect(await run(["run", "--silent", "up"], dir.member)).toEqual(allThree(dir.member));
  });

  test.each([
    ["bun run <bin>", ["run", "show-init-cwd"]],
    ["bunx <bin>", ["x", "--no-install", "show-init-cwd"]],
  ])("%s: a bin of node_modules/.bin gets it", async (_, args) => {
    using dir = project();
    expect(await run(args, dir.deep)).toEqual({ stdout: [`bin=${dir.deep}`], stderr: "", exitCode: 0 });
  });

  test("bun run --cwd <bin>: the bin gets the directory bun was started in", async () => {
    using dir = project();
    expect(await run(["run", "--cwd", "../sub/deep", "show-init-cwd"], dir.other)).toEqual({
      stdout: [`bin=${dir.other}`],
      stderr: "",
      exitCode: 0,
    });
  });

  // `bun install` links this bin. On Windows that is a `.bunx` shim, and `--bun` runs it in the bun process.
  describe("a bin that bun install linked gets it", () => {
    let dir: ReturnType<typeof tempDir>;
    const env = () => ({ INIT_CWD: "inherited", BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") });

    beforeAll(async () => {
      dir = tempDir("run-init-cwd-bin", {
        "package.json": JSON.stringify({
          name: "consumer",
          version: "0.0.0",
          dependencies: { "print-init-cwd": "file:./print-init-cwd" },
        }),
        "print-init-cwd/package.json": JSON.stringify({
          name: "print-init-cwd",
          version: "0.0.0",
          bin: { "print-init-cwd": "./bin.js" },
        }),
        "print-init-cwd/bin.js": `#!/usr/bin/env node\nconsole.log("bin=" + process.env.INIT_CWD);\n`,
      });
      expect(await run(["install"], String(dir), env())).toMatchObject({ exitCode: 0 });
    });
    afterAll(() => dir[Symbol.dispose]());

    test.each([
      ["bun run <bin>", ["run", "print-init-cwd"]],
      ["bun --bun run <bin>", ["--bun", "run", "print-init-cwd"]],
      ["bunx <bin>", ["x", "--no-install", "print-init-cwd"]],
    ])("%s", async (_, args) => {
      expect(await run(args, String(dir), env())).toEqual({ stdout: [`bin=${String(dir)}`], stderr: "", exitCode: 0 });
    });
  });

  // `bun install` gives its lifecycle scripts BUN_WHICH_IGNORE_CWD, for its node-gyp shim, which runs
  // `bun x node-gyp`. Only that command keeps the INIT_CWD of the install.
  test.each([
    ["node-gyp in a lifecycle script keeps the value of the install", "node-gyp", true, () => "gyp=inherited"],
    ["another bin in a lifecycle script gets its own", "show-init-cwd", true, (deep: string) => `bin=${deep}`],
    ["node-gyp that the user runs gets its own", "node-gyp", false, (deep: string) => `gyp=${deep}`],
  ])("bunx: %s", async (_, bin, inLifecycleScript, expected) => {
    using dir = project();
    const env = { INIT_CWD: "inherited", BUN_WHICH_IGNORE_CWD: inLifecycleScript ? dir.other : undefined };
    expect(await run(["x", "--no-install", bin], dir.deep, env)).toEqual({
      stdout: [expected(dir.deep)],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["a directory below the root", (dir: ReturnType<typeof project>) => dir.other, []],
    ["the root", (dir: ReturnType<typeof project>) => dir.root, []],
    ["a directory that --cwd leaves", (dir: ReturnType<typeof project>) => dir.other, ["--cwd", ".."]],
  ])("--filter: a script gets the directory bun was started in: %s", async (_, from, flags) => {
    using dir = project();
    expect(await run(["run", ...flags, "--filter", "a", "show"], from(dir))).toEqual({
      stdout: [`a show: member=${from(dir)}`, "a show: Exited with code 0"],
      stderr: "",
      exitCode: 0,
    });
  });

  // Every process of `--parallel` and `--sequential` ends with a `Done` line on stderr.
  const withoutDone = (stderr: string) => lines(stderr).filter(line => !line.includes("| Done in "));

  test.each([
    ["--parallel", ["run", "--parallel", "show"]],
    ["--sequential", ["run", "--sequential", "show"]],
    ["--cwd", ["run", "--cwd", "../sub/deep", "--parallel", "show"]],
  ])("%s: a script gets the directory bun was started in", async (_, args) => {
    using dir = project();
    const { stdout, stderr, exitCode } = await run(args, dir.other);
    expect({ stdout, stderr: withoutDone(stderr), exitCode }).toEqual({
      stdout: allThree(dir.other).stdout.map(line => `show | ${line}`),
      stderr: [],
      exitCode: 0,
    });
  });

  // A file that bun runs is no script: next to a script or alone, it keeps the value bun inherited.
  test.each([
    ["next to a script", ["show", "./file.js"]],
    ["alone", ["./file.js"]],
  ])("--parallel: a file %s keeps the value bun inherited", async (_, targets) => {
    using dir = project();
    const { stdout, stderr, exitCode } = await run(["run", "--parallel", ...targets], dir.deep);
    const script = targets.includes("show") ? allThree(dir.deep).stdout.map(line => `show      | ${line}`) : [];
    expect({ stdout: stdout.sort(), stderr: withoutDone(stderr), exitCode }).toEqual({
      stdout: ["./file.js | file=inherited", ...script].sort(),
      stderr: [],
      exitCode: 0,
    });
  });

  // These scripts go through the same runner as those of `bun run`.
  test.each([
    ["bun pm pack", ["pm", "pack", "--dry-run"], ["prepack", "postpack"]],
    ["bun pm pack --cwd", ["pm", "pack", "--dry-run", "--cwd", ".."], ["prepack", "postpack"]],
    ["bun publish", ["publish", "--dry-run"], ["prepublishOnly", "prepack", "postpack"]],
    ["bun pm version", ["pm", "version", "patch", "--no-git-tag-version"], ["preversion", "version", "postversion"]],
  ])("%s: the scripts get the directory bun was started in", async (_, args, scripts) => {
    using dir = project();
    const { stdout, stderr, exitCode } = await run(args, dir.other);
    expect({
      stdout: stdout.filter(line => scripts.some(script => line.startsWith(`${script}=`))),
      stderr: lines(stderr),
      exitCode,
    }).toEqual({
      stdout: scripts.map(script => `${script}=${dir.other}`),
      stderr: scripts.map(script => `$ echo ${script}=$INIT_CWD`),
      exitCode: 0,
    });
  });

  // The lifecycle scripts get the project root on purpose: not the directory `bun install` was started in,
  // and not a value it inherited.
  describe("bun install gives its lifecycle scripts the project root", () => {
    const install = (args: string[], cwd: string) =>
      run(args, cwd, { INIT_CWD: "inherited", BUN_INSTALL_CACHE_DIR: join(cwd, ".cache") });

    // A `bun run` in a lifecycle script starts in the directory of its package.
    test("from a directory below the root, in a workspace", async () => {
      using dir = tempDir("install-init-cwd", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { postinstall: "echo postinstall=$INIT_CWD" },
        }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          scripts: { postinstall: `'${bunExe()}' run --silent write`, write: "echo member=$INIT_CWD > init-cwd.txt" },
        }),
        "sub/.keep": "",
      });
      const root = String(dir);
      const member = join(root, "packages", "a");
      const { stdout, stderr, exitCode } = await install(["install"], join(root, "sub"));
      expect({
        postinstall: stdout.filter(line => line.startsWith("postinstall=")),
        member: (await Bun.file(join(member, "init-cwd.txt")).text()).trim(),
        stderr,
        exitCode,
      }).toEqual({
        postinstall: [`postinstall=${root}`],
        member: `member=${member}`,
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
    });

    test("when a bun run script runs it", async () => {
      using dir = tempDir("install-init-cwd", {
        "package.json": JSON.stringify({
          name: "root",
          scripts: { setup: `'${bunExe()}' install`, postinstall: "echo postinstall=$INIT_CWD" },
        }),
        "sub/.keep": "",
      });
      const root = String(dir);
      const { stdout, stderr, exitCode } = await install(["run", "--silent", "setup"], join(root, "sub"));
      expect({ postinstall: stdout.filter(line => line.startsWith("postinstall=")), stderr, exitCode }).toEqual({
        postinstall: [`postinstall=${root}`],
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
    });
  });

  // The file runs in this process: INIT_CWD is still that of the runner which started bun.
  test.each([
    ["the value bun inherited", "inherited"],
    ["no value when bun inherited none", undefined],
  ])("a file has %s", async (_, INIT_CWD) => {
    using dir = project();
    expect(await run(["run", "file.js"], dir.deep, { INIT_CWD })).toEqual({
      stdout: [`file=${INIT_CWD}`],
      stderr: "",
      exitCode: 0,
    });
  });
});

// https://github.com/oven-sh/bun/issues/21088
describe("npm_config_local_prefix", () => {
  const scripts = { prefix: "echo $npm_config_local_prefix" };
  const pkg = (fields: object = {}) => JSON.stringify({ scripts, ...fields });
  const printFromJs = `console.log(process.env.npm_config_local_prefix ?? "<unset>");`;
  const run = ["run", "--silent", "prefix"];

  // What a script, a bin or a file that `bun <args>` runs in `cwd` gets. bunEnv has the value
  // of the `bun run` that started the test runner, so the variable is only there when `env` sets it.
  async function localPrefix(cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, npm_config_local_prefix: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }
  const printed = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });

  function workspace() {
    const bin = (name: string) =>
      isWindows
        ? { [`node_modules/.bin/${name}.cmd`]: "@echo off\r\necho %npm_config_local_prefix%\r\n" }
        : { [`node_modules/.bin/${name}`]: `#!/bin/sh\necho "$npm_config_local_prefix"\n` };
    const dir = tempDir("processenv_local_prefix", {
      "package.json": pkg({ name: "root", workspaces: ["packages/*"] }),
      "sub/deep/file.js": printFromJs,
      "packages/a/package.json": pkg({ name: "a" }),
      "packages/a/src/.keep": "",
      "packages/b/package.json": pkg({ name: "b" }),
      "packages/b/src/.keep": "",
      // Below the workspace root, but not in "workspaces".
      "tools/x/package.json": pkg({ name: "x" }),
      "tools/x/src/.keep": "",
      // No package.json: the script of the root runs.
      "vendor/node_modules/.keep": "",
      "vendor/src/.keep": "",
      ...bin("print-prefix"),
      ...bin("node-gyp"),
    });
    if (!isWindows) {
      for (const name of ["print-prefix", "node-gyp"]) chmodSync(join(String(dir), "node_modules/.bin", name), 0o755);
    }
    return dir;
  }

  test.concurrent.each([
    // [start directory, arguments of bun, expected]. The directories are relative to the workspace root.
    ["", run, ""],
    ["sub/deep", run, ""],
    ["sub/deep", ["--silent", "prefix"], ""],
    ["packages/a", run, ""],
    ["packages/a/src", run, ""],
    ["tools/x/src", run, "tools/x"],
    ["sub/deep", ["run", "--silent", "--cwd", "../../packages/a/src", "prefix"], ""],
    ["sub/deep", ["run", "print-prefix"], ""],
    ["packages/a/src", ["run", "print-prefix"], ""],
    ["sub/deep", ["x", "--no-install", "print-prefix"], ""],
    ["sub/deep", ["run", "file.js"], ""],
    // A directory that only has "node_modules" is no project when a package.json is above it.
    ["vendor/src", run, ""],
  ])("started in %j, bun %j", async (start, args, expected) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    expect(await localPrefix(join(root, start), args)).toEqual(printed(join(root, expected)));
  });

  // A script or a bin that bun spawns does not keep the value of an outer run.
  test.concurrent.each([
    ["a script", run],
    ["a bin", ["run", "print-prefix"]],
    ["a bin of bunx", ["x", "--no-install", "print-prefix"]],
  ])("%s does not get an inherited value", async (_, args) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const env = { npm_config_local_prefix: join(root, "tools", "x") };
    expect(await localPrefix(join(root, "sub/deep"), args, env)).toEqual(printed(root));
  });

  // The file runs in the bun process, as it does under `npm run`: the value of that runner stays.
  test.concurrent("a file keeps an inherited value", async () => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const env = { npm_config_local_prefix: "inherited" };
    expect(await localPrefix(join(root, "sub/deep"), ["run", "file.js"], env)).toEqual(printed("inherited"));
  });

  // A value from a file that `--env-file` names is like an inherited value.
  test.concurrent.each([
    ["a script does not get it", "prefix", undefined],
    ["a file keeps it", "file.js", "from-file"],
  ])("--env-file: %s", async (_, target, expected) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    await Bun.write(join(root, "sub/deep/.env.prefix"), "npm_config_local_prefix=from-file\n");
    const args = ["run", "--silent", "--env-file=.env.prefix", target];
    expect(await localPrefix(join(root, "sub/deep"), args)).toEqual(printed(expected ?? root));
  });

  // `bun install` gives its lifecycle scripts BUN_WHICH_IGNORE_CWD, for its node-gyp shim, which runs
  // `bun x node-gyp`. Only that command keeps the value of the install.
  test.concurrent.each([
    ["node-gyp in a lifecycle script keeps the value of the install", "node-gyp", true, "inherited"],
    ["another bin in a lifecycle script gets the project root", "print-prefix", true, undefined],
    ["node-gyp that the user runs gets the project root", "node-gyp", false, undefined],
  ])("bunx: %s", async (_, bin, inLifecycleScript, expected) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const env: Record<string, string> = { npm_config_local_prefix: "inherited" };
    if (inLifecycleScript) env.BUN_WHICH_IGNORE_CWD = join(root, "tools");
    const result = await localPrefix(join(root, "sub/deep"), ["x", "--no-install", bin], env);
    expect(result).toEqual(printed(expected ?? root));
  });

  // `a prefix: <the output of the script>`, then `a prefix: Exited with code 0`
  const byPackage = (stdout: string) =>
    Object.fromEntries(
      stdout
        .split(/\r?\n/)
        .flatMap(line => [line.match(/^(\S+) prefix: (?!Exited with code)(.*)$/)].filter(match => match !== null))
        .map(match => [match[1], match[2]]),
    );

  test.concurrent.each([
    // [start directory, arguments of bun, the packages whose script runs]
    ["packages/b", ["run", "--filter", "a", "prefix"], ["a"]],
    ["packages/b/src", ["run", "--filter", "*", "prefix"], ["a", "b"]],
    ["packages/b", ["run", "--workspaces", "prefix"], ["a", "b"]],
    // bun was started in a package that the root does not list.
    ["tools/x", ["run", "--filter", "a", "prefix"], ["a"]],
  ])("started in %j, bun %j: the workspace root for each package", async (start, args, packages) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const { stdout, exitCode } = await localPrefix(join(root, start), args);
    expect({ byPackage: byPackage(stdout), exitCode }).toEqual({
      byPackage: Object.fromEntries(packages.map(name => [name, root])),
      exitCode: 0,
    });
  });

  test.concurrent("--filter: a script does not get an inherited value", async () => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const env = { npm_config_local_prefix: join(root, "tools", "x") };
    const { stdout, exitCode } = await localPrefix(join(root, "packages/b"), ["run", "--filter", "a", "prefix"], env);
    expect({ byPackage: byPackage(stdout), exitCode }).toEqual({ byPackage: { a: root }, exitCode: 0 });
  });

  // With no "workspaces" above, `--filter` and `--workspaces` take every package.json below the start
  // directory. Their scripts get the project of the start directory.
  test.concurrent.each([
    ["--filter", ["run", "--filter", "x", "prefix"], "x prefix: "],
    ["--workspaces", ["run", "--workspaces", "prefix"], "x prefix: "],
    ["--parallel --filter", ["run", "--parallel", "--filter", "x", "prefix"], "x:prefix | "],
  ])("%s with no workspaces: the project of the start directory", async (_, args, label) => {
    using dir = tempDir("processenv_local_prefix_no_workspaces", {
      "package.json": pkg({ name: "root" }),
      "group/x/package.json": pkg({ name: "x" }),
    });
    const root = realpathSync(String(dir));
    const { stdout, exitCode } = await localPrefix(join(root, "group"), args);
    expect({ lines: stdout.split(/\r?\n/), exitCode }).toEqual({
      lines: expect.arrayContaining([label + root]),
      exitCode: 0,
    });
  });

  test.concurrent.each([
    ["sub/deep", "--parallel"],
    ["sub/deep", "--sequential"],
    ["packages/a/src", "--parallel"],
  ])("started in %j, bun run %s", async (start, flag) => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const { stdout, exitCode } = await localPrefix(join(root, start), ["run", flag, "prefix"]);
    expect({ stdout, exitCode }).toEqual({ stdout: `prefix | ${root}`, exitCode: 0 });
  });

  // The packages that `--filter` and `--workspaces` run are the workspaces of the nearest
  // package.json with "workspaces": that directory is their project root, as when bun starts in one.
  describe("a workspace root that is a workspace of another root", () => {
    function nested() {
      return tempDir("processenv_local_prefix_nested_roots", {
        "package.json": pkg({ name: "outer", workspaces: ["inner"] }),
        "inner/package.json": pkg({ name: "inner", workspaces: ["packages/*"] }),
        "inner/packages/a/package.json": pkg({ name: "a" }),
        "inner/docs/.keep": "",
      });
    }

    test.concurrent.each([
      ["--filter", ["run", "--filter", "a", "prefix"], "a prefix: "],
      ["--workspaces", ["run", "--workspaces", "prefix"], "a prefix: "],
      ["--parallel --filter", ["run", "--parallel", "--filter", "a", "prefix"], "a:prefix | "],
    ])("%s, started below it: its packages get it", async (_, args, label) => {
      using dir = nested();
      const root = realpathSync(String(dir));
      const { stdout, exitCode } = await localPrefix(join(root, "inner/docs"), args);
      expect({ lines: stdout.split(/\r?\n/), exitCode }).toEqual({
        lines: expect.arrayContaining([label + join(root, "inner")]),
        exitCode: 0,
      });
    });

    test.concurrent.each([
      ["its own script gets the outer root", "inner", ""],
      ["a script of its package gets it", "inner/packages/a", "inner"],
    ])("%s", async (_, start, expected) => {
      using dir = nested();
      const root = realpathSync(String(dir));
      expect(await localPrefix(join(root, start), run)).toEqual(printed(join(root, expected)));
    });
  });

  describe("bun pm pack", () => {
    // What prepack gets when `bun pm pack` starts in `start`, with `inherited` in the environment.
    async function prepack(start: string, inherited?: string) {
      const scripts = { prepack: "echo $npm_config_local_prefix" };
      const manifest = (name: string, fields: object = {}) =>
        JSON.stringify({ name, version: "1.0.0", scripts, ...fields });
      using dir = tempDir("processenv_local_prefix_pack", {
        "package.json": manifest("root", { workspaces: ["packages/*", "nested"] }),
        "sub/deep/.keep": "",
        "packages/a/package.json": manifest("a"),
        "packages/a/src/index.js": "",
        // A workspace of the root that has workspaces of its own.
        "nested/package.json": manifest("nested", { workspaces: ["packages/*"] }),
        "nested/packages/b/package.json": manifest("b"),
        "nested/packages/b/src/index.js": "",
      });
      const root = realpathSync(String(dir));
      const env: Record<string, string> =
        inherited === undefined ? {} : { npm_config_local_prefix: join(root, inherited) };
      const { stdout, exitCode } = await localPrefix(join(root, start), ["pm", "pack", "--dry-run"], env);
      return { root, lines: stdout.split(/\r?\n/), exitCode };
    }

    // The package manager goes to the workspace root before it packs, and that directory is the value.
    test.concurrent.each([
      // [start directory, expected, tarball]. As `npm pack` of npm 11.16.0, which does not run in
      // "sub/deep": it wants a package.json in the start directory.
      ["sub/deep", "", "root-1.0.0.tgz"],
      ["packages/a", "", "a-1.0.0.tgz"],
      ["packages/a/src", "", "a-1.0.0.tgz"],
      ["nested", "", "nested-1.0.0.tgz"],
      ["nested/packages/b/src", "nested", "b-1.0.0.tgz"],
    ])("started in %j", async (start, expected, tarball) => {
      const { root, lines, exitCode } = await prepack(start);
      expect(lines).toContain(join(root, expected));
      expect(lines).toContain(tarball);
      expect(exitCode).toBe(0);
    });

    test.concurrent("the script does not get an inherited value", async () => {
      const { root, lines, exitCode } = await prepack("nested/packages/b/src", "packages");
      expect(lines).toContain(join(root, "nested"));
      expect(lines).not.toContain(join(root, "packages"));
      expect(exitCode).toBe(0);
    });
  });

  // `bun publish --dry-run` sends nothing. The registry only has to have a token.
  test.concurrent("bun publish: the scripts get the project root, not an inherited value", async () => {
    const show = (script: string) => `echo ${script}=$npm_config_local_prefix`;
    using dir = tempDir("processenv_local_prefix_publish", {
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        scripts: { prepublishOnly: show("prepublishOnly"), prepack: show("prepack"), postpack: show("postpack") },
      }),
      "bunfig.toml": `[install]\nregistry = { url = "http://localhost:1/", token = "not-a-token" }\n`,
      "sub/deep/.keep": "",
    });
    const root = realpathSync(String(dir));
    const env = { npm_config_local_prefix: join(root, "sub") };
    const { stdout, exitCode } = await localPrefix(join(root, "sub/deep"), ["publish", "--dry-run"], env);
    const scripts = ["prepublishOnly", "prepack", "postpack"];
    const lines = stdout.split(/\r?\n/).filter(line => scripts.some(script => line.startsWith(`${script}=`)));
    expect({ lines, exitCode }).toEqual({ lines: scripts.map(script => `${script}=${root}`), exitCode: 0 });
  });

  // `bun install` links this bin. On Windows that is a `.bunx` shim, and `--bun` runs it in the bun process.
  describe("a bin that bun install linked gets the project root", () => {
    let dir: ReturnType<typeof tempDir>;
    const env = () => ({
      npm_config_local_prefix: "inherited",
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
    });

    beforeAll(async () => {
      dir = tempDir("processenv_local_prefix_bin", {
        "package.json": JSON.stringify({
          name: "consumer",
          version: "0.0.0",
          dependencies: { "print-local-prefix": "file:./print-local-prefix" },
        }),
        "print-local-prefix/package.json": JSON.stringify({
          name: "print-local-prefix",
          version: "0.0.0",
          bin: { "print-local-prefix": "./bin.js" },
        }),
        "print-local-prefix/bin.js": `#!/usr/bin/env node\nconsole.log(process.env.npm_config_local_prefix);\n`,
        "sub/.keep": "",
      });
      expect(await localPrefix(String(dir), ["install"], env())).toMatchObject({ exitCode: 0 });
    });
    afterAll(() => dir[Symbol.dispose]());

    test.each([
      ["bun run <bin>", ["run", "print-local-prefix"]],
      ["bun --bun run <bin>", ["--bun", "run", "print-local-prefix"]],
      ["bunx <bin>", ["x", "--no-install", "print-local-prefix"]],
    ])("%s", async (_, args) => {
      const root = realpathSync(String(dir));
      expect(await localPrefix(join(root, "sub"), args, env())).toEqual(printed(root));
    });
  });

  test.concurrent("is the same for the pre and post scripts", async () => {
    using dir = tempDir("processenv_local_prefix_prepost", {
      "package.json": JSON.stringify({ scripts: { prex: scripts.prefix, x: scripts.prefix, postx: scripts.prefix } }),
      "sub/.keep": "",
    });
    const root = realpathSync(String(dir));
    const { stdout, ...rest } = await localPrefix(join(root, "sub"), ["run", "--silent", "x"]);
    expect({ stdout: stdout.split(/\r?\n/), ...rest }).toEqual({ ...printed(""), stdout: [root, root, root] });
  });

  // Not concurrent: each case starts a second bun.
  test("--parallel: a file next to a script keeps an inherited value", async () => {
    using dir = workspace();
    const root = realpathSync(String(dir));
    const env = { npm_config_local_prefix: "inherited" };
    const { stdout, exitCode } = await localPrefix(
      join(root, "sub/deep"),
      ["run", "--parallel", "prefix", "./file.js"],
      env,
    );
    expect({ stdout: stdout.split(/\r?\n/).sort(), exitCode }).toEqual({
      stdout: ["./file.js | inherited", `prefix    | ${root}`],
      exitCode: 0,
    });
  });

  test("a run inside a script of another project gets its own project", async () => {
    using dir = tempDir("processenv_local_prefix_nested_run", {
      "one/package.json": JSON.stringify({ scripts: { outer: `'${bunExe()}' run --silent --cwd ../two/src prefix` } }),
      "two/package.json": pkg(),
      "two/src/.keep": "",
    });
    const root = realpathSync(String(dir));
    expect(await localPrefix(join(root, "one"), ["run", "--silent", "outer"])).toEqual(printed(join(root, "two")));
  });

  test("a run inside a script of the workspace root, for a member, gets the workspace root", async () => {
    using dir = tempDir("processenv_local_prefix_member_run", {
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        scripts: { member: `cd packages/a && '${bunExe()}' run --silent prefix` },
      }),
      "packages/a/package.json": pkg({ name: "a" }),
    });
    const root = realpathSync(String(dir));
    expect(await localPrefix(root, ["run", "--silent", "member"])).toEqual(printed(root));
  });

  test.concurrent("a package below another package that has no workspaces is its own project", async () => {
    using dir = tempDir("processenv_local_prefix_inner", {
      "package.json": pkg({ name: "outer" }),
      "inner/package.json": pkg({ name: "inner" }),
      "inner/sub/.keep": "",
    });
    const root = realpathSync(String(dir));
    expect(await localPrefix(join(root, "inner/sub"), run)).toEqual(printed(join(root, "inner")));
  });

  test.concurrent.each([
    ["a package.json above that does not list the package is skipped", "b/c", ""],
    ["a package that no package.json above lists is its own project", "b", "b"],
  ])("%s", async (_, start, expected) => {
    using dir = tempDir("processenv_local_prefix_skip", {
      "package.json": pkg({ name: "a", workspaces: ["b/c"] }),
      "b/package.json": pkg({ name: "b", workspaces: ["x"] }),
      "b/c/package.json": pkg({ name: "c" }),
    });
    const root = realpathSync(String(dir));
    expect(await localPrefix(join(root, start), run)).toEqual(printed(join(root, expected)));
  });

  test.concurrent.each([
    // ["workspaces", directory of a package below the root, is the root its workspace root?]
    [["./packages/*"], "packages/a", true],
    [["packages/*/"], "packages/a", true],
    [{ packages: ["packages/*"] }, "packages/a", true],
    [["packages/**"], "packages/group/a", true],
    [["packages/*"], "packages/group/a", false],
    [["packages/*", "!packages/a"], "packages/a", false],
    [["packages/*", "!packages/a", "packages/a"], "packages/a", true],
    [["packages/*"], "packages/.hidden", false],
    [["packages/.hidden"], "packages/.hidden", true],
    [["**"], "packages/a/node_modules/dep", false],
    // A trailing `**` also names the directory it is under.
    [["packages/a/**"], "packages/a", true],
    [["packages/*", "!packages/a/**"], "packages/a", false],
    // A pattern is a path.
    [["packages//a"], "packages/a", true],
    [["packages\\a"], "packages/a", true],
    [["packages/../packages/a"], "packages/a", true],
    [["../packages/*"], "packages/a", false],
    [["./!packages/b"], "packages/a", false],
    // A `!` pattern takes a name that starts with a dot. A wildcard of another pattern does not.
    [[".github/actions/*", "!**/test-*"], ".github/actions/test-foo", false],
    [["packages/**"], "packages/group/.hidden", false],
    [["apps/**/src/.storybook"], "apps/web/src/.storybook", true],
    // An array with an item that is not a string lists nothing: `bun install` stops at it.
    [[{ nested: ["x"] }, ["y"], 1, "packages/*"], "packages/a", false],
  ])("workspaces %j and a package in %j", async (workspaces, member, listed) => {
    using dir = tempDir("processenv_local_prefix_workspaces", {
      "package.json": pkg({ name: "root", workspaces }),
      [`${member}/package.json`]: pkg({ name: "member" }),
      [`${member}/src/.keep`]: "",
    });
    const root = realpathSync(String(dir));
    expect(await localPrefix(join(root, member, "src"), run)).toEqual(printed(listed ? root : join(root, member)));
  });

  // The nearest directory above `dir` that has `name`. The OS temporary directory can be in a project.
  function above(dir: string, name: string): string | undefined {
    for (let parent = dirname(dir); ; parent = dirname(parent)) {
      if (existsSync(join(parent, name))) return parent;
      if (parent === dirname(parent)) return undefined;
    }
  }

  test.concurrent.each([
    ["the start directory when no directory above it is a project", {}, "sub"],
    ["the nearest directory with node_modules when no package.json is above", { "node_modules/.keep": "" }, ""],
  ])("is %s", async (_, files, expected) => {
    using dir = tempDir("processenv_local_prefix_none", { "sub/print.js": printFromJs, ...files });
    const root = realpathSync(String(dir));
    const nodeModules = expected === "sub" ? above(root, "node_modules") : undefined;
    const project = above(root, "package.json") ?? nodeModules ?? join(root, expected);
    expect(await localPrefix(join(root, "sub"), ["run", "print.js"])).toEqual(printed(project));
  });
});
