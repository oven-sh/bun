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

// A lookup with options.paths caches the listing of each entry. A file or
// package created after a miss has to be found by the next call, as in Node.
// https://github.com/oven-sh/bun/issues/47457
function resolveOrCode(fn) {
  try {
    return fn();
  } catch (e) {
    return e.code;
  }
}

test("require.resolve with options.paths finds a relative file created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-file", { "package.json": "{}" });
  try {
    const paths = [join(dir, ".nx/installation"), dir];
    expect(resolveOrCode(() => require.resolve("./inference.cjs", { paths }))).toBe("MODULE_NOT_FOUND");
    writeFileSync(join(dir, "inference.cjs"), "exports.x = 1;");
    expect(require.resolve("./inference.cjs", { paths })).toBe(join(dir, "inference.cjs"));
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a directory index created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-index", { "package.json": "{}" });
  try {
    expect(resolveOrCode(() => require.resolve("./late", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "late"));
    writeFileSync(join(dir, "late/index.js"), "exports.x = 1;");
    expect(require.resolve("./late", { paths: [dir] })).toBe(join(dir, "late/index.js"));
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a file in an entry directory created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-entry", { "package.json": "{}" });
  try {
    const entry = join(dir, "plugins/local");
    expect(resolveOrCode(() => require.resolve("./late.cjs", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(entry, "late.cjs"), "exports.x = 1;");
    expect(require.resolve("./late.cjs", { paths: [entry] })).toBe(join(entry, "late.cjs"));
  } finally {
    cleanup();
  }
});

for (const name of ["late-pkg-47457", "@late-scope/pkg-47457"]) {
  test(`require.resolve with options.paths finds ${name} installed after a miss`, () => {
    const { path: dir, cleanup } = createTempDir("paths-late-package", { "package.json": "{}" });
    try {
      expect(resolveOrCode(() => require.resolve(name, { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      mkdirSync(join(dir, "node_modules", name), { recursive: true });
      writeFileSync(join(dir, "node_modules", name, "index.js"), "exports.x = 1;");
      expect(require.resolve(name, { paths: [dir] })).toBe(join(dir, "node_modules", name, "index.js"));
    } finally {
      cleanup();
    }
  });
}

test("require.resolve with options.paths finds a package added to an existing node_modules after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-package-existing", {
    "package.json": "{}",
    "node_modules/already-here/index.js": "exports.x = 1;",
  });
  try {
    expect(resolveOrCode(() => require.resolve("late-pkg2-47457", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "node_modules/late-pkg2-47457"));
    writeFileSync(join(dir, "node_modules/late-pkg2-47457/index.js"), "exports.x = 1;");
    expect(require.resolve("late-pkg2-47457", { paths: [dir] })).toBe(
      join(dir, "node_modules/late-pkg2-47457/index.js"),
    );
  } finally {
    cleanup();
  }
});

test("Module._resolveFilename with a null parent and options.paths finds a file created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-null-parent", { "package.json": "{}" });
  try {
    const opts = { paths: [dir] };
    expect(resolveOrCode(() => Module._resolveFilename("./late.cjs", null, false, opts))).toBe("MODULE_NOT_FOUND");
    expect(resolveOrCode(() => Module._resolveFilename("late-null-47457", null, false, opts))).toBe("MODULE_NOT_FOUND");
    writeFileSync(join(dir, "late.cjs"), "exports.x = 1;");
    mkdirSync(join(dir, "node_modules/late-null-47457"), { recursive: true });
    writeFileSync(join(dir, "node_modules/late-null-47457/index.js"), "exports.x = 1;");
    expect(Module._resolveFilename("./late.cjs", null, false, opts)).toBe(join(dir, "late.cjs"));
    expect(Module._resolveFilename("late-null-47457", null, false, opts)).toBe(
      join(dir, "node_modules/late-null-47457/index.js"),
    );
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds an absolute path created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-absolute", { "package.json": "{}" });
  try {
    const abs = join(dir, "late.cjs");
    expect(resolveOrCode(() => require.resolve(abs, { paths: [join(dir, "elsewhere")] }))).toBe("MODULE_NOT_FOUND");
    writeFileSync(abs, "exports.x = 1;");
    expect(require.resolve(abs, { paths: [join(dir, "elsewhere")] })).toBe(abs);
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths still misses a file that does not exist", () => {
  const { path: dir, cleanup } = createTempDir("paths-real-miss", {
    "package.json": "{}",
    "other.cjs": "",
    "dir-no-index/readme.txt": "",
    "dir-no-main/package.json": JSON.stringify({ main: "missing.js" }),
    "node_modules/installed/index.js": "",
  });
  try {
    for (let i = 0; i < 3; i++) {
      expect(resolveOrCode(() => require.resolve("./missing.cjs", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      expect(resolveOrCode(() => require.resolve("./dir-no-index", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      expect(resolveOrCode(() => require.resolve("./dir-no-main", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      expect(resolveOrCode(() => require.resolve("missing-pkg-47457", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      expect(resolveOrCode(() => require.resolve("installed/missing.js", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    }
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds an index created later in a known directory", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-index-known", {
    "package.json": "{}",
    "late/readme.txt": "",
  });
  try {
    expect(resolveOrCode(() => require.resolve("./late", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    writeFileSync(join(dir, "late/index.js"), "exports.x = 1;");
    expect(require.resolve("./late", { paths: [dir] })).toBe(join(dir, "late/index.js"));
  } finally {
    cleanup();
  }
});

if (isBun) {
  // Bun rewrites `./late.js` to `late.ts`. Node does not.
  test("require.resolve with options.paths finds a .ts file created after a miss of its .js name", () => {
    const { path: dir, cleanup } = createTempDir("paths-late-ts", { "package.json": "{}" });
    try {
      expect(resolveOrCode(() => require.resolve("./late.js", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
      writeFileSync(join(dir, "late.ts"), "export const x = 1;");
      expect(require.resolve("./late.js", { paths: [dir] })).toBe(join(dir, "late.ts"));
    } finally {
      cleanup();
    }
  });
}

test("require.resolve with options.paths finds a require.extensions file created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-extension", { "package.json": "{}" });
  require.extensions[".late47457"] = require.extensions[".js"];
  try {
    expect(resolveOrCode(() => require.resolve("./late", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    writeFileSync(join(dir, "late.late47457"), "exports.x = 1;");
    expect(require.resolve("./late", { paths: [dir] })).toBe(join(dir, "late.late47457"));
  } finally {
    delete require.extensions[".late47457"];
    cleanup();
  }
});

test("require.resolve with options.paths finds a package installed into an ancestor of a missing entry", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-ancestor", { "package.json": "{}" });
  try {
    const entry = join(dir, "plugins");
    expect(resolveOrCode(() => require.resolve("late-ancestor-47457", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "node_modules/late-ancestor-47457"), { recursive: true });
    writeFileSync(join(dir, "node_modules/late-ancestor-47457/index.js"), "exports.x = 1;");
    expect(require.resolve("late-ancestor-47457", { paths: [entry] })).toBe(
      join(dir, "node_modules/late-ancestor-47457/index.js"),
    );
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a package whose directory another lookup cached first", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-cached-first", { "package.json": "{}" });
  try {
    expect(resolveOrCode(() => require.resolve("late-cached-47457", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    const index = join(dir, "node_modules/late-cached-47457/index.js");
    mkdirSync(dirname(index), { recursive: true });
    writeFileSync(index, "exports.x = 1;");
    expect(require.resolve(index)).toBe(index);
    expect(require.resolve("late-cached-47457", { paths: [dir] })).toBe(index);
  } finally {
    cleanup();
  }
});

test("a scoped package installed after a miss with options.paths resolves its hoisted dependency", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-scoped-hoisted", { "package.json": "{}" });
  try {
    expect(resolveOrCode(() => require.resolve("@late-hoist/pkg-47457", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "node_modules/@late-hoist/pkg-47457"), { recursive: true });
    mkdirSync(join(dir, "node_modules/hoisted-47457"));
    writeFileSync(join(dir, "node_modules/hoisted-47457/index.js"), "module.exports = 'hoisted';");
    writeFileSync(
      join(dir, "node_modules/@late-hoist/pkg-47457/index.js"),
      "module.exports = require('hoisted-47457');",
    );
    const resolved = require.resolve("@late-hoist/pkg-47457", { paths: [dir] });
    expect(resolved).toBe(join(dir, "node_modules/@late-hoist/pkg-47457/index.js"));
    expect(require(resolved)).toBe("hoisted");
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a directory named like a file created after a miss", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-dir-js", { "package.json": "{}" });
  try {
    expect(resolveOrCode(() => require.resolve("./three.js", { paths: [dir] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "three.js"));
    writeFileSync(join(dir, "three.js/index.js"), "exports.x = 1;");
    expect(require.resolve("./three.js", { paths: [dir] })).toBe(join(dir, "three.js/index.js"));
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a package installed into an ancestor of an existing entry", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-ancestor-existing", {
    "package.json": "{}",
    "packages/app/package.json": "{}",
  });
  try {
    const entry = join(dir, "packages/app");
    expect(resolveOrCode(() => require.resolve("late-ancestor2-47457", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "node_modules/late-ancestor2-47457"), { recursive: true });
    writeFileSync(join(dir, "node_modules/late-ancestor2-47457/index.js"), "exports.x = 1;");
    expect(require.resolve("late-ancestor2-47457", { paths: [entry] })).toBe(
      join(dir, "node_modules/late-ancestor2-47457/index.js"),
    );
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a package after a miss with a .. in the entry", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-dotdot", { "package.json": "{}", "src/a.js": "" });
  try {
    const entry = `${dir}/src/../lib`;
    mkdirSync(join(dir, "lib"));
    expect(resolveOrCode(() => require.resolve("late-dotdot-47457", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(dir, "lib/node_modules/late-dotdot-47457"), { recursive: true });
    writeFileSync(join(dir, "lib/node_modules/late-dotdot-47457/index.js"), "exports.x = 1;");
    expect(require.resolve("late-dotdot-47457", { paths: [entry] })).toBe(
      join(dir, "lib/node_modules/late-dotdot-47457/index.js"),
    );
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths keeps missing a subpath the nearest package does not export", () => {
  const { path: dir, cleanup } = createTempDir("paths-exports-miss", {
    "package.json": "{}",
    "node_modules/exported-47457/package.json": JSON.stringify({
      name: "exported-47457",
      exports: { ".": "./index.js", "./missing": "./missing.js" },
    }),
    "node_modules/exported-47457/index.js": "",
    "node_modules/exported-47457/missing.js": "",
    "app/package.json": "{}",
    "app/node_modules/exported-47457/package.json": JSON.stringify({
      name: "exported-47457",
      exports: { ".": "./index.js" },
    }),
    "app/node_modules/exported-47457/index.js": "",
  });
  try {
    // Node throws ERR_PACKAGE_PATH_NOT_EXPORTED here, Bun MODULE_NOT_FOUND.
    for (let i = 0; i < 3; i++) {
      const code = resolveOrCode(() => require.resolve("exported-47457/missing", { paths: [join(dir, "app")] }));
      expect(code).toBe(isBun ? "MODULE_NOT_FOUND" : "ERR_PACKAGE_PATH_NOT_EXPORTED");
    }
  } finally {
    cleanup();
  }
});

test("a package installed into a paths entry created two levels deep resolves its hoisted dependency", () => {
  const { path: dir, cleanup } = createTempDir("paths-late-deep-entry-hoisted", {
    "package.json": "{}",
    "node_modules/hoisted2-47457/index.js": "module.exports = 'hoisted';",
  });
  try {
    const entry = join(dir, "plugins/local");
    expect(resolveOrCode(() => require.resolve("deep-pkg-47457", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    expect(resolveOrCode(() => require.resolve("./plugin.cjs", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    mkdirSync(join(entry, "node_modules/deep-pkg-47457"), { recursive: true });
    writeFileSync(join(entry, "node_modules/deep-pkg-47457/index.js"), "module.exports = require('hoisted2-47457');");
    writeFileSync(join(entry, "plugin.cjs"), "module.exports = require('hoisted2-47457');");
    const pkg = require.resolve("deep-pkg-47457", { paths: [entry] });
    expect(pkg).toBe(join(entry, "node_modules/deep-pkg-47457/index.js"));
    expect(require(pkg)).toBe("hoisted");
    const plugin = require.resolve("./plugin.cjs", { paths: [entry] });
    expect(plugin).toBe(join(entry, "plugin.cjs"));
    expect(require(plugin)).toBe("hoisted");
  } finally {
    cleanup();
  }
});

test("require.resolve with options.paths finds a package after the entry's parent was re-read by another lookup", () => {
  const { path: dir, cleanup } = createTempDir("paths-stale-chain", {
    "package.json": "{}",
    "src/a.js": "",
    // A miss from a file in `dir` makes the resolver re-read `dir` itself.
    "x.js": "try { require.resolve('./nope-47457'); } catch {}",
  });
  try {
    const entry = join(dir, "src");
    expect(resolveOrCode(() => require.resolve("chain-pkg-47457", { paths: [entry] }))).toBe("MODULE_NOT_FOUND");
    const index = join(dir, "node_modules/chain-pkg-47457/index.js");
    mkdirSync(dirname(index), { recursive: true });
    writeFileSync(index, "exports.x = 1;");
    expect(require.resolve(index)).toBe(index);
    require(join(dir, "x.js"));
    expect(require.resolve("chain-pkg-47457", { paths: [entry] })).toBe(index);
  } finally {
    cleanup();
  }
});
