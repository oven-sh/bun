// Use bun:test in Bun, or node:test in Node.js
import { spawn } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

// Detect runtime and import appropriate test framework
const isBun = typeof Bun !== "undefined";
let test, expect;
let childEnv = process.env;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
  ({ bunEnv: childEnv } = await import("harness"));
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

// Runs a script of the fixture in a child process, with the fixture root as the cwd. A relative
// `options.paths` entry has a known anchor there, and the resolver starts with empty caches.
function runInFixture(dir, ...args) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const child = spawn(process.execPath, isBun ? ["--no-install", ...args] : args, {
    cwd: dir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (exitCode, signalCode) => resolve({ stdout, stderr, exitCode, signalCode }));
  return promise;
}

// Resolves each row of rows.json through every entry point that takes `options.paths`.
const relativeRequestProbe = `
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const rows = JSON.parse(fs.readFileSync("rows.json", "utf8"));
const resolveFilename = Module._resolveFilename;
const entryPoints = {
  "require.resolve": (request, paths) => require.resolve(request, { paths }),
  "createRequire().resolve": (request, paths) => Module.createRequire(__filename).resolve(request, { paths }),
  "Module._resolveFilename": (request, paths) => Module._resolveFilename(request, module, false, { paths }),
  "Module._resolveFilename without a parent": (request, paths) =>
    Module._resolveFilename(request, null, false, { paths }),
  "Module._resolveFilename override": (request, paths) => {
    Module._resolveFilename = function (...args) {
      return resolveFilename.apply(this, args);
    };
    try {
      return require.resolve(request, { paths });
    } finally {
      Module._resolveFilename = resolveFilename;
    }
  },
};
// Bun files the directory "p\\\\" in its cache under the key of "p", which does not exist.
if (process.platform !== "win32") {
  try {
    require.resolve("no-such-package", { paths: [path.join(root, "p") + "\\\\"] });
  } catch {}
}
const order = rows.map((row, i) => i);
if (process.argv[2] === "reverse") order.reverse();
const results = [];
for (const i of order) {
  const [request, paths, chdir] = rows[i];
  if (chdir) process.chdir(chdir);
  results[i] = {};
  for (const name in entryPoints) {
    try {
      const resolved = entryPoints[name](request, paths);
      results[i][name] = path.isAbsolute(resolved)
        ? path.relative(root, resolved).split(path.sep).join("/")
        : "not absolute: " + resolved;
    } catch (error) {
      results[i][name] = error.code;
    }
  }
  process.chdir(root);
}
console.log(JSON.stringify(results));
`;

