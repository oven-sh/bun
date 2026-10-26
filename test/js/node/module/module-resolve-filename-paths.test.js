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
  // The request is not a builtin id: Node returns a builtin id before it reads `options.paths`.
  const fakeParent = new Module("/some/other/directory/file.js");

  // Test with string (which is iterable but not an array)
  expect(() => {
    Module._resolveFilename("resolve-test-pkg", fakeParent, false, { paths: "/some/path" });
  }).toThrow();

  // Test with Set (which is iterable but not an array)
  expect(() => {
    Module._resolveFilename("resolve-test-pkg", fakeParent, false, { paths: new Set(["/some/path"]) });
  }).toThrow();

  // Test with object (not iterable)
  expect(() => {
    Module._resolveFilename("resolve-test-pkg", fakeParent, false, { paths: { 0: "/some/path" } });
  }).toThrow();

  expect(Module._resolveFilename("path", fakeParent, false, { paths: "/some/path" })).toBe("path");
});

// Node turns each `options.paths` entry into a directory with path.resolve(): a relative entry is
// relative to process.cwd(), and only the host's separators separate. Each resolve runs in a child
// process so that the cwd is the fixture and the resolver starts with empty caches.
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

function resolveRowsInChild(order) {
  const isWindows = process.platform === "win32";
  const files = {
    "probe.cjs": probeSource,
    // A node_modules directory at the root also keeps Bun's auto-install off.
    "node_modules/plugroot/index.js": "",
    "plugins/node_modules/plug/index.js": "",
    "plugins/file.js": "",
  };
  if (!isWindows) {
    files["back/slash/node_modules/plugc/index.js"] = "";
    files["C:/plugins/node_modules/plugd/index.js"] = "";
  }
  const { path: dir, cleanup } = createTempDir("resolve-paths-entries", files);

  const plug = "plugins/node_modules/plug/index.js";
  const plugroot = "node_modules/plugroot/index.js";
  const file = "plugins/file.js";
  const missing = "MODULE_NOT_FOUND";
  // [request, paths, expected, directory to chdir() into first]
  const rows = [
    // A bare request searches node_modules from the entry upward.
    ["plug", ["./plugins"], plug],
    ["plug", ["plugins"], plug],
    ["plug", ["plugins/"], plug],
    ["plug", ["plugins/../plugins"], plug],
    ["plug", ["nowhere", "plugins"], plug],
    ["plug", ["./nowhere"], missing],
    ["plug", ["."], missing],
    ["plugroot", [""], plugroot],
    ["plugroot", ["."], plugroot],
    ["plugroot", ["./nowhere/deeper"], plugroot],
    ["plug", ["."], plug, "plugins"],
    ["plugroot", [".."], plugroot, "plugins"],
    // A relative request is joined to the entry. The entry must be a directory unless the
    // request leaves it.
    ["./node_modules/plug/index.js", ["plugins"], plug],
    ["./node_modules/plug/index.js", ["./plugins"], plug],
    ["./node_modules/plug/index.js", [join(dir, "plugins")], plug],
    ["./node_modules/plug/index.js", ["nowhere", "plugins"], plug],
    ["./file.js", ["plugins"], file],
    ["./file.js", ["nowhere"], missing],
    [".", ["plugins/file.js"], missing],
    ["../plugins/file.js", ["nowhere"], file],
    // A builtin id is resolved before `paths` is read. Any other bare request needs strings.
    ["node:fs", [0], "node:fs"],
    ["plugroot", [0], "ERR_INVALID_ARG_TYPE"],
    ["plugroot", [".", null], "ERR_INVALID_ARG_TYPE"],
  ];
  if (isWindows) {
    rows.push(["plug", ["plugins\\"], plug], ["plug", [".\\plugins"], plug]);
  } else {
    const tooLong = Buffer.alloc(5000, "a").toString();
    rows.push(
      ["plug", [dir + "/nope/../plugins"], plug],
      // A backslash and a drive letter are file name characters on POSIX.
      ["plug", ["plugins\\"], missing],
      ["plug", [".\\plugins"], missing],
      ["plug", [dir + "/plugins\\"], missing],
      ["plugroot", ["plugins\\"], plugroot],
      ["plugc", ["back\\slash"], missing],
      ["plugd", ["C:/plugins"], "C:/plugins/node_modules/plugd/index.js"],
      ["plugd", ["C:\\plugins"], missing],
      ["./node_modules/plug/index.js", ["plugins\\"], missing],
      ["./node_modules/plug/index.js", [".\\plugins"], missing],
      ["./node_modules/plugc/index.js", ["back\\slash"], missing],
      ["./node_modules/plugd/index.js", ["C:/plugins"], "C:/plugins/node_modules/plugd/index.js"],
      ["../plugins/file.js", ["plugins\\"], file],
      // The OS does not collapse "nowhere/..": the directory does not exist.
      ["./node_modules/plugroot/index.js", ["nowhere/.."], missing],
      ["plug", ["plugins\0x"], missing],
      ["./index.js", [dir + "/plugins/node_modules/plug\0"], missing],
      ["plug", [tooLong], missing],
      ["./file.js", [tooLong], missing],
    );
  }

  try {
    writeFileSync(
      join(dir, "rows.json"),
      JSON.stringify(rows.map(([request, paths, , chdir]) => [request, paths, chdir])),
    );
    const { stdout, stderr, status } = spawnSync(
      process.execPath,
      isBun ? ["--no-install", "probe.cjs", order] : ["probe.cjs", order],
      { cwd: dir, env: childEnv, encoding: "utf8" },
    );
    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      results = { stdout, stderr };
    }
    expect(results).toEqual(
      rows.map(([, , expected]) => ({
        "require.resolve": expected,
        "Module._resolveFilename": expected,
        "createRequire().resolve": expected,
      })),
    );
    expect(status).toBe(0);
  } finally {
    cleanup();
  }
}

test("options.paths entries are resolved like path.resolve() does", () => {
  resolveRowsInChild("forward");
});

test("options.paths entries resolve the same in the reverse call order", () => {
  resolveRowsInChild("reverse");
});
