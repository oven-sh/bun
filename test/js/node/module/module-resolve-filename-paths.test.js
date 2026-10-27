// Use bun:test in Bun, or node:test in Node.js
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

// Detect runtime and import appropriate test framework
const isBun = typeof Bun !== "undefined";
let test, expect;
let childEnv = process.env;
let childExe = process.execPath;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
  const harness = await import("harness");
  childEnv = harness.bunEnv;
  childExe = harness.bunExe();
} else {
  // Node.js
  const { createRequire } = await import("module");
  const nodeTest = await import("node:test");
  const assert = await import("node:assert/strict");

  // In Node.js ES modules, require is not available, so create it
  globalThis.require = createRequire(import.meta.url);

  test = nodeTest.test;
  // Create Bun-compatible expect from Node assert
  expect = value => ({
    toBe: expected => assert.strictEqual(value, expected),
    toEqual: expected => assert.deepStrictEqual(value, expected),
    toBeDefined: () => assert.notStrictEqual(value, undefined),
    toThrow: () => {
      // This is used with expect(() => ...)
      assert.throws(value);
    },
  });
}

// Helper to create temp directory - works in both Bun and Node
function createTempDir(prefix, files) {
  // Use realpathSync to resolve symlinks (handles /tmp -> /private/tmp on macOS)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix + "-")));

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    const dirPath = dirname(fullPath);

    // Create parent directories if needed
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  return {
    path: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("Module._resolveFilename respects options.paths for package resolution", () => {
  const { path: dir, cleanup } = createTempDir("module-resolve-paths", {
    "node_modules/test-package/package.json": JSON.stringify({ name: "test-package", main: "index.js" }),
    "node_modules/test-package/index.js": "module.exports = 'test-package';",
  });

  try {
    // Create a fake parent module in a different directory
    const fakeParent = new Module("/some/other/directory/file.js");
    fakeParent.filename = "/some/other/directory/file.js";
    fakeParent.paths = Module._nodeModulePaths("/some/other/directory");

    // Without paths option, this should fail
    expect(() => {
      Module._resolveFilename("test-package", fakeParent);
    }).toThrow();

    // With paths option, this should succeed
    const resolved = Module._resolveFilename("test-package", fakeParent, false, {
      paths: [dir],
    });

    expect(resolved).toBe(resolve(dir, "node_modules/test-package/index.js"));
  } finally {
    cleanup();
  }
});

test("Module._resolveFilename respects options.paths for relative paths", () => {
  const { path: dir, cleanup } = createTempDir("module-resolve-relative", {
    "target.js": "module.exports = 'target';",
  });

  try {
    const fakeParent = new Module("/some/other/directory/file.js");
    fakeParent.filename = "/some/other/directory/file.js";
    fakeParent.paths = Module._nodeModulePaths("/some/other/directory");

    // With paths option pointing to dir, should resolve relative to that dir
    const resolved = Module._resolveFilename("./target.js", fakeParent, false, {
      paths: [dir],
    });

    expect(resolved).toBe(resolve(dir, "target.js"));
  } finally {
    cleanup();
  }
});

test("Module._resolveFilename with overridden function receives options.paths", () => {
  const originalResolveFilename = Module._resolveFilename;
  let capturedOptions;

  try {
    // Override _resolveFilename to capture the options
    Module._resolveFilename = function (request, parent, isMain, options) {
      capturedOptions = options;
      return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    const { path: dir, cleanup } = createTempDir("module-resolve-override", {
      "node_modules/test-pkg/package.json": JSON.stringify({ name: "test-pkg", main: "index.js" }),
      "node_modules/test-pkg/index.js": "module.exports = 'test';",
    });

    try {
      const fakeParent = new Module("/some/other/directory/file.js");
      fakeParent.filename = "/some/other/directory/file.js";
      fakeParent.paths = Module._nodeModulePaths("/some/other/directory");

      const testPaths = [dir];

      // Call _resolveFilename with paths option
      Module._resolveFilename("test-pkg", fakeParent, false, {
        paths: testPaths,
      });

      // Verify the override function received the options with paths
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.paths).toEqual(testPaths);
    } finally {
      cleanup();
    }
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
});

test("require.resolve respects options.paths for package resolution", () => {
  const { path: dir, cleanup } = createTempDir("require-resolve-paths", {
    "node_modules/resolve-test-pkg/package.json": JSON.stringify({
      name: "resolve-test-pkg",
      main: "index.js",
    }),
    "node_modules/resolve-test-pkg/index.js": "module.exports = 'resolve-test';",
  });

  try {
    // require.resolve should work with paths option
    const resolved = require.resolve("resolve-test-pkg", {
      paths: [dir],
    });

    expect(resolved).toBe(resolve(dir, "node_modules/resolve-test-pkg/index.js"));
  } finally {
    cleanup();
  }
});

test("require.resolve with relative path and options.paths (Next.js use case)", () => {
  // This reproduces the Next.js babel-plugin-react-compiler resolution issue
  const { path: dir, cleanup } = createTempDir("nextjs-style-resolve", {
    "node_modules/babel-plugin-react-compiler/package.json": JSON.stringify({
      name: "babel-plugin-react-compiler",
      main: "dist/index.js",
    }),
    "node_modules/babel-plugin-react-compiler/dist/index.js": "module.exports = {};",
  });

  try {
    // Simulate what Next.js does: resolve a relative path with explicit paths
    const resolved = require.resolve("./node_modules/babel-plugin-react-compiler", {
      paths: [dir],
    });

    expect(resolved).toBe(resolve(dir, "node_modules/babel-plugin-react-compiler/dist/index.js"));
  } finally {
    cleanup();
  }
});

test("Module._resolveFilename throws ERR_INVALID_ARG_TYPE if options.paths is not an array", () => {
  // Test with string (which is iterable but not an array)
  expect(() => {
    Module._resolveFilename("path", __filename, false, { paths: "/some/path" });
  }).toThrow();

  // Test with Set (which is iterable but not an array)
  expect(() => {
    Module._resolveFilename("path", __filename, false, { paths: new Set(["/some/path"]) });
  }).toThrow();

  // Test with object (not iterable)
  expect(() => {
    Module._resolveFilename("path", __filename, false, { paths: { 0: "/some/path" } });
  }).toThrow();
});

// Node reads an `options.paths` entry of a bare request only as a directory where the search of
// node_modules directories starts. The "imports" and the name of a package are the calling file's.
// In Bun, so are the tsconfig.json and the decision to install a package.
const exportsFilename = "module.exports = __filename;";
const resolversSource = `
const Module = require("node:module");
module.exports = {
  "require.resolve": (request, paths) => require.resolve(request, { paths }),
  "Module._resolveFilename": (request, paths) => Module._resolveFilename(request, module, false, { paths }),
  "createRequire().resolve": (request, paths) => Module.createRequire(__filename).resolve(request, { paths }),
};
if (typeof Bun !== "undefined") {
  // Bun also reads \`paths\` from the second argument of require().
  module.exports["require"] = (request, paths) => require(request, { paths });
  module.exports["createRequire()"] = (request, paths) => Module.createRequire(__filename)(request, { paths });
}
`;
// A parent module that has no file name has no package and no tsconfig.json.
const resolversWithoutFileSource = `
const Module = require("node:module");
module.exports = {
  "Module._resolveFilename, parent {}": (request, paths) => Module._resolveFilename(request, {}, false, { paths }),
  "Module._resolveFilename, parent { filename: '' }": (request, paths) =>
    Module._resolveFilename(request, { filename: "" }, false, { paths }),
  "Module._resolveFilename, parent { id: 'name' }": (request, paths) =>
    Module._resolveFilename(request, { id: "name" }, false, { paths }),
};
`;
const scopeProbeSource = `
const path = require("node:path");
const root = process.cwd();
const rows = JSON.parse(require("node:fs").readFileSync("rows.json", "utf8"));
const results = rows.map(([from, request, paths, cwd]) => {
  const resolvers = require(path.join(root, from, "resolvers.cjs"));
  // "." stays as written. Every other entry is made absolute.
  const entries = paths.map(entry => (entry === "." ? entry : path.join(root, entry)));
  const result = {};
  if (cwd) process.chdir(path.join(root, cwd));
  for (const name in resolvers) {
    try {
      result[name] = path.relative(root, resolvers[name](request, entries)).split(path.sep).join("/");
    } catch (error) {
      result[name] = error.code;
    }
  }
  process.chdir(root);
  return result;
});
console.log(JSON.stringify(results));
`;

test("options.paths: an absolute entry starts the search, and the package scope is the calling file's", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-scope", {
    "probe.cjs": scopeProbeSource,
    // A node_modules directory at the root also keeps Bun's auto-install off.
    "node_modules/.keep": "",
    "outside/resolvers.cjs": resolversSource,
    "nofile/resolvers.cjs": resolversWithoutFileSource,
    "scope/resolvers.cjs": resolversSource,
    "scope/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["./lib/*"] } } }),
    "scope/lib/thing.js": exportsFilename,
    "scope/base.js": exportsFilename,
    "scope/package.json": JSON.stringify({
      name: "scoped",
      imports: { "#imp": "./imp.js", "#dep": "dep" },
      exports: "./main.js",
    }),
    "scope/imp.js": exportsFilename,
    "scope/main.js": exportsFilename,
    "other/file.js": exportsFilename,
    "other/node_modules/dep/index.js": exportsFilename,
    "other/node_modules/scoped/index.js": exportsFilename,
    "other/node_modules/both/index.js": exportsFilename,
    "global/both/index.js": exportsFilename,
    "a/node_modules/exp/package.json": JSON.stringify({ name: "exp", exports: { "./a": "./a.js" } }),
    "a/node_modules/exp/a.js": exportsFilename,
    "a/node_modules/exp/b.js": exportsFilename,
    "b/node_modules/exp/package.json": JSON.stringify({ name: "exp", exports: { "./b": "./b.js" } }),
    "b/node_modules/exp/b.js": exportsFilename,
  });

  const missing = "MODULE_NOT_FOUND";
  const dep = "other/node_modules/dep/index.js";
  const otherScoped = "other/node_modules/scoped/index.js";
  // [directory of the calling file, request, paths, expected, directory to chdir() into first]
  const rows = [
    // The entry has a tsconfig.json and a package.json. They are not the calling file's.
    ["outside", "@alias/thing", ["scope"], missing],
    ["outside", "base", ["scope"], missing],
    ["outside", "#imp", ["scope"], missing],
    ["outside", "scoped", ["scope"], missing],
    ["outside", "scoped", ["scope", "other"], otherScoped],
    ["outside", "dep", ["scope", "other"], dep],
    // The calling file is in a package. Its "imports" and its name apply, whatever the entries are.
    ["scope", "#imp", ["other"], "scope/imp.js"],
    ["scope", "#imp", ["."], "scope/imp.js"],
    ["scope", "#imp", [], "scope/imp.js"],
    ["scope", "scoped", ["other"], "scope/main.js"],
    ["scope", "scoped", [], "scope/main.js"],
    // The package that an "imports" target names is searched from the calling package, not from the entry.
    ["scope", "#dep", ["other"], missing],
    ["scope", "dep", ["other"], dep],
    ["scope", "dep", [], missing],
    // Node has no tsconfig.json. Bun reads the one of the calling file.
    ["scope", "@alias/thing", ["other"], isBun ? "scope/lib/thing.js" : missing],
    ["scope", "base", ["other"], isBun ? "scope/base.js" : missing],
    // A parent module without a file name has no scope. The working directory does not stand in for it.
    // Node keeps a result per list of paths, so these rows have a list of their own.
    ["nofile", "scoped", ["other", "a"], otherScoped, "scope"],
    ["nofile", "#imp", ["other", "a"], missing, "scope"],
    ["nofile", "@alias/thing", ["other", "a"], missing, "scope"],
    ["nofile", "dep", ["other", "a"], dep, "scope"],
    // The first package that has "exports" decides, also when a later entry has another copy.
    ["outside", "exp/b", ["a", "b"], isBun ? missing : "ERR_PACKAGE_PATH_NOT_EXPORTED"],
    ["outside", "exp/b", ["b", "a"], "b/node_modules/exp/b.js"],
    // NODE_PATH is searched after the first entry and before the second one.
    ["outside", "both", ["outside", "other"], "global/both/index.js"],
    ["outside", "both", ["other", "outside"], "other/node_modules/both/index.js"],
    // A relative request is joined to the entry.
    ["outside", "./file.js", ["other"], "other/file.js"],
  ];

  try {
    writeFileSync(
      join(dir, "rows.json"),
      JSON.stringify(rows.map(([from, request, paths, , cwd]) => [from, request, paths, cwd])),
    );
    const { stdout, stderr, status } = spawnSync(childExe, isBun ? ["--no-install", "probe.cjs"] : ["probe.cjs"], {
      cwd: dir,
      env: { ...childEnv, NODE_PATH: join(dir, "global") },
      encoding: "utf8",
    });
    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      results = null;
    }
    // One line per row and entry point, so that a failure names the row.
    const lines = valueOf =>
      rows.flatMap(([from, request, paths, , cwd], i) =>
        Object.keys(results[i]).map(
          name =>
            `${from}: ${name}(${JSON.stringify(request)}, { paths: ${JSON.stringify(paths)} })` +
            `${cwd ? ` in ${cwd}` : ""} => ${valueOf(i, name)}`,
        ),
      );
    expect(results === null ? { stdout, stderr } : lines((i, name) => results[i][name])).toEqual(
      results === null ? null : lines(i => rows[i][3]),
    );
    expect(status).toBe(0);
  } finally {
    cleanup();
  }
});

if (isBun) {
  const { TestRegistry } = await import("registry");

  const missing = request => `Cannot find module '${request}'`;
  const refusal = request =>
    `Cannot find package "${request}": auto-install is off because a security scanner is configured. Run "bun install"`;
  const scanner = `[install.security]\nscanner = "./scanner.ts"\n`;

  // Runs `source` as `index.cjs` in the directory `cwd` of a new tree. Nothing above the tree has a
  // node_modules directory. The registry has the package `no-deps` and records each request.
  // `resolve(request, paths)` makes the entries absolute. It returns the result relative to the
  // tree, or the first line of the error message.
  async function runWithRegistry({ files, cwd, args = [], source }) {
    const registry = new TestRegistry({ recordRequests: true }).start();
    try {
      const { path: dir, cleanup } = createTempDir("resolve-paths-install", {
        "home/.keep": "",
        ...files,
        [`${cwd}/index.cjs`]: `
          const path = require("node:path");
          const Module = require("node:module");
          const relative = run => {
            try {
              const file = path.relative(process.env.TREE, run()).split(path.sep).join("/");
              return file.replace(/^cache\\/(no-deps@[\\d.]+)@@[^/]+/, "cache/$1");
            } catch (error) {
              return error.message.split("\\n")[0];
            }
          };
          const resolve = (request, paths) =>
            relative(() => require.resolve(request, { paths: paths.map(entry => path.resolve(entry)) }));
          ${source}
        `,
      });
      try {
        const home = join(dir, "home");
        const proc = Bun.spawn({
          cmd: [childExe, ...args, "index.cjs"],
          cwd: join(dir, cwd),
          env: {
            ...childEnv,
            BUN_CONFIG_REGISTRY: registry.url,
            BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
            HOME: home,
            USERPROFILE: home,
            XDG_CONFIG_HOME: home,
            TREE: dir,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode, requests: registry.requests.map(request => request.path) };
      } finally {
        cleanup();
      }
    } finally {
      registry.stop();
    }
  }

  const installed = version => ["/no-deps", `/no-deps/-/no-deps-${version}.tgz`];
  // The first entry misses. The second entry has the package. No entry has `no-deps-2`.
  const searchBothEntries = `
    console.log(resolve("no-deps", ["nowhere", "plugins"]));
    console.log(resolve("no-deps-2", ["nowhere", "plugins"]));
  `;
  const inPlugins = "project/plugins/node_modules/no-deps/index.js";

  test.each([
    // Auto-install is on: nothing above the calling file has a node_modules directory.
    [[], `${inPlugins}\n${missing("no-deps-2")}\n`, ["/no-deps-2"]],
    [["-i"], `${inPlugins}\n${missing("no-deps-2")}\n`, ["/no-deps-2"]],
    [["--no-install"], `${inPlugins}\n${missing("no-deps-2")}\n`, []],
    // This mode reads no node_modules directory, so the registry's copy is the answer.
    [
      ["--install=force"],
      `cache/no-deps@2.0.0/index.js\n${missing("no-deps-2")}\n`,
      [...installed("2.0.0"), "/no-deps-2"],
    ],
  ])(
    "options.paths: every entry is searched before a package is installed, with %j",
    async (args, stdout, requests) => {
      const result = await runWithRegistry({
        files: { "project/plugins/node_modules/no-deps/index.js": "" },
        cwd: "project",
        args,
        source: searchBothEntries,
      });
      expect(result).toEqual({ stdout, stderr: "", exitCode: 0, requests });
    },
  );

  test("options.paths: a refusal to install comes after every entry was searched", async () => {
    // The project of the calling file has a security scanner, so auto-install is off for it.
    const result = await runWithRegistry({
      files: {
        "root/bunfig.toml": scanner,
        "root/package.json": JSON.stringify({ name: "root" }),
        "root/app/conf/file.js": "",
        "tool/node_modules/no-deps/index.js": "",
      },
      cwd: "root/app",
      source: `
        console.log(resolve("no-deps", ["conf", "../../tool"]));
        console.log(resolve("no-deps-3", ["conf", "../../tool"]));
      `,
    });
    expect(result).toEqual({
      stdout: `tool/node_modules/no-deps/index.js\n${refusal("no-deps-3")}\n`,
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test("options.paths: the project that installs is the calling file's, not the entry's", async () => {
    // The entry is in a nested project. A package manager made for it would not see the scanner,
    // and it would stay for the rest of the process.
    const result = await runWithRegistry({
      files: {
        "root/bunfig.toml": scanner,
        "root/package.json": JSON.stringify({ name: "root" }),
        "root/app/sub/package.json": JSON.stringify({ name: "nested" }),
      },
      cwd: "root/app",
      source: `
        console.log(resolve("no-deps-3", ["sub"]));
        console.log(relative(() => require.resolve("no-deps")));
      `,
    });
    expect(result).toEqual({
      stdout: `${refusal("no-deps-3")}\n${refusal("no-deps")}\n`,
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test("options.paths: a miss installs nothing when the calling file has a node_modules directory", async () => {
    // Nothing above the entry has a node_modules directory.
    const result = await runWithRegistry({
      files: { "project/node_modules/.keep": "", "outside/file.js": "" },
      cwd: "project",
      source: `console.log(resolve("no-deps", ["../outside"]));`,
    });
    expect(result).toEqual({ stdout: `${missing("no-deps")}\n`, stderr: "", exitCode: 0, requests: [] });
  });

  test("options.paths: a package that no entry has is installed for the calling file", async () => {
    // The first entry has a node_modules directory. The second entry is in a project that lists
    // another version of the package.
    const result = await runWithRegistry({
      files: {
        "project/package.json": JSON.stringify({ name: "project", dependencies: { "no-deps": "1.0.0" } }),
        "project/plugins/node_modules/other/index.js": "",
        "elsewhere/package.json": JSON.stringify({ name: "elsewhere", dependencies: { "no-deps": "1.1.0" } }),
      },
      cwd: "project",
      source: `console.log(resolve("no-deps", ["plugins", "../elsewhere"]));`,
    });
    expect(result).toEqual({
      stdout: "cache/no-deps@1.0.0/index.js\n",
      stderr: "",
      exitCode: 0,
      requests: installed("1.0.0"),
    });
  });

  test("options.paths: a module inside a compiled executable has no package scope", async () => {
    // With these flags the executable reads the package.json and the tsconfig.json of the
    // directory where it runs. They are the user's, not the calling file's.
    const { path: dir, cleanup } = createTempDir("resolve-paths-compiled", {
      "src/entry.cjs": `
        const path = require("node:path");
        const resolve = request => {
          try {
            const file = require.resolve(request, { paths: [path.resolve("../other")] });
            return path.relative(path.dirname(process.cwd()), file).split(path.sep).join("/");
          } catch (error) {
            return error.code;
          }
        };
        console.log(JSON.stringify(["cwd-pkg", "#imp", "@alias/thing", "dep"].map(resolve)));
      `,
      "run/package.json": JSON.stringify({ name: "cwd-pkg", imports: { "#imp": "./imp.js" }, exports: "./main.js" }),
      "run/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@alias/*": ["./lib/*"] } } }),
      "run/main.js": "",
      "run/imp.js": "",
      "run/lib/thing.js": "",
      "other/node_modules/cwd-pkg/index.js": "",
      "other/node_modules/dep/index.js": "",
    });
    try {
      const exe = join(dir, "run", process.platform === "win32" ? "app.exe" : "app");
      const build = Bun.spawn({
        cmd: [
          childExe,
          "build",
          "--compile",
          "--compile-autoload-package-json",
          "--compile-autoload-tsconfig",
          join(dir, "src", "entry.cjs"),
          "--outfile",
          exe,
        ],
        cwd: dir,
        env: childEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildStderr, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
      expect({ buildStderr: buildExitCode === 0 ? "" : buildStderr, buildExitCode }).toEqual({
        buildStderr: "",
        buildExitCode: 0,
      });

      const proc = Bun.spawn({ cmd: [exe], cwd: join(dir, "run"), env: childEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout:
          JSON.stringify([
            "other/node_modules/cwd-pkg/index.js",
            "MODULE_NOT_FOUND",
            "MODULE_NOT_FOUND",
            "other/node_modules/dep/index.js",
          ]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      cleanup();
    }
    // A debug build is large, and the executable is a copy of it.
  }, 90_000);

  test("options.paths: nothing is installed without an entry or without a calling file", async () => {
    const result = await runWithRegistry({
      files: { "project/.keep": "" },
      cwd: "project",
      source: `
        console.log(resolve("no-deps", []));
        console.log(relative(() => Module._resolveFilename("no-deps", {}, false, { paths: [path.resolve("nowhere")] })));
      `,
    });
    expect(result).toEqual({
      stdout: `${missing("no-deps")}\n${missing("no-deps")}\n`,
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });
}
