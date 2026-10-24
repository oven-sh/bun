// Use bun:test in Bun, or node:test in Node.js
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { throws } from "node:assert/strict";
import { tmpdir } from "os";
import { dirname, join, resolve, toNamespacedPath } from "path";
import { fileURLToPath, pathToFileURL } from "url";

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

(process.platform === "win32" ? test : test.skip)(
  "Windows namespaced paths preserve Node filesystem resolution",
  () => {
    const { path: dir, cleanup } = createTempDir("namespaced-module", {
      "package.json": JSON.stringify({ type: "commonjs" }),
      "parent.cjs": `module.exports = {
      filename: __filename,
      dirname: __dirname,
      child: require("./child.cjs"),
      resolvedChild: require.resolve("./child.cjs"),
    };`,
      "child.cjs": "module.exports = { value: 42 };",
      "extension.js": "module.exports = 42;",
      "package/package.json": JSON.stringify({ main: "entry.js" }),
      "package/entry.js": "module.exports = 42;",
    });
    try {
      const plain = join(dir, "parent.cjs");
      const namespaced = toNamespacedPath(plain);
      expect(require.resolve(plain)).toBe(plain);
      const ordinary = require(plain);
      const fromPlain = Module.createRequire(plain);
      expect(fromPlain.resolve("./child.cjs")).toBe(join(dir, "child.cjs"));
      expect(fromPlain("./child.cjs")).toBe(ordinary.child);
      const fromNamespace = Module.createRequire(namespaced);
      if (namespaced.startsWith("\\\\?\\UNC\\")) {
        // Run the same fixture with TMP/TEMP on an SMB share for UNC coverage.
        // Node 24's realpath root probe fails before traversing an existing module.
        const rootError = { code: "EISDIR", syscall: "lstat", path: "UNC" };
        for (const request of [
          namespaced,
          toNamespacedPath(join(dir, "extension")),
          toNamespacedPath(join(dir, "package")),
        ]) {
          throws(() => require.resolve(request), rootError);
          throws(() => require(request), rootError);
        }
        for (const request of ["./child.cjs", "./extension", "./package"]) {
          throws(() => fromNamespace.resolve(request), rootError);
          throws(() => fromNamespace(request), rootError);
        }
        throws(() => require.resolve(toNamespacedPath(join(dir, "missing.cjs"))), { code: "MODULE_NOT_FOUND" });
        throws(() => require(toNamespacedPath(join(dir, "missing.cjs"))), { code: "MODULE_NOT_FOUND" });
        throws(() => fromNamespace.resolve("./missing.cjs"), { code: "MODULE_NOT_FOUND" });
        throws(() => fromNamespace("./missing.cjs"), { code: "MODULE_NOT_FOUND" });
        return;
      }
      expect(require.resolve(namespaced)).toBe(namespaced);
      const loaded = require(namespaced);
      expect(loaded === ordinary).toBe(false);
      expect(loaded.child === ordinary.child).toBe(false);
      expect(require.cache[plain].exports).toBe(ordinary);
      expect(require(namespaced)).toBe(loaded);
      expect(require.cache[namespaced].exports).toBe(loaded);
      expect(loaded.filename).toBe(namespaced);
      expect(loaded.dirname).toBe(dirname(namespaced));
      expect(loaded.resolvedChild).toBe(toNamespacedPath(join(dir, "child.cjs")));
      expect(loaded.child).toEqual({ value: 42 });
      expect(fromNamespace.resolve("./child.cjs")).toBe(loaded.resolvedChild);
      expect(fromNamespace("./child.cjs")).toBe(loaded.child);
    } finally {
      cleanup();
    }
  },
);

(process.platform === "win32" ? test : test.skip)(
  "Windows ordinary paths and file URLs load the same CommonJS module",
  async () => {
    const { path: dir, cleanup } = createTempDir("module-file-url", {
      "package.json": JSON.stringify({ type: "commonjs" }),
      "parent.cjs": 'module.exports = { filename: __filename, child: require("./child.cjs") };',
      "child.cjs": "module.exports = { value: 42 };",
      "module.mjs": 'import child from "./child.cjs"; export { child }; export const url = import.meta.url;',
    });
    try {
      const plain = join(dir, "parent.cjs");
      const url = pathToFileURL(plain);
      const urlPath = fileURLToPath(url);
      const loaded = require(urlPath);
      expect(loaded.filename).toBe(urlPath);
      expect(loaded.child).toEqual({ value: 42 });
      for (const parent of [urlPath, url.href, url, pathToFileURL(toNamespacedPath(plain))]) {
        const fromURL = Module.createRequire(parent);
        expect(fromURL.resolve("./parent.cjs")).toBe(urlPath);
        expect(fromURL("./parent.cjs")).toBe(loaded);
        expect(fromURL("./child.cjs")).toBe(loaded.child);
      }
      expect((await import(url.href)).default).toBe(loaded);
      expect((await import(pathToFileURL(toNamespacedPath(plain)).href)).default).toBe(loaded);
      const esmURL = pathToFileURL(join(dir, "module.mjs"));
      const esm = await import(esmURL.href);
      expect(esm.url).toBe(esmURL.href);
      expect(esm.child).toBe(loaded.child);
    } finally {
      cleanup();
    }
  },
);

