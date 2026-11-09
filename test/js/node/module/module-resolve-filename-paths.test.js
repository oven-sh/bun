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
let nodeForTheseTests = null;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
  const harness = await import("harness");
  childEnv = harness.bunEnv;
  childExe = harness.bunExe();
  nodeForTheseTests = harness.nodeExeAtLeast("26.3.0");
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

test("a non-string options.paths entry throws Node's error", () => {
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
      // An absolute request does not use the entries. Node checks them all the same.
      errorOf(() => Module._resolveFilename(join(dir, "target.js"), fakeParent, false, { paths: [dir, dir, 5] })),
    ]).toEqual([invalid("null"), invalid("null"), invalid("type number (5)")]);

    // A relative request reads the entries one at a time, so Node's text there is for the list.
    expect(errorOf(() => require.resolve("./target.js", { paths: [5] }))).toBe(
      `ERR_INVALID_ARG_TYPE: The "paths" argument must be array of strings. Received an instance of Array`,
    );

    // A request object that converts to a string gets no path either. Node 26.12 names the request
    // in the message, and Node 26.3 names the entry, so only the code is the same.
    const request = new String("resolve-test-pkg");
    expect(errorOf(() => Module._resolveFilename(request, fakeParent, false, { paths: [0] })).split(":")[0]).toBe(
      "ERR_INVALID_ARG_TYPE",
    );
  } finally {
    cleanup();
  }
});

