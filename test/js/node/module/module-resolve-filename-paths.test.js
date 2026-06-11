// Use bun:test in Bun, or node:test in Node.js
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, relative, resolve } from "path";

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

test("require.resolve throws ERR_INVALID_ARG_TYPE for non-string options.paths entries", () => {
  let err;
  try {
    require.resolve("nonexistent-pkg-for-paths-test", { paths: [ArrayBuffer] });
  } catch (e) {
    err = e;
  }
  expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
  expect(err.message).toBe('The "paths[0]" argument must be of type string. Received function ArrayBuffer');

  err = undefined;
  try {
    require.resolve("nonexistent-pkg-for-paths-test", { paths: [{}] });
  } catch (e) {
    err = e;
  }
  expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
  expect(err.message).toBe('The "paths[0]" argument must be of type string. Received an instance of Object');
});

test("require with non-string options.paths entries does not crash", () => {
  let err;
  try {
    require("nonexistent-pkg-for-paths-test", { paths: [ArrayBuffer, ArrayBuffer, Set] });
  } catch (e) {
    err = e;
  }
  // Node ignores the second argument to require(); Bun forwards options.paths
  // to the resolver, so the non-string entry is rejected.
  expect(err.code).toBe(isBun ? "ERR_INVALID_ARG_TYPE" : "MODULE_NOT_FOUND");
});

test("Module._resolveFilename throws ERR_INVALID_ARG_TYPE for non-string options.paths entries", () => {
  const fakeParent = new Module("/some/other/directory/file.js");
  fakeParent.filename = "/some/other/directory/file.js";
  fakeParent.paths = Module._nodeModulePaths("/some/other/directory");

  let err;
  try {
    Module._resolveFilename("nonexistent-pkg-for-paths-test", fakeParent, false, { paths: [5] });
  } catch (e) {
    err = e;
  }
  expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
  expect(err.message).toBe('The "paths[0]" argument must be of type string. Received type number (5)');
});

test("require.resolve resolves relative options.paths entries against the working directory", () => {
  const { path: dir, cleanup } = createTempDir("relative-paths-entry", {
    "node_modules/relative-paths-pkg/package.json": JSON.stringify({ name: "relative-paths-pkg", main: "index.js" }),
    "node_modules/relative-paths-pkg/index.js": "module.exports = 'relative-paths-pkg';",
  });

  try {
    const relDir = relative(process.cwd(), dir);
    const resolved = require.resolve("relative-paths-pkg", { paths: [relDir] });
    expect(resolved).toBe(resolve(dir, "node_modules/relative-paths-pkg/index.js"));
  } finally {
    cleanup();
  }
});

test("require.resolve does not crash on relative or empty options.paths entries", () => {
  for (const entry of ["some-relative-dir", "", "."]) {
    let err;
    try {
      require.resolve("nonexistent-pkg-for-paths-test", { paths: [entry] });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("MODULE_NOT_FOUND");
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
