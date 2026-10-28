// Use bun:test in Bun, or node:test in Node.js
import { spawn } from "child_process";
import { once } from "events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { text } from "stream/consumers";

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

// The tests that start a child process do not share state. node:test has no `test.concurrent`.
const concurrentTest = isBun ? test.concurrent : test;

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
  const { path: dir, cleanup } = createTempDir("module-resolve-paths-not-array", {
    "node_modules/resolve-test-pkg/index.js": "",
  });

  try {
    // The parent can resolve the package, so only the check of `options.paths` can throw.
    const fakeParent = new Module(join(dir, "file.js"));
    fakeParent.filename = join(dir, "file.js");
    fakeParent.paths = Module._nodeModulePaths(dir);
    expect(Module._resolveFilename("resolve-test-pkg", fakeParent)).toBe(
      resolve(dir, "node_modules/resolve-test-pkg/index.js"),
    );

    // Node throws ERR_INVALID_ARG_VALUE here. Bun throws ERR_INVALID_ARG_TYPE.
    const notAnArray = isBun ? "ERR_INVALID_ARG_TYPE" : "ERR_INVALID_ARG_VALUE";
    const codeOf = paths => {
      try {
        return Module._resolveFilename("resolve-test-pkg", fakeParent, false, { paths });
      } catch (error) {
        return error.code;
      }
    };

    // A string and a Set are iterable but not arrays. The object is not iterable.
    expect([codeOf("/some/path"), codeOf(new Set(["/some/path"])), codeOf({ 0: "/some/path" })]).toEqual([
      notAnArray,
      notAnArray,
      notAnArray,
    ]);

    // Node returns a builtin id before it reads `options.paths`.
    expect(Module._resolveFilename("path", fakeParent, false, { paths: "/some/path" })).toBe("path");
  } finally {
    cleanup();
  }
});

test("Module._resolveFilename reads options.paths one entry at a time for a relative request", () => {
  const { path: dir, cleanup } = createTempDir("module-resolve-paths-lazy", {
    "target.js": "",
  });

  try {
    // Node stops at the entry that has the file and never reads the one after it.
    const fakeParent = new Module("/some/other/directory/file.js");
    expect(Module._resolveFilename("./target.js", fakeParent, false, { paths: [dir, 0] })).toBe(
      resolve(dir, "target.js"),
    );
  } finally {
    cleanup();
  }
});

test("a non-string options.paths entry throws the error of path.resolve(entry)", () => {
  const { path: dir, cleanup } = createTempDir("module-resolve-paths-entry-type", {
    "node_modules/resolve-test-pkg/index.js": "",
    "target.js": "",
  });

  try {
    const fakeParent = new Module(join(dir, "file.js"));
    fakeParent.filename = join(dir, "file.js");
    fakeParent.paths = Module._nodeModulePaths(dir);
    const errorOf = resolveIt => {
      try {
        return resolveIt();
      } catch (error) {
        return `${error.code}: ${error.message}`;
      }
    };
    // The entry is the one argument of path.resolve(), so Node names it "paths[0]" at every index.
    const invalid = received =>
      `ERR_INVALID_ARG_TYPE: The "paths[0]" argument must be of type string. Received ${received}`;
    expect([
      errorOf(() => Module._resolveFilename("resolve-test-pkg", fakeParent, false, { paths: [dir, null] })),
      errorOf(() => require.resolve("resolve-test-pkg", { paths: [dir, null] })),
      // The request can be an object that converts to a string, or an absolute path.
      errorOf(() => Module._resolveFilename(new String("resolve-test-pkg"), fakeParent, false, { paths: [0] })),
      errorOf(() => Module._resolveFilename(join(dir, "target.js"), fakeParent, false, { paths: [dir, dir, 5] })),
    ]).toEqual([invalid("null"), invalid("null"), invalid("type number (0)"), invalid("type number (5)")]);
  } finally {
    cleanup();
  }
});

