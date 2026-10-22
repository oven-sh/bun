import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

describe.concurrent("bun run --workspaces", () => {
  test("runs script in all workspace packages", async () => {
    using dir = tempDir("workspaces-test", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        scripts: {
          test: "echo root test",
        },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          test: "echo package a test",
        },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
        scripts: {
          test: "echo package b test",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // Packages run in parallel so output order is not deterministic; compare sorted lines.
    // The root package must not be included when using --workspaces, which the exact line set proves.
    expect(stdout.split("\n").filter(Boolean).sort()).toEqual([
      "a test: Exited with code 0",
      "a test: package a test",
      "b test: Exited with code 0",
      "b test: package b test",
    ]);
    expect(exitCode).toBe(0);
  });

  test("--if-present succeeds when script is missing", async () => {
    using dir = tempDir("workspaces-if-present", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: {
          test: "echo package a test",
        },
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
        // No test script
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "--if-present", "test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("package a test");
    // Should not fail or emit anything for package b
    expect(stdout).not.toContain("b test:");
    expect(exitCode).toBe(0);
  });

  test("fails when no packages have the script", async () => {
    using dir = tempDir("workspaces-no-script", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
      }),
      "packages/b/package.json": JSON.stringify({
        name: "b",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--workspaces", "nonexistent"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr.trim()).toMatch(/^error: Script "nonexistent" not found in \d+ workspace packages$/);
    expect(exitCode).toBe(1);
  });

  test("errors once when there are no workspace packages", async () => {
    using dir = tempDir("ws-none", {
      "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { test: "echo root" } }),
    });
    for (const args of [["--workspaces"], ["--parallel", "--workspaces"]]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", ...args, "test"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("error: No workspace packages found");
      expect(exitCode).toBe(1);
    }
  });
});

// `--workspace` takes what npm's flag takes: a package's name, its folder, or the folder above it.
// Where a row says so, the packages are the ones that `npm run build -w <value>` of npm 11.16.0 runs in.
describe.concurrent("bun run --workspace", () => {
  // Every package prints its own word for `build`. The folder `client` holds `@scope/web`, and the
  // package in `packages/b` has the name `client`. `lint-tool` has no `build` and `bare` has no
  // script. `misc/anon` has no name. The `build` of `second` fails before the one of `first` ran.
  async function run(cwd: string, args: string[], argv0?: string) {
    const pkg = (name: string | undefined, build: string) => JSON.stringify({ name, scripts: { build } });
    using dir = tempDir("run-workspace-flag", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: [
          "client",
          "packages/*",
          "packages/group/*",
          "@org/*",
          "tools/*",
          "misc/*",
          "order/*",
          "dot/.hidden",
        ],
        scripts: { build: "echo ran-root" },
      }),
      "client/package.json": pkg("@scope/web", "echo ran-client"),
      "packages/a/package.json": pkg("pkg-a", "echo ran-a"),
      "packages/b/package.json": pkg("client", "echo ran-b"),
      "packages/group/c/package.json": pkg("pkg-c", "echo ran-c"),
      "@org/d/package.json": pkg("not-org-d", "echo ran-d"),
      "dot/.hidden/package.json": pkg("hidden", "echo ran-hidden"),
      "tools/lint/package.json": JSON.stringify({ name: "lint-tool", scripts: { lint: "echo ran-lint" } }),
      "misc/anon/package.json": pkg(undefined, "echo ran-anon"),
      "misc/bare/package.json": JSON.stringify({ name: "bare" }),
      "order/first/package.json": pkg("first", "echo made > ../made.txt && echo ran-first"),
      "order/second/package.json": pkg("second", "cat ../made.txt && echo ran-second"),
      "file.js": "console.log(JSON.stringify(process.argv.slice(2)));",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args.map(arg => arg.replace("<root>", String(dir)))],
      argv0,
      env: bunEnv,
      cwd: join(String(dir), cwd),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const order = [...stdout.matchAll(/ran-([a-z]+)/g)].map(match => match[1]);
    return { ran: order.toSorted(), order, stdout, stderr, exitCode };
  }

  // As npm.
  test.each([
    [".", ["-w", "client"], ["b", "client"]],
    [".", ["-w=./client"], ["client"]],
    [".", ["--workspace", "client/"], ["client"]],
    [".", ["--workspace=@scope/web"], ["client"]],
    [".", ["-w", "<root>/client"], ["client"]],
    [".", ["-w", "packages"], ["a", "b"]],
    [".", ["-w", "./packages"], ["a", "b"]],
    [".", ["-w", "./packages/"], ["a", "b"]],
    [".", ["-w", "packages/../packages"], ["a", "b"]],
    [".", ["-w", "<root>/packages"], ["a", "b"]],
    [".", ["-w", "packages/group"], ["c"]],
    [".", ["-w", "@org/d"], ["d"]],
    [".", ["-w", "@org"], ["d"]],
    [".", ["-w", "./"], ["client"]],
    [".", ["-w", "dot/.hidden"], ["hidden"]],
    [".", ["-w", "misc/anon"], ["anon"]],
    [".", ["-w", "misc", "--if-present"], ["anon"]],
    [".", ["-w", "pkg-a", "-w", "@org"], ["a", "d"]],
    [".", ["-w", "./client", "--workspaces"], ["client"]],
    [".", ["-w", "pkg-a", "-w", "tools", "--if-present"], ["a"]],
    // A path is read from the working directory, and a name from anywhere.
    ["packages", ["-w", "a"], ["a"]],
    ["packages", ["-w", "group"], ["c"]],
    ["packages", ["-w", "./group"], ["c"]],
    ["packages", ["-w", "group/"], ["c"]],
    ["packages/a", ["-w", "../b"], ["b"]],
    ["packages/a", ["-w", ".."], ["b"]],
    ["packages/a", ["-w", "../"], ["b"]],
    ["packages/a", ["-w", "."], ["a"]],
    ["packages/a", ["-w", "pkg-c"], ["c"]],
    // With `--filter`, a value is one more positive pattern. Only the packages that a value
    // selects must have the script.
    [".", ["-w", "pkg-a", "--filter", "@scope/*"], ["a", "client"]],
    [".", ["-w", "packages", "--filter", "!pkg-a"], ["b"]],
    [".", ["-w", "pkg-a", "--filter", "lint-tool"], ["a"]],
  ])("in %s, %j runs build in %j", async (cwd, flags, expected) => {
    const { ran, stderr, exitCode } = await run(cwd, ["run", ...flags, "build"]);
    expect({ ran, stderr, exitCode }).toEqual({ ran: expected, stderr: "", exitCode: 0 });
  });

  // As npm: one package after another, in the order of the flags, and on after a failure.
  test.each([
    [["-w", "order/first", "-w", "order/second"], ["first", "second"], 0],
    [["-w", "order/second", "-w", "order/first"], ["first"], 1],
    [["-w", "pkg-a", "-w", "@org", "-w", "client"], ["a", "d", "client", "b"], 0],
    [["-w", "packages"], ["a", "b"], 0],
    [["--sequential", "-w", "pkg-c", "-w", "pkg-a"], ["c", "a"], 0],
  ])("%j runs build in the order %j", async (flags, expected, code) => {
    const { order, exitCode } = await run(".", ["run", ...flags, "build"]);
    expect({ order, exitCode }).toEqual({ order: expected, exitCode: code });
  });

  test("--parallel runs build in the packages of a folder", async () => {
    const { ran, exitCode } = await run(".", ["run", "--parallel", "-w", "packages", "build"]);
    expect({ ran, exitCode }).toEqual({ ran: ["a", "b"], exitCode: 0 });
  });

  test("a value that selects nothing is reported when another one selects", async () => {
    const { ran, stderr, exitCode } = await run(".", ["run", "-w", "pkg-a", "-w", "no-such-workspace", "build"]);
    expect({ ran, stderr, exitCode }).toEqual({
      ran: ["a"],
      stderr: 'warn: No workspace packages matched --workspace "no-such-workspace"\n',
      exitCode: 0,
    });
  });

  // As npm, apart from `anon`: the folder `a` is not in the root, `*` does not match the dot
  // folder in `dot`, and `--if-present` is about the script. A package without a name is selected
  // by its path only.
  test.each([
    [".", ["-w", "no-such-workspace"], '--workspace "no-such-workspace"'],
    [".", ["-w", "no-such-workspace", "--if-present"], '--workspace "no-such-workspace"'],
    [".", ["-w", "a"], '--workspace "a"'],
    [".", ["-w", "dot"], '--workspace "dot"'],
    [".", ["-w", "anon"], '--workspace "anon"'],
    ["packages/a", ["-w", "packages/group"], '--workspace "packages/group"'],
    [".", ["--filter", "no-such-name", "-w", "lint"], '--workspace "lint" or --filter "no-such-name"'],
    [".", ["-w", "no-such-workspace", "--filter", "!pkg-a"], '--workspace "no-such-workspace" or --filter "!pkg-a"'],
    [".", ["-w", "pkg-a", "--filter", "!pkg-a"], '--workspace "pkg-a" or --filter "!pkg-a"'],
  ])("in %s, %j selects nothing", async (cwd, flags, given) => {
    const { stdout, stderr, exitCode } = await run(cwd, ["run", ...flags, "build"]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: No workspace packages matched ${given}\n`,
      exitCode: 1,
    });
  });

  // A Windows command line is too short for a path longer than the path buffer.
  test.skipIf(isWindows)("a path longer than the path buffer selects nothing", async () => {
    const long = "./" + Array(21).fill(Buffer.alloc(200, "a").toString()).join("/");
    const { stdout, stderr, exitCode } = await run(".", ["run", "-w", long, "build"]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `error: No workspace packages matched --workspace "${long}"\n`,
      exitCode: 1,
    });
  });

  // npm fails too, after it ran the other packages. Here no script starts.
  test.each([
    [["-w", "pkg-a", "-w", "lint-tool"], "lint-tool"],
    [["-w", "tools"], "lint-tool"],
    [["-w", "pkg-a", "-w", "bare"], "bare"],
    [["--filter", "pkg-a", "-w", "lint-tool"], "lint-tool"],
    [["--parallel", "-w", "pkg-a", "-w", "tools"], "lint-tool"],
  ])("%j fails for the package without the script", async (flags, name) => {
    const { ran, stderr, exitCode } = await run(".", ["run", ...flags, "build"]);
    expect({ ran, stderr, exitCode }).toEqual({
      ran: [],
      stderr: `error: Script "build" not found in package "${name}"\n`,
      exitCode: 1,
    });
  });

  // npm reads `-ws` as `--workspaces`, so `-w` takes no value that is glued to it. Bare `bun` has no `-w`.
  test.each([
    [["run", "-ws", "build"], "-ws"],
    [["run", "-wclient", "build"], "-wclient"],
    [["run", "-ws", "--help"], "-ws"],
    [["-w", "client", "build"], "-w"],
  ])("bun %j is not a workspace flag", async (args, word) => {
    const { ran, stderr, exitCode } = await run(".", args);
    expect({ ran, stderr, exitCode }).toEqual({ ran: [], stderr: `error: Invalid Argument '${word}'\n`, exitCode: 1 });
  });

  test("behind the name of the script, the flag is an argument of the script", async () => {
    const { stdout, exitCode } = await run(".", ["run", "build", "-w", "client"]);
    expect({ stdout, exitCode }).toEqual({ stdout: "ran-root -w client\n", exitCode: 0 });
  });

  // `node` has no such flag. The table of `bun run` also parses the arguments of bun as `node`.
  test.each([
    [["-w", "x", "file.js"], { stdout: "Usage: ", stderr: "error: Invalid Argument '-w'\n", exitCode: 1 }],
    [["-w=x", "file.js"], { stdout: "Usage: ", stderr: "error: Invalid Argument '-w'\n", exitCode: 1 }],
    [["--workspace=x", "file.js"], { stdout: "[]\n", stderr: "", exitCode: 0 }],
    [["file.js", "-w", "x"], { stdout: '["-w","x"]\n', stderr: "", exitCode: 0 }],
  ])("as node, %j is read as before", async (args, expected) => {
    const { stdout, stderr, exitCode } = await run(".", args, "node");
    // The usage on stdout is long.
    expect({ stdout: stdout.slice(0, expected.stdout.length), stderr, exitCode }).toEqual(expected);
  });

  test("bun run --help lists the flag", async () => {
    const { stdout, exitCode } = await run(".", ["run", "--help"]);
    expect(stdout).toContain("-w, --workspace=<val>");
    expect(exitCode).toBe(0);
  });

  test("a root that `workspaces` lists is selected by its path", async () => {
    using dir = tempDir("run-workspace-listed-root", {
      "package.json": JSON.stringify({ name: "root", workspaces: [".", "a"], scripts: { build: "echo ran-root" } }),
      "a/package.json": JSON.stringify({ name: "a", scripts: { build: "echo ran-a" } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "-w", ".", "build"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "root build: ran-root\nroot build: Exited with code 0\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