// Node reads an `options.paths` entry of a relative request in `Module._findPath`:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L728-L839
// - The entry must be a directory, unless the request leaves it ("../x") or the entry is "".
// - The file is `path.resolve(entry, request)`, by the path rules of the host.
// - Only a directory answers a request that names one ("./x/").
async function resolveRelativeRequestRows(order) {
  const isWindows = process.platform === "win32";
  const files = {
    "probe.cjs": relativeRequestProbe,
    // A node_modules directory at the root also keeps Bun's auto-install off.
    "node_modules/.keep": "",
    "index.js": "",
    "file.js": "",
    "..foo/file.js": "",
    "plugins/index.js": "",
    "plugins/file.js": "",
    "plugins/sub/file.js": "",
    "plugins/node_modules/plug/index.js": "",
    "other/index.js": "",
    "other/file.js": "",
  };
  if (!isWindows) {
    files["C:/file.js"] = "";
    files["C:/plugins/file.js"] = "";
    files["C:/plugins/node_modules/plugd/index.js"] = "";
    files["d:/sub/file.js"] = "";
    files["p\\/index.js"] = "";
    files["p\\/file.js"] = "";
  }
  const { path: dir, cleanup } = createTempDir("resolve-paths-relative-request", files);

  const file = "plugins/file.js";
  const plug = "plugins/node_modules/plug/index.js";
  const missing = "MODULE_NOT_FOUND";
  // [request, paths, expected, directory to chdir() into first]
  const rows = [
    // An entry that is a directory.
    ["./file.js", [join(dir, "plugins")], file],
    ["./file.js", [join(dir, "plugins") + "/"], file],
    ["./file", ["plugins/"], file],
    ["./node_modules/plug/index.js", ["./plugins"], plug],
    ["./sub/../file.js", ["plugins/."], file],
    ["./file.js", ["plugins/sub/.."], file],
    [".", ["plugins"], "plugins/index.js"],
    ["./", [join(dir, "plugins")], "plugins/index.js"],
    ["./file.js", [""], "file.js"],
    ["./file.js", ["."], "file.js"],
    ["./file.js", ["./"], "file.js"],
    // Node keeps one answer per request and list, so each of these two is the only row of its kind.
    ["./sub/file.js", ["."], "plugins/sub/file.js", "plugins"],
    ["./index.js", [".."], "index.js", "plugins"],
    // The first entry that has the file wins.
    ["./file.js", ["nowhere", "plugins"], file],
    ["./file.js", ["other", "plugins"], "other/file.js"],
    ["./file.js", ["nowhere"], missing],
    ["./file.js", [], missing],
    // A request that leaves the entry is joined to it, and the entry is not checked.
    ["../plugins/file.js", ["nowhere"], file],
    ["../file.js", [join(dir, "plugins", "file.js")], file],
    ["..", ["plugins/sub"], "plugins/index.js"],
  ];
  if (isWindows) {
    rows.push(["./node_modules/plug/index.js", ["plugins\\"], plug], ["./file.js", [".\\plugins"], file]);
  } else {
    symlinkSync("plugins", join(dir, "link"));
    symlinkSync("other", join(dir, "other\\"));
    // Longer than PATH_MAX as written, short once resolved.
    const long = Buffer.alloc(4200, "./").toString() + "plugins";
    rows.push(
      ["./file.js", ["link"], file],
      // A drive letter is a file name.
      ["./node_modules/plugd/index.js", ["C:/plugins"], "C:/plugins/node_modules/plugd/index.js"],
      ["./file", ["C:/plugins"], "C:/plugins/file.js"],
      ["../plugins/file.js", ["C:/plugins"], "C:/plugins/file.js"],
      ["./file.js", ["C:"], "C:/file.js"],
      ["./file.js", ["d:/sub"], "d:/sub/file.js"],
      ["./file.js", ["C:\\plugins"], missing],
      // A backslash is a file name character.
      ["./node_modules/plug/index.js", ["plugins\\"], missing],
      ["./file.js", [".\\plugins"], missing],
      ["./file.js", ["plugins\\sub"], missing],
      ["./file.js", [join(dir, "plugins") + "\\"], missing],
      [".", [join(dir, "plugins") + "\\"], missing],
      ["./file.js", ["\\" + dir.slice(1) + "/plugins"], missing],
      ["./file.js", ["plugins\\", "other"], "other/file.js"],
      ["../plugins/file.js", ["plugins\\"], file],
      ["./sub\\file.js", ["plugins"], missing],
      // "other\" is a symlink to "other".
      ["./file.js", ["other\\"], "other/file.js"],
      [".", ["other\\"], "other/index.js"],
      // "p" does not exist. "p\" does, and the probe resolved through it first.
      ["./file.js", ["p"], missing],
      [".", ["p"], missing],
      // The OS does not remove ".." after a component that is not a directory.
      ["./file.js", ["missing/.."], missing],
      ["./file.js", ["file.js/.."], missing],
      ["./file.js", ["missing/../plugins"], missing],
      ["./file.js", ["a\\b/.."], missing],
      // Node reads this request as one that leaves the entry.
      ["./..foo/file.js", ["missing/.."], "..foo/file.js"],
      // An entry that is a file.
      [".", ["file.js"], missing],
      ["./", [join(dir, "file.js")], missing],
      // Only a directory answers a request that names one.
      ["./file.js/", ["plugins"], missing],
      // The OS reads an entry up to its first NUL.
      ["./file.js", ["plugins\0"], missing],
      ["./missing.js", ["plugins\0junk"], missing],
      ["./file.js", ["missing\0/../plugins"], missing],
      ["./file.js", ["plugins\0/../other"], "other/file.js"],
      ["../plugins/file.js", ["plugins\0junk"], file],
      ["./file.js", [long], missing],
      ["../plugins/file.js", [long], file],
    );
  }

  try {
    writeFileSync(
      join(dir, "rows.json"),
      JSON.stringify(rows.map(([request, paths, , chdir]) => [request, paths, chdir])),
    );
    const { stdout, stderr, exitCode } = await runInFixture(dir, "probe.cjs", order);
    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      results = null;
    }
    // One line per row and entry point, so that a failure names the row.
    const shorten = entry => (entry.length > 80 ? `<${entry.length} bytes>` : entry.replace(dir, "<dir>"));
    const lines = valueOf =>
      rows.flatMap(([request, paths, , chdir], i) =>
        [
          "require.resolve",
          "createRequire().resolve",
          "Module._resolveFilename",
          "Module._resolveFilename without a parent",
          "Module._resolveFilename override",
        ].map(
          name =>
            `${name}(${JSON.stringify(request)}, { paths: ${JSON.stringify(paths.map(shorten))} })` +
            `${chdir ? ` in ${chdir}` : ""} => ${valueOf(i, name)}`,
        ),
      );
    expect(results === null ? { stdout, stderr } : lines((i, name) => results[i][name])).toEqual(
      lines(i => rows[i][2]),
    );
    expect(exitCode).toBe(0);
  } finally {
    cleanup();
  }
}