// Node turns each `options.paths` entry into a directory with path.resolve(), so a relative entry
// is relative to process.cwd() and not to the calling file. The probe is in `sub/` and runs with
// the fixture root as the cwd, in a child process so that the resolver starts with empty caches.
const probeSource = `
const Module = require("node:module");
const path = require("node:path");
const root = process.cwd();
const rows = JSON.parse(require("node:fs").readFileSync("rows.json", "utf8"));
const resolvers = {
  "require.resolve": (request, paths) => require.resolve(request, { paths }),
  "Module._resolveFilename": (request, paths) => Module._resolveFilename(request, module, false, { paths }),
  "createRequire().resolve": (request, paths) => Module.createRequire(__filename).resolve(request, { paths }),
};
const order = rows.map((row, i) => i);
if (process.argv[2] === "reverse") order.reverse();
const results = [];
for (const i of order) {
  const [request, paths, chdir] = rows[i];
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
    "sub/probe.cjs": probeSource,
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
    // Two copies of one package. The "exports" of the copy under `plugins` leave private.js out.
    "node_modules/plugsealed/private.js": "",
    "plugins/node_modules/plugsealed/package.json": JSON.stringify({ name: "plugsealed", exports: "./index.js" }),
    "plugins/node_modules/plugsealed/index.js": "",
    "plugins/node_modules/plugsealed/private.js": "",
    // The "exports" of this copy name a file that does not exist.
    "node_modules/plugsealed-gone/sub.js": "",
    "plugins/node_modules/plugsealed-gone/package.json": JSON.stringify({ exports: { "./sub.js": "./dist/sub.js" } }),
    // The entry `nested` is a package of the same name as a copy in node_modules. Its "exports" leave lib.js out.
    "nested/package.json": JSON.stringify({ name: "plugnested", exports: "./main.js" }),
    "nested/main.js": "",
    "nested/lib.js": "",
    "node_modules/plugnested/lib.js": "",
    // A package in a directory of its own name, as in a workspace, with another copy in node_modules.
    "packages/plugsame/package.json": JSON.stringify({ name: "plugsame", exports: "./main.js" }),
    "packages/plugsame/main.js": "",
    "packages/plugsame/lib.js": "",
    "node_modules/plugsame/lib.js": "",
    // A scoped package with two copies. The "exports" of the copy under `plugins` leave private.js out.
    "node_modules/@plugscope/sealed/private.js": "",
    "plugins/node_modules/@plugscope/sealed/package.json": JSON.stringify({
      name: "@plugscope/sealed",
      exports: "./index.js",
    }),
    "plugins/node_modules/@plugscope/sealed/index.js": "",
    "plugins/node_modules/@plugscope/sealed/private.js": "",
    // The same two packages in a project that lies inside a node_modules directory. Rows chdir() into `node_modules/host`.
    "node_modules/host/nested/package.json": JSON.stringify({ name: "plugnested", exports: "./main.js" }),
    "node_modules/host/nested/main.js": "",
    "node_modules/host/nested/lib.js": "",
    "node_modules/host/node_modules/plugnested/lib.js": "",
    // An alias, as `npm install plugalias2@npm:plugalias` leaves it: the directory `plugalias2` holds a package named `plugalias`.
    "node_modules/plugalias2/package.json": JSON.stringify({ name: "plugalias", exports: "./index.js" }),
    "node_modules/plugalias2/index.js": "",
    "node_modules/plugalias/x.js": "",
    // The package of the probe defines two `#` names. The packages of the entries `deps` and `plugins` define them in another way.
    "package.json": JSON.stringify({ imports: { "#rootfile": "./plugins/file.js", "#sealed": "./plugins/file.js" } }),
    "deps/package.json": JSON.stringify({ imports: { "#depsfile": "./node_modules/dep/index.js" } }),
    "plugins/package.json": JSON.stringify({ imports: { "#sealed": "plugsealed/private.js" } }),
  };
  if (!isWindows) {
    files["C:/plugins/node_modules/plugd/index.js"] = "";
    files["back\\slash/file.js"] = "";
  }
  const { path: dir, cleanup } = createTempDir("resolve-paths-entries", files);

  const plug = "plugins/node_modules/plug/index.js";
  const plugroot = "node_modules/plugroot/index.js";
  const dep = "deps/node_modules/dep/index.js";
  const file = "plugins/file.js";
  const missing = "MODULE_NOT_FOUND";
  // Node has a code of its own for a file that "exports" leave out. Bun throws MODULE_NOT_FOUND.
  const refused = isBun ? missing : "ERR_PACKAGE_PATH_NOT_EXPORTED";
  // [request, paths, expected, directory to chdir() into first]
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
    // The nearest copy answers alone. Its "exports" refuse the file, so no copy above it and no relative entry after it answers.
    ["plugsealed", ["plugins"], "plugins/node_modules/plugsealed/index.js"],
    ["plugsealed/private.js", ["plugins"], refused],
    ["plugsealed/private.js", ["./plugins"], refused],
    ["plugsealed/private.js", ["plugins/nowhere"], refused],
    ["plugsealed/private.js", ["plugins", "."], refused],
    ["plugsealed/private.js", ["plugins", dir], refused],
    ["plugsealed/private.js", [join(dir, "plugins")], refused],
    ["plugsealed/private.js", [join(dir, "plugins"), "."], refused],
    ["plugsealed/private.js", [join(dir, "plugins"), "nowhere"], refused],
    ["plugsealed/private.js", [".", "plugins"], "node_modules/plugsealed/private.js"],
    ["plugsealed-gone/sub.js", ["plugins"], missing],
    // An entry inside that copy: the walk from it reaches the same copy.
    ["plugsealed/private.js", ["plugins/node_modules/plugsealed"], refused],
    ["plugsealed/private.js", ["plugins/node_modules/plugsealed", "."], refused],
    ["@plugscope/sealed/private.js", ["plugins"], refused],
    ["@plugscope/sealed/private.js", ["plugins/node_modules/@plugscope/sealed"], refused],
    // The call after a refusal starts anew.
    ["plug", ["nowhere", "plugins"], plug],
    // A package that holds an entry is not at `node_modules/<name>`, so it does not end the search: Node reads a
    // package's own name and `#` names from the caller. That holds inside a node_modules directory and for an alias.
    ["plugnested/lib.js", ["nested"], "node_modules/plugnested/lib.js"],
    ["plugnested/lib.js", ["./nested"], "node_modules/plugnested/lib.js"],
    ["plugnested/lib.js", ["nested/nowhere"], "node_modules/plugnested/lib.js"],
    ["plugsame/lib.js", ["packages/plugsame"], "node_modules/plugsame/lib.js"],
    ["plugnested/lib.js", ["nested"], "node_modules/host/node_modules/plugnested/lib.js", "node_modules/host"],
    ["plugnested/lib.js", ["./nested", "."], "node_modules/host/node_modules/plugnested/lib.js", "node_modules/host"],
    ["plugalias/x.js", ["node_modules/plugalias2"], "node_modules/plugalias/x.js"],
    ["plugalias/x.js", [join(dir, "node_modules", "plugalias2"), "."], "node_modules/plugalias/x.js"],
    ["#rootfile", ["deps"], file],
    ["#sealed", ["plugins"], file],
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
    // A builtin id is returned before the entries are checked. Any other request that is not relative
    // needs strings, also an absolute one, which does not use the entries.
    ["node:fs", [0], "node:fs"],
    ["plugroot", [0], "ERR_INVALID_ARG_TYPE"],
    ["plugroot", [".", null], "ERR_INVALID_ARG_TYPE"],
    [join(dir, "plugins", "file.js"), ["nowhere"], file],
    [join(dir, "plugins", "file.js"), [0], "ERR_INVALID_ARG_TYPE"],
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
      JSON.stringify(rows.map(([request, paths, , chdir]) => [request, paths, chdir])),
    );
    const child = spawn(childExe, isBun ? ["--no-install", "sub/probe.cjs", order] : ["sub/probe.cjs", order], {
      cwd: dir,
      env: childEnv,
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
      rows.flatMap(([request, paths, , chdir], i) =>
        ["require.resolve", "Module._resolveFilename", "createRequire().resolve"].map(
          name =>
            `${name}(${JSON.stringify(request)}, { paths: ${JSON.stringify(paths.map(shorten))} })` +
            `${chdir ? ` in ${chdir}` : ""} => ${valueOf(i, name)}`,
        ),
      );
    expect(results === null ? { stdout, stderr } : lines((i, name) => results[i][name])).toEqual(
      lines(i => rows[i][2]),
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
  // The rows above are Node's own answers: this file is a node:test file too.
  test.concurrent.skipIf(!nodeForTheseTests)("the options.paths tests pass in Node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [nodeForTheseTests, import.meta.path],
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  });

  // Runs `source` as `index.cjs` of the directory `cwd` in the tree `files`. No directory from the
  // temporary root up has a node_modules directory, so Bun's auto-install is on where the tree has
  // none. The registry records each request. It serves test/cli/install/registry/packages when
  // `packages` is true (no-deps has 2.0.0 as its latest version), and answers 404 when not.
  async function runInProject({ args = [], cwd, files, packages = false, source }) {
    const fixtures = join(import.meta.dir, "..", "..", "..", "cli", "install", "registry", "packages");
    const requests = [];
    const registry = Bun.serve({
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        const tarball = pathname.match(/^\/([a-z\d-]+)\/-\/(\1-[a-z\d.-]+\.tgz)$/);
        if (packages && tarball) return new Response(Bun.file(join(fixtures, tarball[1], tarball[2])));
        const manifest = Bun.file(join(fixtures, pathname.slice(1), "package.json"));
        if (packages && /^\/[a-z\d-]+$/.test(pathname) && (await manifest.exists())) {
          return new Response((await manifest.text()).replaceAll("http://localhost:4873/", url), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const url = `http://127.0.0.1:${registry.port}/`;
    try {
      const { path: dir, cleanup } = createTempDir("resolve-paths-install", {
        ...files,
        [cwd + "/index.cjs"]: `
          const path = require("node:path");
          const shown = file => {
            const fromCache = path.relative(process.env.BUN_INSTALL_CACHE_DIR, file);
            const shownFile = fromCache.startsWith("..") ? path.relative(process.cwd(), file) : "<cache>/" + fromCache;
            return shownFile.split(path.sep).join("/");
          };
          const resolve = (request, paths) => {
            try {
              return shown(require.resolve(request, { paths }));
            } catch (error) {
              return error.code;
            }
          };
          ${source}
        `,
      });
      try {
        const proc = Bun.spawn({
          cmd: [childExe, ...args, "index.cjs"],
          cwd: join(dir, cwd),
          env: { ...childEnv, BUN_CONFIG_REGISTRY: url, BUN_INSTALL_CACHE_DIR: join(dir, "cache") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout: stdout.trim().split("\n"), stderr, exitCode, requests };
      } finally {
        cleanup();
      }
    } finally {
      registry.stop(true);
    }
  }

  const isPosix = process.platform !== "win32";
  // `project` has no node_modules directory up to the root. `modules` has one.
  const projects = {
    "a/b/project/plugins/node_modules/no-deps/index.js": "module.exports = 'on disk';",
    "a/b/project/plugins/node_modules/sealed/package.json": JSON.stringify({ name: "sealed", exports: "./index.js" }),
    "a/b/project/plugins/node_modules/sealed/index.js": "",
    "a/b/project/sub/file.js": "",
    "a/b/modules/node_modules/local-dep/index.js": "",
  };

  test.concurrent("options.paths: a relative entry installs nothing, the cwd installs after a miss", async () => {
    const result = await runInProject({
      cwd: "a/b/project",
      files: projects,
      source: `
        // "../.." is outside the cwd and misses. "./plugins" has the package.
        console.log(resolve("no-deps", ["../..", "./plugins"]));
        // An entry outside the cwd is searched, also when the directory does not exist.
        console.log(resolve("local-dep", ["../modules"]), resolve("local-dep", ["../modules/nowhere"]));
        console.log(resolve("no-deps-1", [".."]), resolve("no-deps-1", ["../project-2"]));
        // On POSIX a backslash is a file name character: no such directory, and the search goes on above it.
        if (${isPosix}) console.log(resolve("no-deps", ["plugins/a\\\\b"]), resolve("no-deps-2", ["plugins\\\\"]));
        // The second argument of require() is Bun's own. It takes the same entries.
        console.log(require("no-deps", { paths: ["plugins"] }));
        // The copy under "plugins" refuses the file in its "exports": the registry is not asked. The calls after it install again.
        console.log(resolve("sealed/private.js", ["plugins"]), resolve("sealed/private.js", ["./plugins", "."]));
        // A project with a node_modules directory does not install.
        process.chdir("../modules");
        console.log(resolve("no-deps-3", ["../..", "."]));
        // Without one, a miss at an entry in the cwd installs from the cwd, as the absolute cwd does.
        process.chdir("../project");
        console.log(resolve("no-deps-4", ["."]), resolve("no-deps-5", [process.cwd()]));
        console.log(resolve("no-deps-6", ["sub"]), resolve("no-deps-7", ["./sub", "../.."]));
      `,
    });
    const missing = "MODULE_NOT_FOUND";
    expect(result).toEqual({
      stdout: [
        "plugins/node_modules/no-deps/index.js",
        "../modules/node_modules/local-dep/index.js ../modules/node_modules/local-dep/index.js",
        `${missing} ${missing}`,
        ...(isPosix ? [`plugins/node_modules/no-deps/index.js ${missing}`] : []),
        "on disk",
        `${missing} ${missing}`,
        missing,
        `${missing} ${missing}`,
        `${missing} ${missing}`,
      ],
      stderr: "",
      exitCode: 0,
      requests: ["/no-deps-4", "/no-deps-5", "/no-deps-6", "/no-deps-7"],
    });
  });

  test.concurrent("options.paths: a package on disk under any entry wins over the registry", async () => {
    const result = await runInProject({
      cwd: "a/b/project",
      files: {
        ...projects,
        // https://github.com/oven-sh/bun/issues/19419: nest-typed-config loads two of the project's
        // dependencies in this way, from its own file in node_modules.
        "a/b/modules/node_modules/typed-config/index.js": `module.exports = require.resolve("no-deps", { paths: ["../..", "."] });`,
        "a/b/modules/node_modules/no-deps/index.js": "",
      },
      packages: true,
      source: `
        // The registry has no-deps too. Each list has it on disk.
        console.log(resolve("no-deps", ["nowhere", "plugins"]), resolve("no-deps", ["./nowhere", "./plugins"]));
        console.log(resolve("no-deps", [".", "plugins"]), resolve("no-deps", ["./plugins", "."]));
        process.chdir("../modules");
        console.log(shown(require(path.resolve("node_modules/typed-config"))));
        // No entry has it: the cwd installs it, once.
        process.chdir("../project");
        console.log(resolve("no-deps", ["nowhere"]), resolve("no-deps", ["sub", "../.."]));
      `,
    });
    const onDisk = "plugins/node_modules/no-deps/index.js";
    expect(result).toEqual({
      stdout: [`${onDisk} ${onDisk}`, `${onDisk} ${onDisk}`, "node_modules/no-deps/index.js", expect.any(String)],
      stderr: "",
      exitCode: 0,
      requests: ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"],
    });
    const [first, second] = result.stdout[3].split(" ");
    expect({ first: first.startsWith("<cache>/no-deps@2.0.0"), second }).toEqual({ first: true, second: first });
  });

  test.concurrent("options.paths: a refusal by the exports of a copy on disk does not reach the registry", async () => {
    const result = await runInProject({
      cwd: "a/b/project",
      files: {
        // The registry has no-deps with an index.js. The "exports" of this copy on disk leave index.js out.
        "a/b/project/sealed/node_modules/no-deps/package.json": JSON.stringify({
          name: "no-deps",
          exports: { "./main": "./index.js" },
        }),
        "a/b/project/sealed/node_modules/no-deps/index.js": "",
        "a/b/project/sub/file.js": "",
      },
      packages: true,
      source: `
        const inside = "sealed/node_modules/no-deps";
        console.log(resolve("no-deps/index.js", ["sealed"]), resolve("no-deps/index.js", [path.resolve("sealed"), "sub"]));
        // An entry inside the copy is a search from the package itself.
        console.log(resolve("no-deps/index.js", [inside]), resolve("no-deps/index.js", [path.resolve(inside), "."]));
        // The refusal comes after the relative entry here. The search from the cwd does not follow it.
        console.log(resolve("no-deps/index.js", ["sub", path.resolve("sealed")]));
        // The second argument of require() takes the same way, so it loads no other copy.
        try {
          console.log(require("no-deps/index.js", { paths: ["sealed"] }));
        } catch (error) {
          console.log(error.code);
        }
      `,
    });
    const missing = "MODULE_NOT_FOUND";
    expect(result).toEqual({
      stdout: [`${missing} ${missing}`, `${missing} ${missing}`, missing, missing],
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test.concurrent("options.paths: the project of the cwd decides whether a miss installs", async () => {
    const result = await runInProject({
      cwd: "root/app",
      files: {
        // The scanner turns auto-install off for the project "root". "sub" is a project of its own.
        "root/bunfig.toml": `[install.security]\nscanner = "./scanner.ts"\n`,
        "root/package.json": JSON.stringify({ name: "root" }),
        "root/app/sub/package.json": JSON.stringify({ name: "nested" }),
        "root/app/conf/file.js": "",
        "tool/node_modules/no-deps/index.js": "",
      },
      source: `
        console.log(resolve("no-deps-1", ["./sub"]), resolve("no-deps-2", ["sub"]));
        // The refusal to install does not hide the package that the next entry has.
        console.log(resolve("no-deps", ["conf", path.resolve("../../tool")]));
      `,
    });
    expect(result).toEqual({
      stdout: ["MODULE_NOT_FOUND MODULE_NOT_FOUND", "../../tool/node_modules/no-deps/index.js"],
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  test.concurrent("options.paths: --install=force does not read the node_modules of an entry", async () => {
    const result = await runInProject({
      args: ["--install=force"],
      cwd: "a/b/project",
      files: projects,
      source: `
        // The registry has neither package, so the calls miss. plugins/node_modules has no-deps.
        console.log(resolve("no-deps", ["./plugins"]), resolve("no-deps-1", ["plugins", "."]));
        // "../modules" is outside the cwd: it installs nothing, and this mode has no other search.
        console.log(resolve("local-dep", ["../modules"]));
      `,
    });
    expect(result).toEqual({
      stdout: ["MODULE_NOT_FOUND MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
      stderr: "",
      exitCode: 0,
      requests: ["/no-deps", "/no-deps-1"],
    });
  });
}