// Node turns each `options.paths` entry into a directory with path.resolve(), so a relative entry
// is relative to process.cwd() and not to the calling file. For a bare request the entry is only
// the directory where the search of node_modules directories starts. The "imports" and the name
// of a package are the calling file's. In Bun, so are the tsconfig.json and the decision to
// install a package.
//
// The probe runs with the fixture root as the cwd, in a child process so that the resolver starts
// with empty caches. Each row names the directory of the calling file.
const exportsFilename = "module.exports = __filename;";
const resolversSource = `
const Module = require("node:module");
module.exports = {
  "require.resolve": (request, paths) => require.resolve(request, { paths }),
  "Module._resolveFilename": (request, paths) => Module._resolveFilename(request, module, false, { paths }),
  "createRequire().resolve": (request, paths) => Module.createRequire(__filename).resolve(request, { paths }),
};
`;
// Bun also reads `paths` from the second argument of require().
const loadersSource = `
if (typeof Bun !== "undefined") {
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
const probeSource = `
const path = require("node:path");
const root = process.cwd();
const rows = JSON.parse(require("node:fs").readFileSync("rows.json", "utf8"));
const order = rows.map((row, i) => i);
if (process.argv[2] === "reverse") order.reverse();
const results = [];
for (const i of order) {
  const [request, paths, chdir, from] = rows[i];
  const resolvers = require(path.join(root, from, "resolvers.cjs"));
  if (chdir) process.chdir(chdir);
  results[i] = {};
  for (const name in resolvers) {
    try {
      results[i][name] = path.relative(root, resolvers[name](request, paths)).split(path.sep).join("/");
    } catch (error) {
      results[i][name] = error.code;
    }
  }
  process.chdir(root);
}
console.log(JSON.stringify(results));
`;

async function resolveRowsInChild(order) {
  const isWindows = process.platform === "win32";
  const files = {
    "probe.cjs": probeSource,
    "sub/resolvers.cjs": resolversSource,
    // A node_modules directory at the root also keeps Bun's auto-install off.
    "node_modules/plugroot/index.js": "",
    "node_modules/plugboth/index.js": "",
    "plugins/node_modules/plug/index.js": "",
    "plugins/node_modules/plugboth/index.js": "",
    "plugins/file.js": "",
    "deps/node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
    "deps/node_modules/dep/index.js": "",
    "deps/node_modules/vue-router/package.json": JSON.stringify({
      name: "vue-router",
      exports: { "./volar/sfc-route-blocks": "./dist/volar/sfc-route-blocks.cjs" },
    }),
    "deps/node_modules/vue-router/dist/volar/sfc-route-blocks.cjs": "",
    "deps/node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg", main: "lib/main.js" }),
    "deps/node_modules/@scope/pkg/lib/main.js": "",
    // A package with a tsconfig.json, and calling files inside and outside of it.
    "outside/resolvers.cjs": resolversSource + loadersSource,
    "nofile/resolvers.cjs": resolversWithoutFileSource,
    "scope/resolvers.cjs": resolversSource + loadersSource,
    "scope/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@alias/*": ["./lib/*"] } } }),
    "scope/lib/thing.js": exportsFilename,
    "scope/base.js": exportsFilename,
    "scope/package.json": JSON.stringify({
      name: "scoped",
      imports: { "#imp": "./imp.js", "#other": "other-dep" },
      exports: "./main.js",
    }),
    "scope/imp.js": exportsFilename,
    "scope/main.js": exportsFilename,
    "other/file.js": exportsFilename,
    "other/node_modules/other-dep/index.js": exportsFilename,
    "other/node_modules/scoped/index.js": exportsFilename,
    "other/node_modules/both/index.js": exportsFilename,
    "global/both/index.js": exportsFilename,
    "a/node_modules/exp/package.json": JSON.stringify({ name: "exp", exports: { "./a": "./a.js" } }),
    "a/node_modules/exp/a.js": exportsFilename,
    "a/node_modules/exp/b.js": exportsFilename,
    "b/node_modules/exp/package.json": JSON.stringify({ name: "exp", exports: { "./b": "./b.js" } }),
    "b/node_modules/exp/b.js": exportsFilename,
  };
  if (!isWindows) {
    files["C:/plugins/node_modules/plugd/index.js"] = "";
    files["back\\slash/file.js"] = "";
  }
  const { path: dir, cleanup } = createTempDir("resolve-paths-entries", files);
  const abs = (...entries) => entries.map(entry => join(dir, entry));

  const plug = "plugins/node_modules/plug/index.js";
  const plugroot = "node_modules/plugroot/index.js";
  const dep = "deps/node_modules/dep/index.js";
  const file = "plugins/file.js";
  const otherDep = "other/node_modules/other-dep/index.js";
  const otherScoped = "other/node_modules/scoped/index.js";
  const missing = "MODULE_NOT_FOUND";
  // [request, paths, expected, directory to chdir() into first, directory of the calling file]
  const rows = [
    // https://github.com/oven-sh/bun/issues/45706
    ["dep", ["./deps"], dep],
    ["dep", ["../deps"], missing],
    ["dep", [join(dir, "deps")], dep],
    ["vue-router/volar/sfc-route-blocks", ["./deps"], "deps/node_modules/vue-router/dist/volar/sfc-route-blocks.cjs"],
    ["@scope/pkg", ["deps"], "deps/node_modules/@scope/pkg/lib/main.js"],
    // A package at two levels: the copy under the entry is the one to find.
    ["plugboth", ["./plugins"], "plugins/node_modules/plugboth/index.js"],
    ["plugboth", ["plugins"], "plugins/node_modules/plugboth/index.js"],
    ["plugboth", ["nowhere"], "node_modules/plugboth/index.js"],
    // The search starts at the entry and goes up.
    ["plug", ["plugins"], plug],
    ["plug", ["plugins/"], plug],
    ["plug", ["plugins/../plugins"], plug],
    ["plug", ["nowhere", "plugins"], plug],
    ["plug", ["./nowhere"], missing],
    ["plug", ["."], missing],
    ["plugroot", [""], plugroot],
    ["plugroot", ["."], plugroot],
    ["plugroot", ["./nowhere/deeper"], plugroot],
    ["plugroot", ["nowhere/"], plugroot],
    ["plug", ["."], plug, "plugins"],
    ["plugroot", [".."], plugroot, "plugins"],
    // A relative request is joined to the entry.
    ["./node_modules/plug/index.js", ["plugins"], plug],
    ["./file.js", ["plugins"], file],
    ["./file.js", ["nowhere"], missing],
    ["../plugins/file.js", ["nowhere"], file],
    ["./file.js", abs("other"), "other/file.js", "", "outside"],
    // A builtin id is resolved before `paths` is read. Any other request that is not relative
    // needs strings, also an absolute one, which does not use the entries.
    ["node:fs", [0], "node:fs"],
    ["plugroot", [0], "ERR_INVALID_ARG_TYPE"],
    ["plugroot", [".", null], "ERR_INVALID_ARG_TYPE"],
    [join(dir, "plugins", "file.js"), ["nowhere"], file],
    [join(dir, "plugins", "file.js"), [0], "ERR_INVALID_ARG_TYPE"],

    // The entry has a tsconfig.json and a package.json. They are not the calling file's.
    ["@alias/thing", abs("scope"), missing, "", "outside"],
    ["@alias/thing", ["scope"], missing, "", "outside"],
    ["base", abs("scope"), missing, "", "outside"],
    ["#imp", abs("scope"), missing, "", "outside"],
    ["#imp", ["./scope"], missing, "", "outside"],
    ["scoped", abs("scope"), missing, "", "outside"],
    ["scoped", ["scope"], missing, "", "outside"],
    ["scoped", abs("scope", "other"), otherScoped, "", "outside"],
    ["other-dep", ["scope", join(dir, "other")], otherDep, "", "outside"],
    // The calling file is in a package. Its "imports" and its name apply, whatever the entries are.
    ["#imp", abs("other"), "scope/imp.js", "", "scope"],
    ["#imp", ["."], "scope/imp.js", "", "scope"],
    ["#imp", [], "scope/imp.js", "", "scope"],
    ["scoped", abs("other"), "scope/main.js", "", "scope"],
    ["scoped", ["other"], "scope/main.js", "", "scope"],
    ["scoped", [], "scope/main.js", "", "scope"],
    // The package that an "imports" target names is searched from the calling package, not from the entry.
    ["#other", abs("other"), missing, "", "scope"],
    ["other-dep", abs("other"), otherDep, "", "scope"],
    ["other-dep", [], missing, "", "scope"],
    // Node has no tsconfig.json. Bun reads the one of the calling file.
    ["@alias/thing", abs("other"), isBun ? "scope/lib/thing.js" : missing, "", "scope"],
    ["base", abs("other"), isBun ? "scope/base.js" : missing, "", "scope"],
    // A parent module without a file name has no scope. The working directory does not stand in for it.
    // Node keeps a result per list of paths, so these rows have a list of their own.
    ["scoped", abs("other", "a"), otherScoped, "scope", "nofile"],
    ["#imp", abs("other", "a"), missing, "scope", "nofile"],
    ["@alias/thing", abs("other", "a"), missing, "scope", "nofile"],
    ["other-dep", abs("other", "a"), otherDep, "scope", "nofile"],
    // The first package that has "exports" decides, also when a later entry has another copy.
    ["exp/b", abs("a", "b"), isBun ? missing : "ERR_PACKAGE_PATH_NOT_EXPORTED", "", "outside"],
    ["exp/b", abs("b", "a"), "b/node_modules/exp/b.js", "", "outside"],
    // NODE_PATH is searched after the first entry and before the second one.
    ["both", abs("outside", "other"), "global/both/index.js", "", "outside"],
    ["both", abs("other", "outside"), "other/node_modules/both/index.js", "", "outside"],
  ];
  if (isWindows) {
    rows.push(["plug", ["plugins\\"], plug], ["plug", [".\\plugins"], plug]);
  } else {
    rows.push(
      // A backslash and a drive letter are file name characters on POSIX.
      ["plug", ["plugins\\"], missing],
      ["plug", [".\\plugins"], missing],
      ["plugroot", ["plugins\\"], plugroot],
      ["plugroot", ["./plugins\\"], plugroot],
      ["plugd", ["C:/plugins"], "C:/plugins/node_modules/plugd/index.js"],
      ["plugd", ["C:\\plugins"], missing],
      ["plug", ["plugins\0x"], missing],
      ["plugroot", ["plugins\0x"], plugroot],
      // Longer than PATH_MAX as written, short once resolved.
      ["plug", [Buffer.alloc(4200, "./").toString() + "plugins"], plug],
      ["plug", [Buffer.alloc(5000, "a").toString()], missing],
      // The cwd has a backslash in its name. Bun's directory cache cannot read it, so the search starts above it.
      ["plugroot", ["."], plugroot, "back\\slash"],
      ["plugroot", ["./nowhere"], plugroot, "back\\slash"],
    );
  }

  try {
    writeFileSync(
      join(dir, "rows.json"),
      JSON.stringify(rows.map(([request, paths, , chdir, from]) => [request, paths, chdir, from ?? "sub"])),
    );
    const child = spawn(childExe, isBun ? ["--no-install", "probe.cjs", order] : ["probe.cjs", order], {
      cwd: dir,
      env: { ...childEnv, NODE_PATH: join(dir, "global") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, [status]] = await Promise.all([
      text(child.stdout),
      text(child.stderr),
      once(child, "close"),
    ]);
    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      results = null;
    }
    // One line per row and entry point, so that a failure names the row.
    const shorten = entry =>
      typeof entry !== "string" ? entry : entry.length > 80 ? `<${entry.length} bytes>` : entry.replace(dir, "<dir>");
    const lines = valueOf =>
      rows.flatMap(([request, paths, , chdir, from], i) =>
        Object.keys(results[i]).map(
          name =>
            `${from ? `${from}: ` : ""}${name}(${JSON.stringify(shorten(request))}, ` +
            `{ paths: ${JSON.stringify(paths.map(shorten))} })${chdir ? ` in ${chdir}` : ""} => ${valueOf(i, name)}`,
        ),
      );
    expect(results === null ? { stdout, stderr } : lines((i, name) => results[i][name])).toEqual(
      results === null ? null : lines(i => rows[i][2]),
    );
    expect(status).toBe(0);
  } finally {
    cleanup();
  }
}

concurrentTest("options.paths entries are resolved like path.resolve() does", async () => {
  await resolveRowsInChild("forward");
});

concurrentTest("options.paths entries resolve the same in the reverse call order", async () => {
  await resolveRowsInChild("reverse");
});

if (isBun) {
  const { isASAN, isDebug, nodeExeAtLeast } = await import("harness");
  const { TestRegistry } = await import("registry");
  const isPosix = process.platform !== "win32";

  const missing = request => `Cannot find module '${request}'`;
  const refusal = request =>
    `Cannot find package "${request}": auto-install is off because a security scanner is configured. Run "bun install"`;
  const scanner = `[install.security]\nscanner = "./scanner.ts"\n`;
  const installed = version => ["/no-deps", `/no-deps/-/no-deps-${version}.tgz`];

  // Runs `source` as `index.cjs` in the directory `cwd` of a new tree. Nothing above the tree has a
  // node_modules directory, so auto-install is on where the tree has none. The registry has the
  // package `no-deps` and records each request. `resolve(request, paths)` takes the entries as
  // written, and `abs(entry)` makes one absolute. The result is relative to the tree, or the first
  // line of the error message.
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
          const resolve = (request, paths) => relative(() => require.resolve(request, { paths }));
          const abs = entry => path.resolve(entry);
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
        return { stdout: stdout.trim().split("\n"), stderr, exitCode, requests: registry.requests.map(r => r.path) };
      } finally {
        cleanup();
      }
    } finally {
      registry.stop();
    }
  }

  const inPlugins = "project/plugins/node_modules/no-deps/index.js";
  const fromRegistry = "cache/no-deps@2.0.0/index.js";

  test.concurrent.each([
    // Auto-install is on: nothing above the calling file has a node_modules directory.
    [[], inPlugins, ["/no-deps-2"]],
    [["-i"], inPlugins, ["/no-deps-2"]],
    [["--no-install"], inPlugins, []],
    // This mode reads no node_modules directory, so the registry's copy is the answer.
    [["--install=force"], fromRegistry, [...installed("2.0.0"), "/no-deps-2"]],
  ])("options.paths: every entry is searched before a package is installed, with %j", async (args, found, requests) => {
    const result = await runWithRegistry({
      files: { "project/plugins/node_modules/no-deps/index.js": "" },
      cwd: "project",
      args,
      // The first entry misses. The second entry has the package. No entry has "no-deps-2".
      source: `
        console.log(resolve("no-deps", [abs("nowhere"), abs("plugins")]));
        console.log(resolve("no-deps", ["./nowhere", "./plugins"]));
        console.log(resolve("no-deps", [abs("nowhere"), "plugins"]));
        console.log(resolve("no-deps-2", [abs("nowhere"), "plugins"]));
      `,
    });
    expect(result).toEqual({
      stdout: [found, found, found, missing("no-deps-2")],
      stderr: "",
      exitCode: 0,
      requests,
    });
  });

  test.concurrent("options.paths: a refusal to install comes after every entry was searched", async () => {
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
        console.log(resolve("no-deps", [abs("conf"), abs("../../tool")]));
        console.log(resolve("no-deps", ["conf", "../../tool"]));
        console.log(resolve("no-deps-3", [abs("conf"), abs("../../tool")]));
      `,
    });
    const inTool = "tool/node_modules/no-deps/index.js";
    expect(result).toEqual({
      stdout: [inTool, inTool, refusal("no-deps-3")],
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test.concurrent("options.paths: the project that installs is the calling file's, not the entry's", async () => {
    // The entry is in a nested project. A package manager made for it has the settings of that
    // project, and it stays for the rest of the process.
    const result = await runWithRegistry({
      files: {
        "root/bunfig.toml": scanner,
        "root/package.json": JSON.stringify({ name: "root" }),
        "root/app/sub/package.json": JSON.stringify({ name: "nested" }),
      },
      cwd: "root/app",
      source: `
        console.log(resolve("no-deps-3", [abs("sub")]));
        console.log(resolve("no-deps-1", ["./sub"]));
        console.log(resolve("no-deps-2", ["sub"]));
        console.log(relative(() => require.resolve("no-deps")));
      `,
    });
    expect(result).toEqual({
      stdout: [refusal("no-deps-3"), refusal("no-deps-1"), refusal("no-deps-2"), refusal("no-deps")],
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test.concurrent(
    "options.paths: a miss installs nothing when the calling file has a node_modules directory",
    async () => {
      // Nothing above the entry has a node_modules directory.
      const result = await runWithRegistry({
        files: { "project/node_modules/.keep": "", "outside/file.js": "" },
        cwd: "project",
        source: `
        console.log(resolve("no-deps", [abs("../outside")]));
        console.log(resolve("no-deps", ["../outside"]));
      `,
      });
      expect(result).toEqual({
        stdout: [missing("no-deps"), missing("no-deps")],
        stderr: "",
        exitCode: 0,
        requests: [],
      });
    },
  );

  test.concurrent("options.paths: a package that no entry has is installed for the calling file", async () => {
    // The first entry has a node_modules directory. The second entry is in a project that lists
    // another version of the package.
    const result = await runWithRegistry({
      files: {
        "project/package.json": JSON.stringify({ name: "project", dependencies: { "no-deps": "1.0.0" } }),
        "project/plugins/node_modules/other/index.js": "",
        "elsewhere/package.json": JSON.stringify({ name: "elsewhere", dependencies: { "no-deps": "1.1.0" } }),
      },
      cwd: "project",
      source: `
        console.log(resolve("no-deps", [abs("plugins"), abs("../elsewhere")]));
        console.log(resolve("no-deps", ["plugins", "../elsewhere"]));
      `,
    });
    expect(result).toEqual({
      stdout: ["cache/no-deps@1.0.0/index.js", "cache/no-deps@1.0.0/index.js"],
      stderr: "",
      exitCode: 0,
      requests: installed("1.0.0"),
    });
  });

  test.concurrent("options.paths: a package on disk under any entry wins over the registry", async () => {
    const result = await runWithRegistry({
      files: {
        "a/b/project/plugins/node_modules/no-deps/index.js": "module.exports = 'on disk';",
        "a/b/project/sub/file.js": "",
        "a/b/modules/node_modules/local-dep/index.js": "",
        // https://github.com/oven-sh/bun/issues/19419: nest-typed-config loads two of the project's
        // dependencies in this way, from its own file in node_modules.
        "a/b/modules/node_modules/typed-config/index.js": `module.exports = require.resolve("no-deps", { paths: ["../..", "."] });`,
        "a/b/modules/node_modules/no-deps/index.js": "",
      },
      cwd: "a/b/project",
      source: `
        // The registry has no-deps too. Each list has it on disk.
        console.log(resolve("no-deps", [".", "plugins"]), resolve("no-deps", ["./plugins", "."]));
        // An entry outside the cwd is searched, also when the directory does not exist.
        console.log(resolve("local-dep", ["../modules"]), resolve("local-dep", ["../modules/nowhere"]));
        // On POSIX a backslash is a file name character: no such directory, and the search goes on above it.
        if (${isPosix}) console.log(resolve("no-deps", ["plugins/a\\\\b"]));
        // The second argument of require() is Bun's own. It takes the same entries.
        console.log(require("no-deps", { paths: ["plugins"] }));
        process.chdir("../modules");
        console.log(relative(() => require(path.resolve("node_modules/typed-config"))));
        // No entry has it. The calling file has no node_modules directory above it, so it is installed, once.
        console.log(resolve("no-deps", ["../..", "."]) === resolve("no-deps", [abs("nowhere")]));
        console.log(resolve("no-deps", ["../.."]));
      `,
    });
    const onDisk = "a/b/project/plugins/node_modules/no-deps/index.js";
    const localDep = "a/b/modules/node_modules/local-dep/index.js";
    expect(result).toEqual({
      stdout: [
        `${onDisk} ${onDisk}`,
        `${localDep} ${localDep}`,
        ...(isPosix ? [onDisk] : []),
        "on disk",
        "a/b/modules/node_modules/no-deps/index.js",
        "true",
        fromRegistry,
      ],
      stderr: "",
      exitCode: 0,
      requests: installed("2.0.0"),
    });
  });

  // The executable is a copy of the runtime, which is more than 1 GB in a debug build.
  test.skipIf(isDebug || isASAN)(
    "options.paths: a module inside a compiled executable has no package scope",
    async () => {
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
        const exe = join(dir, "run", isPosix ? "app" : "app.exe");
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
    },
  );

  test.concurrent("options.paths: nothing is installed without an entry or without a calling file", async () => {
    const result = await runWithRegistry({
      files: { "project/.keep": "" },
      cwd: "project",
      source: `
        console.log(resolve("no-deps", []));
        console.log(relative(() => Module._resolveFilename("no-deps", {}, false, { paths: [abs("nowhere")] })));
        console.log(relative(() => Module._resolveFilename("no-deps", {}, false, { paths: ["nowhere"] })));
      `,
    });
    expect(result).toEqual({
      stdout: [missing("no-deps"), missing("no-deps"), missing("no-deps")],
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  // The rows that hold for Node.js are Node's own answers. This file is also a node:test file.
  const node = nodeExeAtLeast("26.3.0");
  test.skipIf(!node)("the options.paths tests pass in Node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [node, import.meta.path],
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  });
}