test("a relative request reads options.paths entries as Module._findPath does", async () => {
  await resolveRelativeRequestRows("forward");
});

test("a relative request reads options.paths entries the same in the reverse call order", async () => {
  await resolveRelativeRequestRows("reverse");
});

test("a relative request reads an options.paths entry that the directory cache holds as missing or cannot list", async () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-directory-test", {
    "node_modules/.keep": "",
    "plugins/sub/file.js": "",
    "unlisted/sub/file.js": "",
    "probe.cjs": `
      const fs = require("node:fs");
      const path = require("node:path");
      const root = process.cwd();
      const resolve = (request, paths) => {
        try {
          return path.relative(root, require.resolve(request, { paths })).split(path.sep).join("/");
        } catch (error) {
          return error.code;
        }
      };
      const results = {};

      // A bare request remembers that "late" does not exist. Then the directory appears.
      const late = path.join(root, "late");
      results["bare request before mkdir"] = resolve("no-such-package", [late]);
      fs.mkdirSync(path.join(late, "sub"), { recursive: true });
      fs.writeFileSync(path.join(late, "sub", "file.js"), "");
      results["after mkdir"] = resolve("./sub/file.js", [late]);
      results["after mkdir, relative entry"] = resolve("./sub/file.js", ["late"]);

      // A miss through the directory, spelled with a backslash at its end.
      const plugins = path.join(root, "plugins");
      if (typeof Bun !== "undefined") {
        try {
          Bun.resolveSync("no-such-package", plugins + "\\\\");
        } catch {}
      }
      results["after a miss through the entry"] = resolve("./sub/file.js", [plugins]);

      // A directory that a user who is not root can search but not list.
      const unlisted = path.join(root, "unlisted");
      fs.chmodSync(unlisted, 0o311);
      results["mode 0311"] = resolve("./sub/file.js", [unlisted]);
      results["mode 0311, relative entry"] = resolve("./sub/file.js", ["unlisted"]);
      fs.chmodSync(unlisted, 0o755);

      console.log(JSON.stringify(results));
    `,
  });

  try {
    const { stdout, stderr, exitCode } = await runInFixture(dir, "probe.cjs");
    expect({ stdout, stderr }).toEqual({
      stdout:
        JSON.stringify({
          "bare request before mkdir": "MODULE_NOT_FOUND",
          "after mkdir": "late/sub/file.js",
          "after mkdir, relative entry": "late/sub/file.js",
          "after a miss through the entry": "plugins/sub/file.js",
          "mode 0311": "unlisted/sub/file.js",
          "mode 0311, relative entry": "unlisted/sub/file.js",
        }) + "\n",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  } finally {
    // The probe restores the mode, unless it stopped early.
    chmodSync(join(dir, "unlisted"), 0o755);
    cleanup();
  }
});
