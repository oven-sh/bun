import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

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
        ? { "node_modules/.bin/show-init-cwd.cmd": "@echo bin=%INIT_CWD%\r\n" }
        : { "node_modules/.bin/show-init-cwd": "#!/bin/sh\necho bin=$INIT_CWD\n" }),
    });
    if (!isWindows) chmodSync(join(String(dir), "node_modules", ".bin", "show-init-cwd"), 0o755);
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

  // `bun install` gives its lifecycle scripts BUN_WHICH_IGNORE_CWD, for its node-gyp shim, which runs `bun x`.
  test("bunx: under a lifecycle script of bun install, a bin keeps the value of the install", async () => {
    using dir = project();
    const env = { INIT_CWD: "inherited", BUN_WHICH_IGNORE_CWD: dir.other };
    expect(await run(["x", "--no-install", "show-init-cwd"], dir.deep, env)).toEqual({
      stdout: ["bin=inherited"],
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
