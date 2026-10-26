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

// On POSIX a backslash is a file name byte, so `<dir>\` is not `<dir>`. On Windows it is a separator.
// Node splits a `paths` entry at `/` only:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L903-L936
const isPosix = process.platform !== "win32";
const testPosix = isPosix ? test : test.skip;
const todoPosix = isPosix ? test.todo : test.skip;

const resolveWithPaths = {
  "require.resolve": (id, paths) => require.resolve(id, { paths }),
  "Module._resolveFilename": (id, paths) => {
    const parent = new Module("/some/other/directory/file.js");
    parent.filename = "/some/other/directory/file.js";
    parent.paths = Module._nodeModulePaths("/some/other/directory");
    return Module._resolveFilename(id, parent, false, { paths });
  },
};

// The answer for each entry, in this order: the file below `dir`, or the error code.
function resolveEach(resolveFrom, dir, entries) {
  return entries.map(entry => {
    try {
      return [entry, resolveFrom("backslash-paths-pkg", [`${dir}/${entry}`]).slice(dir.length)];
    } catch (e) {
      return [entry, e.code];
    }
  });
}

for (const [api, resolveFrom] of Object.entries(resolveWithPaths)) {
  // `plugins\` does not exist, so a lookup from it starts in the parent of `plugins`. The answer for one spelling
  // must not depend on a lookup of another spelling before it.
  for (const copies of ["one copy", "a second copy in the parent"]) {
    for (const first of ["plugins\\", "plugins"]) {
      testPosix(
        `${api}: a missing plugins\\ and plugins do not answer for each other (${copies}, ${first} first)`,
        () => {
          const files = { "plugins/node_modules/backslash-paths-pkg/index.js": "module.exports = 'nested';" };
          if (copies !== "one copy") files["node_modules/backslash-paths-pkg/index.js"] = "module.exports = 'hoisted';";
          const { path: dir, cleanup } = createTempDir("paths-trailing-backslash", files);

          try {
            const nested = "/plugins/node_modules/backslash-paths-pkg/index.js";
            const fromParent =
              copies === "one copy" ? "MODULE_NOT_FOUND" : "/node_modules/backslash-paths-pkg/index.js";
            const expected = {
              "plugins": nested,
              "plugins/": nested,
              "plugins\\": fromParent,
              "plugins\\\\": fromParent,
              "plugins\\/": fromParent,
              // `plugins/\` does not exist either. Its parent is `plugins`.
              "plugins/\\": nested,
            };
            const order = [first, ...Object.keys(expected).filter(entry => entry !== first)];

            expect(Object.fromEntries(resolveEach(resolveFrom, dir, order))).toEqual(expected);
          } finally {
            cleanup();
          }
        },
      );
    }
  }

  // `plugins\` exists here, and is empty.
  testPosix(`${api}: a lookup from an existing, empty plugins\\ does not change the answer for plugins`, () => {
    const { path: dir, cleanup } = createTempDir("paths-real-backslash", {
      "plugins/node_modules/backslash-paths-pkg/index.js": "module.exports = 1;",
      "plugins\\/.keep": "",
    });

    try {
      const nested = "/plugins/node_modules/backslash-paths-pkg/index.js";
      expect(resolveEach(resolveFrom, dir, ["plugins\\", "plugins", "plugins/"])).toEqual([
        ["plugins\\", "MODULE_NOT_FOUND"],
        ["plugins", nested],
        ["plugins/", nested],
      ]);
    } finally {
      cleanup();
    }
  });

  // `we\ird` exists. Its parent is the root, where the package is. `we\` does not exist.
  for (const entries of [
    ["we\\ird", "we\\ird", "we\\ird/sub", "we\\ird"],
    ["we\\", "we\\ird", "we\\ird", "we\\ird/sub", "we\\ird"],
  ]) {
    testPosix(`${api}: a directory with a backslash in its name gives one answer (${entries[0]} first)`, () => {
      const { path: dir, cleanup } = createTempDir("paths-inner-backslash", {
        "node_modules/backslash-paths-pkg/index.js": "module.exports = 1;",
        "we\\ird/sub/.keep": "",
      });

      try {
        const hoisted = "/node_modules/backslash-paths-pkg/index.js";
        expect(resolveEach(resolveFrom, dir, entries)).toEqual(entries.map(entry => [entry, hoisted]));
      } finally {
        cleanup();
      }
    });
  }

  // Not fixed: Bun joins `plugins\` and `node_modules` with the backslash read as a separator, so the lookup
  // continues in `plugins`.
  todoPosix(`${api}: a lookup from an existing plugins\\ finds the package of plugins\\`, () => {
    const { path: dir, cleanup } = createTempDir("paths-real-backslash-pkg", {
      "plugins/node_modules/backslash-paths-pkg/index.js": "module.exports = 1;",
      "plugins\\/node_modules/backslash-paths-pkg/index.js": "module.exports = 2;",
    });

    try {
      expect(resolveEach(resolveFrom, dir, ["plugins\\", "plugins"])).toEqual([
        ["plugins\\", "/plugins\\/node_modules/backslash-paths-pkg/index.js"],
        ["plugins", "/plugins/node_modules/backslash-paths-pkg/index.js"],
      ]);
    } finally {
      cleanup();
    }
  });
}

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
