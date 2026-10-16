import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { basename, join } from "path";
import { TestRegistry } from "registry";

// Auto-install needs a directory to extract packages into. When no install
// cache directory can be used, that is `.bun-cache` in the working directory.
// It was `node_modules/.bun-cache` or `node_modules/.cache`: a `node_modules`
// directory turns auto-install off, so the first run loaded the package and
// every later run failed with "Cannot find package".
//
// The cases are not concurrent: each one runs bun two times, and on a debug
// build many of them at once pass the default timeout.
describe("auto-install without a usable cache directory", () => {
  type Cause = { bunfig: string; env: (root: string) => Record<string, string>; laterRequests: string[] };
  // The ways to have no usable cache directory. `root` holds a regular file
  // "file" and an empty directory "home".
  const causes: Record<string, Cause> = {
    "nothing names a cache directory": { bunfig: "", env: () => ({}), laterRequests: [] },
    "the home directory cannot be made": {
      bunfig: "",
      env: root => ({ HOME: join(root, "file", "home"), USERPROFILE: join(root, "file", "home") }),
      laterRequests: [],
    },
    "BUN_INSTALL_CACHE_DIR names a file": {
      bunfig: "",
      env: root => ({
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        BUN_INSTALL_CACHE_DIR: join(root, "file"),
      }),
      laterRequests: [],
    },
    // Without a cache, each run asks the registry which version is the latest.
    "bunfig turns the cache off": {
      bunfig: "cache = false\n",
      env: root => ({ HOME: join(root, "home"), USERPROFILE: join(root, "home") }),
      laterRequests: ["/no-deps"],
    },
  };

  type EntryPoint = { files: Record<string, string | Record<string, string>>; args: string[]; stdout: string };
  const index = (source: string): EntryPoint => ({
    files: { "index.js": source },
    args: ["index.js"],
    stdout: "2.0.0\n",
  });
  const entryPoints: Record<string, EntryPoint> = {
    "import": index(`import pkg from "no-deps";\nconsole.log(pkg.version);`),
    "require()": index(`console.log(require("no-deps").version);`),
    "require.resolve()": index(`console.log(require(require.resolve("no-deps")).version);`),
    "import.meta.resolve()": index(`console.log((await import(import.meta.resolve("no-deps"))).default.version);`),
    "Bun.resolveSync()": index(`console.log(require(Bun.resolveSync("no-deps", import.meta.dir)).version);`),
    "--preload": {
      files: { "index.js": `console.log(Object.keys(require.cache).some(path => path.includes("no-deps@2.0.0")));` },
      args: ["--preload", "no-deps", "index.js"],
      stdout: "true\n",
    },
    "a script below the working directory": {
      files: { sub: { "index.js": `import pkg from "no-deps";\nconsole.log(pkg.version);` } },
      args: [join("sub", "index.js")],
      stdout: "2.0.0\n",
    },
  };

  function project(registry: TestRegistry, cause: Cause, files: EntryPoint["files"]) {
    const root = tempDir("autoinstall-no-cache-dir", {
      file: "",
      home: {},
      project: { "bunfig.toml": `[install]\nregistry = "${registry.url}"\n${cause.bunfig}`, ...files },
    });
    const env: Record<string, string | undefined> = { ...bunEnv, ...cause.env(String(root)) };
    for (const name of ["HOME", "USERPROFILE", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR", "XDG_CACHE_HOME"]) {
      if (!(name in cause.env(String(root)))) delete env[name];
    }
    return { cwd: join(String(root), "project"), env, [Symbol.dispose]: () => root[Symbol.dispose]() };
  }

  // One process. `requests` is what it asked the registry for.
  async function run(registry: TestRegistry, cwd: string, env: Record<string, string | undefined>, args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, requests: registry.requests.splice(0).map(request => request.path) };
  }

  // Every cause with one entry point, and every entry point with one cause.
  const cells = [
    ...Object.keys(causes).map(cause => [cause, "import"]),
    ...Object.keys(entryPoints)
      .filter(entryPoint => entryPoint !== "import")
      .map(entryPoint => ["the home directory cannot be made", entryPoint]),
  ];

  for (const [causeName, entryPointName] of cells) {
    // On Windows, a process that is started without USERPROFILE gets the one of its parent.
    const unreachable = isWindows && causeName === "nothing names a cache directory";

    test.skipIf(unreachable)(`${causeName}: ${entryPointName} loads the package in the next run too`, async () => {
      const cause = causes[causeName];
      const entryPoint = entryPoints[entryPointName];
      using registry = new TestRegistry({ recordRequests: true }).start();
      using dir = project(registry, cause, entryPoint.files);

      const runs = [
        await run(registry, dir.cwd, dir.env, entryPoint.args),
        await run(registry, dir.cwd, dir.env, entryPoint.args),
      ];

      const loaded = { stdout: entryPoint.stdout, stderr: "", exitCode: 0 };
      expect({ runs, cwd: readdirSync(dir.cwd).sort() }).toEqual({
        runs: [
          { ...loaded, requests: ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"] },
          { ...loaded, requests: cause.laterRequests },
        ],
        cwd: [".bun-cache", "bunfig.toml", ...Object.keys(entryPoint.files)],
      });
    });
  }

  // A failed resolve makes the resolver read the directory again. It then saw
  // the `node_modules` directory that the first import had made.
  test("a later import in the same process still installs", async () => {
    using registry = new TestRegistry({ recordRequests: true }).start();
    using dir = project(registry, causes["the home directory cannot be made"], {
      "index.js": `
        console.log((await import("no-deps")).default.version);
        try {
          require("./missing");
        } catch (error) {
          console.log(error.code);
        }
        console.log(require("no-deps").version);
        console.log(require("7-no-deps"));
      `,
    });

    expect({ ...(await run(registry, dir.cwd, dir.env, ["index.js"])), cwd: readdirSync(dir.cwd).sort() }).toEqual({
      stdout: "2.0.0\nMODULE_NOT_FOUND\n2.0.0\n7-no-deps\n",
      stderr: "",
      exitCode: 0,
      requests: ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz", "/7-no-deps", "/7-no-deps/-/7-no-deps-1.0.0.tgz"],
      cwd: [".bun-cache", "bunfig.toml", "index.js"],
    });
  });

  test("a run with -i does not turn auto-install off for the next run", async () => {
    using registry = new TestRegistry({ recordRequests: true }).start();
    using dir = project(registry, causes["the home directory cannot be made"], entryPoints["import"].files);

    const runs = [
      await run(registry, dir.cwd, dir.env, ["-i", "index.js"]),
      await run(registry, dir.cwd, dir.env, ["index.js"]),
    ];

    const loaded = { stdout: "2.0.0\n", stderr: "", exitCode: 0 };
    expect({ runs, cwd: readdirSync(dir.cwd).sort() }).toEqual({
      runs: [
        { ...loaded, requests: ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"] },
        { ...loaded, requests: [] },
      ],
      cwd: [".bun-cache", "bunfig.toml", "index.js"],
    });
  });

  test("a package that the registry does not have leaves no node_modules", async () => {
    using registry = new TestRegistry({ recordRequests: true }).start();
    using dir = project(registry, causes["the home directory cannot be made"], {
      "index.js": `import "not-in-the-registry";`,
    });

    const { stderr, exitCode, requests } = await run(registry, dir.cwd, dir.env, ["index.js"]);

    expect({ stderr, exitCode, requests, cwd: readdirSync(dir.cwd).sort() }).toEqual({
      stderr: expect.stringContaining("Cannot find package 'not-in-the-registry'"),
      exitCode: 1,
      requests: ["/not-in-the-registry"],
      cwd: [".bun-cache", "bunfig.toml", "index.js"],
    });
  });
});

// That cache was in `node_modules`, which the commands that walk a project skip.
describe("commands that walk a project skip .bun-cache", () => {
  const cache = {
    ".bun-cache": {
      "no-deps@2.0.0@@localhost@@@1": {
        "package.json": JSON.stringify({ name: "no-deps", version: "2.0.0", scripts: { hello: "echo from-cache" } }),
        "index.js": "var   x = 1 ;debugger;\nmodule.exports=x",
        // oxlint looks for these in the directories that it ignores.
        ".oxlintrc.json": "{}",
      },
    },
  };

  async function bun(cwd: string, args: string[], env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("bun fmt", async () => {
    using dir = tempDir("bun-cache-fmt", { "a.js": "if (a) {\nb( 1 )\n}\n", ...cache });

    const { stdout, exitCode } = await bun(String(dir), ["fmt"]);

    // The files that it wrote.
    expect({ stdout, exitCode }).toEqual({ stdout: "a.js\n", exitCode: 0 });
  });

  test.each([
    ["no configuration file", {}],
    [".oxlintrc.json", { ".oxlintrc.json": "{}" }],
  ])("bun lint with %s", async (_, configuration) => {
    using dir = tempDir("bun-cache-lint", { "a.js": "debugger;\n", ...configuration, ...cache });

    const { stdout, exitCode } = await bun(String(dir), ["lint", "--list-files"]);

    const files = stdout
      .trim()
      .split("\n")
      .map(file => basename(file));
    expect({ files, exitCode }).toEqual({ files: ["a.js"], exitCode: 0 });
  });

  test("bun run --filter", async () => {
    using dir = tempDir("bun-cache-filter", {
      "package.json": JSON.stringify({ name: "root" }),
      pkg: { "package.json": JSON.stringify({ name: "pkg", scripts: { hello: "echo from-pkg" } }) },
      ...cache,
    });

    const { stdout, exitCode } = await bun(String(dir), ["run", "--filter", "*", "hello"]);

    expect({ stdout, exitCode }).toEqual({
      stdout: "pkg hello: from-pkg\npkg hello: Exited with code 0\n",
      exitCode: 0,
    });
  });

  test.each([
    ["without `files`", undefined],
    ["with `files` that names it", ["lib", ".bun-cache"]],
  ])("bun pm pack %s", async (_, files) => {
    using dir = tempDir("bun-cache-pack", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", files }),
      lib: { "index.js": "" },
      ...cache,
    });

    const { stdout, exitCode } = await bun(String(dir), ["pm", "pack", "--dry-run"]);

    const packed = stdout.split("\n").filter(line => line.startsWith("packed "));
    expect({ packed: packed.map(line => line.split(" ").at(-1)), exitCode }).toEqual({
      packed: ["package.json", "lib/index.js"],
      exitCode: 0,
    });
  });

  test("bun pm diff of a directory", async () => {
    using dir = tempDir("bun-cache-pm-diff", {
      a: { "index.js": "module.exports = 1;\n" },
      b: { "index.js": "module.exports = 2;\n", ...cache },
    });

    const { stdout, exitCode } = await bun(String(dir), ["pm", "diff", "./a", "./b", "--name-only"]);

    const changed = stdout.split("\n").filter(line => /^[AMD] /.test(line));
    expect({ changed, exitCode }).toEqual({ changed: ["M index.js"], exitCode: 0 });
  });

  test("bun create from a local template", async () => {
    using dir = tempDir("bun-cache-create", { templates: { app: { "index.js": "// hi\n", ...cache } } });

    const env = { ...bunEnv, BUN_CREATE_DIR: join(String(dir), "templates") };
    const { exitCode } = await bun(String(dir), ["create", "app", "dest", "--no-install", "--no-git"], env);

    expect({ created: readdirSync(join(String(dir), "dest")).sort(), exitCode }).toEqual({
      created: ["index.js"],
      exitCode: 0,
    });
  });
});