(process.platform === "win32" ? test : test.skip)(
  "createRequire preserves UNC parents when resolution is overridden",
  () => {
    const { path: dir, cleanup } = createTempDir("unc-parent-override", {
      "target.cjs": "module.exports = { value: 42 };",
    });
    const original = Module._resolveFilename;
    try {
      const target = join(dir, "target.cjs");
      const unc = "\\\\server\\share\\parent.cjs";
      const parents = [unc, pathToFileURL(unc), pathToFileURL(unc).href, toNamespacedPath(unc)];
      const loaded = require(target);
      let parentFilename;
      Module._resolveFilename = function (specifier, parent, ...args) {
        if (specifier === "unc-parent-target") {
          parentFilename = parent.filename;
          return target;
        }
        return Reflect.apply(original, this, [specifier, parent, ...args]);
      };
      for (const parent of parents) {
        const fromUNC = Module.createRequire(parent);
        const filename = typeof parent === "string" && !parent.startsWith("file:") ? parent : fileURLToPath(parent);
        expect(fromUNC.resolve("unc-parent-target")).toBe(target);
        expect(parentFilename).toBe(filename);
        expect(fromUNC("unc-parent-target")).toBe(loaded);
        expect(parentFilename).toBe(filename);
      }
    } finally {
      Module._resolveFilename = original;
      cleanup();
    }
  },
);

(process.platform === "win32" ? test : test.skip)("Windows namespaced native addon keys are not queries", () => {
  const { path: dir, cleanup } = createTempDir("namespaced-addon", { "addon.node": "native addon fixture" });
  const original = process.dlopen;
  try {
    const namespaced = toNamespacedPath(join(dir, "addon.node"));
    let calls = 0;
    process.dlopen = (module, filename) => {
      calls++;
      expect(filename).toBe(namespaced);
      expect(module.id).toBe(namespaced);
      module.exports.loaded = true;
    };
    if (namespaced.startsWith("\\\\?\\UNC\\")) {
      throws(() => require(namespaced), { code: "EISDIR", syscall: "lstat", path: "UNC" });
      expect(calls).toBe(0);
      return;
    }
    const loaded = require(namespaced);
    expect(loaded).toEqual({ loaded: true });
    expect(require(namespaced)).toBe(loaded);
    expect(require.cache[namespaced].exports).toBe(loaded);
    expect(calls).toBe(1);
  } finally {
    process.dlopen = original;
    cleanup();
  }
});

for (const spelling of ["backslash", "forward", "mixed", "unc", "unc-forward", "unc-mixed", "ordinary-unc"]) {
  (process.platform === "win32" ? test : test.skip)(
    "Windows namespaced addon overrides preserve " + spelling + " cache keys",
    () => {
      const { path: dir, cleanup } = createTempDir("namespaced-addon-override", {
        "addon.node": "native addon fixture",
      });
      const unc = "\\\\server\\share\\" + spelling + "-addon.node";
      const namespaced = toNamespacedPath(spelling.includes("unc") ? unc : join(dir, "addon.node"));
      const key =
        spelling === "ordinary-unc"
          ? unc
          : spelling.endsWith("forward")
            ? namespaced.replaceAll("\\", "/")
            : spelling.endsWith("mixed")
              ? "\\/?/" + namespaced.slice(4)
              : namespaced;
      const alias = "namespaced-addon-override-" + spelling;
      const originalResolve = Module._resolveFilename;
      const originalDlopen = process.dlopen;
      try {
        Module._resolveFilename = function (specifier, ...args) {
          return specifier === alias ? key : Reflect.apply(originalResolve, this, [specifier, ...args]);
        };
        let calls = 0;
        process.dlopen = (module, filename) => {
          calls++;
          expect(module.id).toBe(key);
          expect(toNamespacedPath(filename)).toBe(namespaced);
          module.exports = { loaded: true };
        };
        expect(require.resolve(alias)).toBe(key);
        const loaded = require(alias);
        expect(loaded).toEqual({ loaded: true });
        expect(require(alias)).toBe(loaded);
        expect(require.cache[key].exports).toBe(loaded);
        expect(calls).toBe(1);
      } finally {
        Module._resolveFilename = originalResolve;
        process.dlopen = originalDlopen;
        delete require.cache[key];
        cleanup();
      }
    },
  );
}
