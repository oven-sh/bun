// Use bun:test in Bun, or node:test in Node.js
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

// Detect runtime and import appropriate test framework
const isBun = typeof Bun !== "undefined";
let test, expect;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
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

test("require.resolve coerces non-string options.paths entries without crashing", () => {
  // options.paths is converted as a WebIDL sequence<DOMString>, so a non-string
  // entry is coerced to a string rather than crashing the process (the original
  // Fuzzilli bug). A number that does not name a real directory just misses.
  expect(() => {
    require.resolve("this-pkg-does-not-exist-zzz", { paths: [512] });
  }).toThrow();
  expect(() => {
    require.resolve("this-pkg-does-not-exist-zzz", { paths: ["/abs", 512] });
  }).toThrow();

  // Bun coerces options.paths entries via WebIDL DOMString (Node instead throws
  // ERR_INVALID_ARG_TYPE for a non-string), so only assert the coerced directory
  // name is honored (512 -> "512", anchored at cwd) under Bun.
  if (isBun) {
    const { path: dir, cleanup } = createTempDir("require-resolve-coerced-paths", {
      "512/node_modules/coerced-pkg/package.json": JSON.stringify({ name: "coerced-pkg", main: "index.js" }),
      "512/node_modules/coerced-pkg/index.js": "module.exports = 'coerced-pkg';",
    });
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      expect(require.resolve("coerced-pkg", { paths: [512] })).toBe(
        resolve(dir, "512/node_modules/coerced-pkg/index.js"),
      );
    } finally {
      process.chdir(prevCwd);
      cleanup();
    }
  }
});

test("require.resolve does not crash when options.paths contains a non-absolute path", () => {
  // A non-absolute entry that does not exist relative to cwd simply cannot be
  // found. Previously this crashed the process.
  expect(() => {
    require.resolve("this-pkg-does-not-exist-zzz", { paths: ["this_dir_does_not_exist", "./nope"] });
  }).toThrow();

  // createRequire().resolve goes through the same resolver path.
  let caught;
  try {
    Module.createRequire(join(realpathSync(tmpdir()), "x.js")).resolve("this-pkg-does-not-exist-zzz", {
      paths: ["./rel"],
    });
  } catch (e) {
    caught = e.code;
  }
  expect(caught).toBe("MODULE_NOT_FOUND");

  // A Windows-style drive path is not absolute on POSIX (it is a relative
  // segment there), so it must be anchored at cwd rather than tripping the
  // resolver's absolute-path assertion.
  expect(() => {
    require.resolve("this-pkg-does-not-exist-zzz", { paths: ["C:/Users/nope", "C:\\Users\\nope"] });
  }).toThrow();

  // Relative specifiers take the relative-resolution path, which is a separate
  // consumer of options.paths; the same non-absolute entries must not crash it.
  expect(() => {
    require.resolve("./does-not-exist", { paths: ["this_dir_does_not_exist", "C:/Users/nope", "C:\\Users\\nope"] });
  }).toThrow();
});

test("require.resolve resolves relative options.paths entries against cwd (Node compat)", () => {
  const { path: dir, cleanup } = createTempDir("require-resolve-relative-paths", {
    "rel_dir/node_modules/rel-pkg/package.json": JSON.stringify({ name: "rel-pkg", main: "index.js" }),
    "rel_dir/node_modules/rel-pkg/index.js": "module.exports = 'rel-pkg';",
  });

  const prevCwd = process.cwd();
  try {
    // Node's Module._nodeModulePaths does path.resolve(from), so a relative
    // paths entry is anchored at process.cwd().
    process.chdir(dir);
    const resolved = require.resolve("rel-pkg", { paths: ["rel_dir"] });
    expect(resolved).toBe(resolve(dir, "rel_dir/node_modules/rel-pkg/index.js"));
  } finally {
    process.chdir(prevCwd);
    cleanup();
  }
});
