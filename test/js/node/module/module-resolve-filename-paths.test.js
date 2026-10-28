// Use bun:test in Bun, or node:test in Node.js
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import Module from "module";
import { tmpdir } from "os";
import { dirname, join, parse, relative, resolve, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Worker as ThreadWorker } from "worker_threads";

// Detect runtime and import appropriate test framework
const isBun = typeof Bun !== "undefined";
let test, expect, harness;

if (isBun) {
  ({ test, expect } = await import("bun:test"));
  harness = await import("harness");
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

// Node reads the package of the calling module for two kinds of request: a "#" request, which
// its "imports" answer, and its own name, which its "exports" answer. An `options.paths` entry
// only says where the search of node_modules directories starts.
// https://nodejs.org/api/modules.html#all-together
const scopeFiles = {
  // A node_modules directory at the root also keeps Bun's auto-install off.
  "node_modules/entry-pkg/index.js": "module.exports = 'installed';",
  // The entry is a package that has the requested name, "exports" and "imports".
  "entry/package.json": JSON.stringify({
    name: "entry-pkg",
    exports: "./entry-main.js",
    imports: { "#dep": "./entry-dep.js" },
  }),
  "entry/entry-main.js": "module.exports = 'entry-main';",
  "entry/entry-dep.js": "module.exports = 'entry-dep';",
  "entry/node_modules/dep/index.js": "",
  // What a search from the entry finds when the package of the calling module does not answer.
  "entry/node_modules/caller-pkg/index.js": "",
  "entry/node_modules/caller-pkg/gone.js": "",
  "entry/node_modules/#gone/index.js": "",
  "entry/node_modules/plain-pkg/index.js": "",
  // What a search from the calling module finds, and a search from the entries does not.
  "caller/node_modules/dep/index.js": "",
  "plain/node_modules/plain-pkg/index.js": "",
  "plain/node_modules/#dep/index.js": "",
  // A calling module in `caller/` is in the package `caller-pkg`. "gone" is a file that is not there.
  "caller/package.json": JSON.stringify({
    name: "caller-pkg",
    exports: { ".": "./caller-main.js", "./package.json": "./package.json", "./gone": "./gone.js" },
    imports: { "#dep": "./caller-dep.js", "#gone": "./gone.js" },
  }),
  "caller/caller-main.js": "module.exports = 'caller-main';",
  "caller/caller-dep.js": "module.exports = 'caller-dep';",
  // A calling module in `plain/` is in a package with a name and without "exports" and "imports".
  "plain/package.json": JSON.stringify({ name: "plain-pkg" }),
};

// The entry points that take `options.paths`, for a calling module at `file`.
function resolversFrom(file) {
  const parent = new Module(file);
  parent.filename = file;
  return {
    "createRequire().resolve": (request, options) => Module.createRequire(file).resolve(request, options),
    "Module._resolveFilename": (request, options) => Module._resolveFilename(request, parent, false, options),
  };
}

// Runs [request, paths, expected] rows through each entry point. One line per call, so that a
// failure names the call. Node keeps a self-reference hit in Module._pathCache under the request
// and the lookup directories, without the parent: the rows of one `dir` have one calling module.
function expectRows(dir, resolvers, rows) {
  const below = path => relative(dir, path).split(sep).join("/");
  const lines = valueOf =>
    rows.flatMap(([request, paths, expected]) =>
      Object.keys(resolvers).map(
        name =>
          `${name}(${JSON.stringify(request)}, { paths: ${JSON.stringify(paths.map(below))} }) => ` +
          valueOf(resolvers[name], request, paths, expected),
      ),
    );
  const resolved = (resolveWith, request, paths) => {
    try {
      return below(resolveWith(request, { paths }));
    } catch (error) {
      return error.code;
    }
  };
  expect(lines(resolved)).toEqual(lines((resolveWith, request, paths, expected) => expected));
}

test("options.paths: the package of the calling module answers its own name and its #imports", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-caller", scopeFiles);
  const entry = join(dir, "entry");

  try {
    expectRows(dir, resolversFrom(join(dir, "caller", "file.js")), [
      // With any entries. The copy of the package below the entry is not read.
      ["caller-pkg", [entry], "caller/caller-main.js"],
      ["caller-pkg", [], "caller/caller-main.js"],
      ["caller-pkg/package.json", [entry], "caller/package.json"],
      ["#dep", [entry], "caller/caller-dep.js"],
      ["#dep", [], "caller/caller-dep.js"],
      // Its answer is final: the entries are not searched for what it names and does not have.
      ["caller-pkg/gone", [entry], "MODULE_NOT_FOUND"],
      ["#gone", [entry], "MODULE_NOT_FOUND"],
      // Any other request is searched from the entries only.
      ["entry-pkg", [entry], "node_modules/entry-pkg/index.js"],
      ["dep", [entry], "entry/node_modules/dep/index.js"],
      ["dep", [], "MODULE_NOT_FOUND"],
    ]);
  } finally {
    cleanup();
  }
});

test("options.paths: the package of an entry answers nothing", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-entry", scopeFiles);
  const entry = join(dir, "entry");
  const installed = "node_modules/entry-pkg/index.js";
  const missing = "MODULE_NOT_FOUND";

  try {
    expectRows(dir, resolversFrom(join(dir, "plain", "file.js")), [
      // The name of the entry's package is not a self-reference.
      ["entry-pkg", [entry], installed],
      // An entry that is a node_modules directory, a file, or a directory that does not exist.
      ["entry-pkg", [join(entry, "node_modules")], installed],
      ["entry-pkg", [join(entry, "entry-main.js")], installed],
      ["entry-pkg", [join(entry, "nowhere")], installed],
      // Its "imports" are not read.
      ["#dep", [entry], missing],
      ["#dep", [], missing],
      // No entry makes a package the caller's.
      ["caller-pkg", [join(dir, "caller")], missing],
      ["caller-pkg", [entry], "entry/node_modules/caller-pkg/index.js"],
      ["#dep", [join(dir, "caller")], missing],
      // The package of this calling module has no "exports": its name is no self-reference.
      ["plain-pkg", [entry], "entry/node_modules/plain-pkg/index.js"],
      ["plain-pkg", [], missing],
    ]);
  } finally {
    cleanup();
  }
});

// Node's trySelfParentPath() and getNearestParentPackageJSON(): the package is the one of the
// nearest package.json above `parent.filename`, and not one above a node_modules directory.
test("options.paths: which package a parent is in", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-parent", {
    ...scopeFiles,
    // A file below a node_modules directory that has no package.json of its own is in no package.
    "caller/node_modules/.cache/generated.js": "",
    // An installed package, and in it a directory with a package.json that has no name.
    "caller/node_modules/@scope/tool/package.json": JSON.stringify({
      name: "@scope/tool",
      exports: "./tool-main.js",
      imports: { "#dep": "./tool-dep.js" },
    }),
    "caller/node_modules/@scope/tool/tool-main.js": "",
    "caller/node_modules/@scope/tool/tool-dep.js": "",
    "caller/node_modules/@scope/tool/dist/cjs/package.json": JSON.stringify({ type: "commonjs" }),
    // A package in the package of the calling module.
    "caller/nested/package.json": JSON.stringify({ name: "nested-pkg" }),
    // A package.json that is a directory is not one.
    "caller/lib/package.json/keep": "",
  });
  const file = join(dir, "caller", "file.js");
  const tool = join(dir, "caller", "node_modules", "@scope", "tool");
  const withFilename = new Module(file);
  withFilename.filename = file;
  const withUrlFilename = new Module(file);
  withUrlFilename.filename = pathToFileURL(file).href;
  const cwd = process.cwd();
  const resolveFilename = Module._resolveFilename;
  // Each call has an entry of its own, which does not exist: no Module._pathCache key is used twice.
  let entries = 0;
  const line = (label, request, resolveWith) => {
    const paths = [join(dir, `entry-${entries++}`)];
    let result;
    try {
      result = relative(dir, resolveWith(request, { paths })).split(sep).join("/");
    } catch (error) {
      result = error.code;
    }
    return `${label}: ${request} => ${result}`;
  };
  const fromParent = parent => (request, options) => Module._resolveFilename(request, parent, false, options);
  const fromRequire = createdFor => (request, options) => Module.createRequire(createdFor).resolve(request, options);
  const main = "caller/caller-main.js";
  const dep = "caller/caller-dep.js";
  const missing = "MODULE_NOT_FOUND";
  const lines = [];
  const expected = [];
  // [label, request, resolver, result]
  const run = rows => {
    for (const [label, request, resolveWith, result] of rows) {
      lines.push(line(label, request, resolveWith));
      expected.push(`${label}: ${request} => ${result}`);
    }
  };

  try {
    run([
      ["{ filename }", "caller-pkg", fromParent({ filename: file }), main],
      ["{ filename }", "#dep", fromParent({ filename: file }), dep],
      ["a Module with a filename", "caller-pkg", fromParent(withFilename), main],
      ["a Module without a filename", "caller-pkg", fromParent(new Module(file)), missing],
      ["{ id }", "caller-pkg", fromParent({ id: file }), missing],
      ["{ id }", "#dep", fromParent({ id: file }), missing],
      ["a string", "caller-pkg", fromParent(file), missing],
      ["{}", "caller-pkg", fromParent({}), missing],
      ["null", "caller-pkg", fromParent(null), missing],
      ["undefined", "caller-pkg", fromParent(undefined), missing],
      // The filename is read as a path. A URL is not the path of the file. On Windows, Node
      // reads it as a path below the working directory.
      ["{ filename: a file URL }", "caller-pkg", fromParent({ filename: pathToFileURL(file).href }), missing],
      ["{ filename: a file URL }", "#dep", fromParent({ filename: pathToFileURL(file).href }), missing],
      ["a Module with a file URL as filename", "caller-pkg", fromParent(withUrlFilename), missing],
      // A filename that ends in a separator names that directory.
      ["{ filename: a directory }", "caller-pkg", fromParent({ filename: join(dir, "caller") + sep }), main],
      ["{ filename: a directory }", "#dep", fromParent({ filename: join(dir, "caller") + sep }), dep],
      // Only the separator of the platform does that. On Windows a "/" at the end is dropped,
      // and the filename names a file in the directory above.
      [
        "{ filename: a directory and a slash }",
        "caller-pkg",
        fromParent({ filename: join(dir, "caller") + "/" }),
        sep === "/" ? main : missing,
      ],
      [
        "{ filename: the directory of a package in the package }",
        "caller-pkg",
        fromParent({ filename: join(dir, "caller", "nested") + sep }),
        missing,
      ],
      [
        "createRequire(a path that does not exist)",
        "caller-pkg",
        fromRequire(join(dir, "caller", "no", "file.js")),
        main,
      ],
      ["createRequire(a directory)", "caller-pkg", fromRequire(join(dir, "caller") + sep), main],
      ["createRequire(a file URL)", "#dep", fromRequire(pathToFileURL(file)), dep],
      // The nearest package.json is above the directory of the file.
      ["in a directory of the package", "caller-pkg", fromRequire(join(dir, "caller", "src", "file.js")), main],
      ["beside a package.json that is a directory", "#dep", fromRequire(join(dir, "caller", "lib", "file.js")), dep],
      [
        "below node_modules",
        "caller-pkg",
        fromRequire(join(dir, "caller", "node_modules", ".cache", "generated.js")),
        missing,
      ],
      [
        "below a node_modules that does not exist",
        "caller-pkg",
        fromRequire(join(dir, "caller", "no", "node_modules", "file.js")),
        missing,
      ],
      [
        "in an installed package",
        "@scope/tool",
        fromRequire(join(tool, "file.js")),
        "caller/node_modules/@scope/tool/tool-main.js",
      ],
      [
        "in an installed package",
        "#dep",
        fromRequire(join(tool, "file.js")),
        "caller/node_modules/@scope/tool/tool-dep.js",
      ],
      [
        "below a package.json without a name",
        "@scope/tool",
        fromRequire(join(tool, "dist", "cjs", "file.js")),
        missing,
      ],
      ["below a package.json without a name", "#dep", fromRequire(join(tool, "dist", "cjs", "file.js")), missing],
    ]);

    // A replacement that calls the original gets the parent module and passes it on.
    Module._resolveFilename = function (request, parent, isMain, options) {
      return resolveFilename.call(this, request, parent, isMain, options);
    };
    run([["through a replaced Module._resolveFilename", "caller-pkg", fromRequire(file), main]]);
    Module._resolveFilename = resolveFilename;

    process.chdir(join(dir, "caller"));
    const root = parse(process.cwd()).root;
    run([
      // A file in the root of the filesystem is in no package, and not in the one of the
      // working directory.
      ["{ filename: a file in the root }", "caller-pkg", fromParent({ filename: join(root, "virtual.js") }), missing],
      ["createRequire(the root)", "#dep", fromRequire(root), missing],
      // A file in the working directory is in the package of that directory.
      ["{ filename } in caller/", "caller-pkg", fromParent({ filename: join(dir, "caller", "virtual.js") }), main],
      ["{ filename } in caller/", "#dep", fromParent({ filename: join(dir, "caller", "virtual.js") }), dep],
      // A parent without a filename does not get the package of the working directory.
      ["{ filename: '' } in caller/", "#dep", fromParent({ filename: "" }), missing],
      ["a Module without a filename in caller/", "caller-pkg", fromParent(new Module(file)), missing],
      // But for two ids: then the parent is in the package of the working directory. For
      // "internal/preload" that package does not answer a "#" request.
      ["{ id: '<repl>' } in caller/", "caller-pkg", fromParent({ id: "<repl>" }), main],
      ["{ id: '<repl>' } in caller/", "#dep", fromParent({ id: "<repl>" }), dep],
      ["{ filename: '', id: '<repl>' } in caller/", "caller-pkg", fromParent({ filename: "", id: "<repl>" }), main],
      ["{ id: 'internal/preload' } in caller/", "caller-pkg", fromParent({ id: "internal/preload" }), main],
      ["{ id: 'internal/preload' } in caller/", "#dep", fromParent({ id: "internal/preload" }), missing],
    ]);
    if (isBun) {
      // Node reads a relative filename from the working directory, and the result depends on the
      // platform. In Bun a filename that is not an absolute path is in no package.
      run([
        ["{ filename: 'virtual.js' } in caller/", "caller-pkg", fromParent({ filename: "virtual.js" }), missing],
        ["{ filename: './virtual.js' } in caller/", "#dep", fromParent({ filename: "./virtual.js" }), missing],
        ["{ filename: 'bun:main' } in caller/", "caller-pkg", fromParent({ filename: "bun:main" }), missing],
        // A filename with a NUL names no file.
        [
          "{ filename: with a NUL }",
          "caller-pkg",
          fromParent({ filename: join(dir, "caller") + "\0" + sep + "f.js" }),
          missing,
        ],
      ]);
    }

    expect(lines).toEqual(expected);
  } finally {
    Module._resolveFilename = resolveFilename;
    process.chdir(cwd);
    cleanup();
  }
});

// After a miss of a bare request, Bun reads `<calling directory>/<request>/..` again and searches
// once more. With `options.paths` that finds something new when the search of an entry starts
// there. For a request of one segment that is the calling module's directory, or the nearest
// one above it that exists.
test("options.paths finds what was created after the calling module's directory was read", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-late", {
    "relative/first.js": "",
    "directory/file.js": "",
    "node_modules-to-be/file.js": "",
    "file/file.js": "",
    "missing/file.js": "",
    "two-segments/file.js": "",
    "two-segments/sub/keep.js": "",
    "scoped/file.js": "",
    "scoped/@s/keep.js": "",
  });
  const found = (shape, request, paths) => {
    try {
      return relative(join(dir, shape), Module.createRequire(join(dir, shape, "file.js")).resolve(request, { paths }));
    } catch (error) {
      return error.code;
    }
  };
  // [directory of the calling module, the entry in it, the request, the file that is created]
  const shapes = [
    ["directory", join(dir, "directory")],
    ["node_modules-to-be", join(dir, "node_modules-to-be", "node_modules")],
    ["file", join(dir, "file", "file.js")],
    ["missing", join(dir, "missing", "nowhere")],
    // The directory of the calling module does not exist yet.
    ["absent", join(dir, "absent")],
    // A request of two segments: `<calling directory>/<first segment>` is the entry.
    ["two-segments", join(dir, "two-segments", "sub"), "sub/late", "sub/node_modules/sub/late.js"],
    ["scoped", join(dir, "scoped", "@s"), "@s/late", "@s/node_modules/@s/late/index.js"],
  ].map(([shape, entry, request = "late-pkg", late = "node_modules/late-pkg/index.js"]) => ({
    shape,
    entry,
    request,
    late,
  }));

  try {
    expect(found("relative", "./first.js", [join(dir, "relative")])).toBe("first.js");
    writeFileSync(join(dir, "relative", "second.js"), "");
    expect(found("relative", "./second.js", [join(dir, "relative")])).toBe("second.js");

    const before = shapes.map(({ shape, entry, request }) => found(shape, request, [entry]));
    for (const { shape, late } of shapes) {
      mkdirSync(dirname(join(dir, shape, late)), { recursive: true });
      writeFileSync(join(dir, shape, late), "");
    }
    const after = shapes.map(({ shape, entry, request }) => found(shape, request, [entry]).split(sep).join("/"));
    expect({ before, after }).toEqual({
      before: shapes.map(() => "MODULE_NOT_FOUND"),
      after: shapes.map(({ late }) => late),
    });
  } finally {
    cleanup();
  }
});

// Node does not read an "exports" or "imports" that is a number or a boolean.
// https://github.com/nodejs/node/blob/v26.3.0/src/node_modules.cc#L178-L221
test('options.paths: a package whose "exports" and "imports" Node does not read claims nothing', () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-unread", {
    "caller/package.json": JSON.stringify({ name: "caller-pkg", exports: 5, imports: true }),
    "entry/node_modules/caller-pkg/index.js": "",
    "entry/node_modules/#dep/index.js": "",
  });

  try {
    expectRows(dir, resolversFrom(join(dir, "caller", "file.js")), [
      ["caller-pkg", [join(dir, "entry")], "entry/node_modules/caller-pkg/index.js"],
      ["#dep", [join(dir, "entry")], "entry/node_modules/#dep/index.js"],
    ]);
  } finally {
    cleanup();
  }
});

// What a worker in `caller/` of `scopeFiles` finds from an entry, sent with `post`.
const workerFinds = post => `
  const paths = [join(process.cwd(), "..", "entry")];
  ${post}(
    ["caller-pkg", "#dep"]
      .map(request => {
        try {
          return relative(process.cwd(), require.resolve(request, { paths }));
        } catch (error) {
          return error.code;
        }
      })
      .join(" "),
  );
`;

// Node names such a worker "[worker eval]" in the working directory. Bun names it with a "blob:"
// URL, and searches from the working directory for it.
test("options.paths: a worker that is made from a string is in the package of the working directory", async () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-worker", scopeFiles);
  const commonjs = `
    const { join, relative } = require("node:path");
    const { parentPort } = require("node:worker_threads");
    ${workerFinds("parentPort.postMessage")}
  `;
  const esm = `
    import { createRequire } from "node:module";
    import { join, relative } from "node:path";
    import { parentPort } from "node:worker_threads";
    const require = createRequire(import.meta.url);
    ${workerFinds("parentPort.postMessage")}
  `;
  const cwd = process.cwd();
  const workers = [];

  try {
    process.chdir(join(dir, "caller"));
    const found = [commonjs, esm].map(code => {
      const worker = new ThreadWorker(code, { eval: true });
      workers.push(worker);
      return new Promise((resolve, reject) => worker.once("message", resolve).once("error", reject));
    });
    expect(await Promise.all(found)).toEqual(["caller-main.js caller-dep.js", "caller-main.js caller-dep.js"]);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
    process.chdir(cwd);
    cleanup();
  }
});

test("options.paths: an error names a parent filename that ends in a separator as it was given", () => {
  const { path: dir, cleanup } = createTempDir("resolve-paths-stack", scopeFiles);
  const filename = join(dir, "caller") + sep;
  let requireStack;

  try {
    Module._resolveFilename("not-installed", { filename }, false, { paths: [join(dir, "entry")] });
  } catch (error) {
    requireStack = error.requireStack;
  } finally {
    cleanup();
  }
  expect(requireStack).toEqual([filename]);
});

if (isBun) {
  // Node ignores a second argument of require().
  test("require(id, { paths }) loads the file that require.resolve(id, { paths }) names", async () => {
    const { path: dir, cleanup } = createTempDir("require-paths-scope", {
      ...scopeFiles,
      "caller/esm.mjs": `
        import { join } from "node:path";
        const paths = [join(import.meta.dir, "..", "entry")];
        export default ["entry-pkg", "caller-pkg", "#dep"].map(request => import.meta.require(request, { paths }));
      `,
    });

    try {
      const fromCaller = Module.createRequire(join(dir, "caller", "file.js"));
      const paths = [join(dir, "entry")];
      // A module whose filename was set to a file URL: the URL is not the path of the module.
      const withUrlFilename = new Module(join(dir, "caller", "file.js"));
      withUrlFilename.filename = pathToFileURL(join(dir, "caller", "file.js")).href;
      expect({
        commonjs: ["entry-pkg", "caller-pkg", "#dep"].map(request => fromCaller(request, { paths })),
        esm: (await import(join(dir, "caller", "esm.mjs"))).default,
        "a file URL as filename": Module.prototype.require.call(withUrlFilename, "caller-pkg", { paths }),
      }).toEqual({
        commonjs: ["installed", "caller-main", "caller-dep"],
        esm: ["installed", "caller-main", "caller-dep"],
        "a file URL as filename": {},
      });
    } finally {
      cleanup();
    }
  });

  // Node has no tsconfig. `options.paths` does not change whose tsconfig Bun reads: the one
  // above the directory that a search starts in. That is an entry, or the calling module when
  // its package claims the request.
  test("options.paths: the tsconfig above the directory that the search starts in answers", () => {
    const aliases = names =>
      JSON.stringify({ compilerOptions: { paths: Object.fromEntries(names.map(name => [name, ["./aliased.js"]])) } });
    const { path: dir, cleanup } = createTempDir("resolve-paths-tsconfig", {
      "caller/package.json": JSON.stringify({ name: "caller-pkg", exports: "./main.js" }),
      "caller/main.js": "",
      "caller/tsconfig.json": aliases(["caller-alias", "caller-pkg"]),
      "caller/aliased.js": "",
      "entry/tsconfig.json": aliases(["entry-alias"]),
      "entry/aliased.js": "",
    });

    try {
      expectRows(dir, resolversFrom(join(dir, "caller", "file.js")), [
        ["entry-alias", [join(dir, "entry")], "entry/aliased.js"],
        ["caller-alias", [join(dir, "entry")], "MODULE_NOT_FOUND"],
        // As without `options.paths`: the alias is read before "exports".
        ["caller-pkg", [join(dir, "entry")], "caller/aliased.js"],
      ]);
    } finally {
      cleanup();
    }
  });

  // The second search is still one of `options.paths`: the package of the calling module is asked
  // again, then the entries. The resolver holds the package.json that it read first.
  test("options.paths: the search after a miss asks the package of the calling module again", () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-retry", {
      "node_modules/keep/index.js": "",
      // The file that "exports" names does not exist.
      "caller/package.json": JSON.stringify({ name: "caller-pkg", exports: "./missing.js" }),
      "caller/node_modules/caller-pkg/index.js": "",
      "entry/node_modules/caller-pkg/index.js": "",
    });

    try {
      const resolvers = {
        "createRequire().resolve": resolversFrom(join(dir, "caller", "file.js"))["createRequire().resolve"],
      };
      expectRows(dir, resolvers, [["caller-pkg", [join(dir, "entry")], "MODULE_NOT_FOUND"]]);
      // The package gets another name, so the request is for the entries now.
      writeFileSync(join(dir, "caller", "package.json"), JSON.stringify({ name: "renamed" }));
      expectRows(dir, resolvers, [["caller-pkg", [join(dir, "entry")], "entry/node_modules/caller-pkg/index.js"]]);
    } finally {
      cleanup();
    }
  });

  // Node throws ERR_PACKAGE_PATH_NOT_EXPORTED here. As without `options.paths`, Bun finds the
  // package.json of a package whose "exports" do not list it.
  test("options.paths: the package of the calling module answers for <its name>/package.json", () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-package-json", {
      "caller/package.json": JSON.stringify({ name: "caller-pkg", exports: "./main.js" }),
      "caller/main.js": "",
      "entry/node_modules/caller-pkg/package.json": "{}",
    });

    try {
      expectRows(dir, resolversFrom(join(dir, "caller", "file.js")), [
        ["caller-pkg/package.json", [join(dir, "entry")], "caller/package.json"],
      ]);
    } finally {
      cleanup();
    }
  });

  test("options.paths: a script in the working directory is in the package of that directory", async () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-eval", scopeFiles);
    const source = `
      const { join, relative } = require("node:path");
      const paths = [join(process.cwd(), "..", "entry")];
      const found = ["caller-pkg", "#dep"].map(request => relative(process.cwd(), require.resolve(request, { paths })));
      console.log(found.join(" "));
      // require() takes any parent, and the id "<repl>" puts it in the working directory.
      console.log(require("node:module").prototype.require.call({ id: "<repl>" }, "caller-pkg", { paths }));
    `;

    try {
      await using proc = Bun.spawn({
        cmd: [harness.bunExe(), "-e", source],
        cwd: join(dir, "caller"),
        env: harness.bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "caller-main.js caller-dep.js\ncaller-main\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      cleanup();
    }
  });

  // Bun names a worker that is made from a "data:" URL with that URL.
  test("options.paths: a worker that is made from a data: URL is in the package of the working directory", async () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-data-worker", scopeFiles);
    const code = `
      const { join, relative } = require("node:path");
      ${workerFinds("postMessage")}
    `;
    const cwd = process.cwd();
    let worker;

    try {
      process.chdir(join(dir, "caller"));
      worker = new Worker("data:text/javascript," + encodeURIComponent(code));
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      expect(await promise).toBe("caller-main.js caller-dep.js");
    } finally {
      worker?.terminate();
      process.chdir(cwd);
      cleanup();
    }
  });

  // A miss in a worker drops the calling module's directory from the cache that all threads
  // share, and reads it again. The package lookup must not see the directory half read.
  test("options.paths: the package of the calling module answers while a worker reads its directory again", async () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-threads", {
      ...scopeFiles,
      "caller/miss.js": `
        onmessage = event => {
          const stop = new Int32Array(event.data);
          postMessage("ready");
          while (!Atomics.load(stop, 0)) {
            try {
              require.resolve("not-installed");
            } catch {}
          }
        };
      `,
      "caller/ask.js": `
        const { join, relative } = require("node:path");
        const stop = new Int32Array(new SharedArrayBuffer(4));
        const paths = [join(__dirname, "..", "entry")];
        const worker = new Worker(join(__dirname, "miss.js"));
        worker.onmessage = () => {
          const answers = new Set();
          for (let i = 0; i < ${harness.isDebug ? 500 : 20_000}; i++) {
            try {
              answers.add(relative(__dirname, require.resolve("#dep", { paths })));
            } catch (error) {
              answers.add(error.code);
            }
          }
          Atomics.store(stop, 0, 1);
          worker.terminate();
          console.log([...answers].join(" "));
        };
        worker.postMessage(stop.buffer);
      `,
    });

    try {
      await using proc = Bun.spawn({
        cmd: [harness.bunExe(), "--no-install", join(dir, "caller", "ask.js")],
        env: harness.bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "caller-dep.js\n", stderr: "", exitCode: 0 });
    } finally {
      cleanup();
    }
  });

  // After a miss of a request of one segment, Bun reads the calling module's directory again.
  // A request of two segments does not do that by itself. The package lookup of `options.paths`
  // changes nothing in what is read: the directory cache is as a search of the entries leaves it.
  test("options.paths: the package lookup leaves the directory cache as it was", () => {
    const { path: dir, cleanup } = createTempDir("resolve-paths-cache", {
      "module/file.js": "",
      "string/file.js": "",
      "entry/node_modules/installed/index.js": "",
      "project/node_modules/file.js": "",
      "unread/keep.js": "",
      "chain/a/b/keep.js": "",
      "top/m/keep.js": "",
    });
    const code = resolveIt => {
      try {
        return relative(dir, resolveIt()).split(sep).join("/");
      } catch (error) {
        return error.code;
      }
    };
    const create = file => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), "");
    };
    const paths = [join(dir, "entry")];

    try {
      // A miss with `options.paths`, then a request of two segments for a package that was
      // created before the miss.
      const lateAfterMiss = (caller, miss) => {
        const file = join(dir, caller, "file.js");
        const fromCaller = Module.createRequire(file);
        fromCaller.resolve("./file.js");
        create(`${caller}/node_modules/@scope/late/index.js`);
        return [code(() => miss(fromCaller, file)), code(() => fromCaller.resolve("@scope/late"))];
      };
      // The same request again, from a module in a node_modules directory that an entry reads.
      const sameRequestAgain = () => {
        const fromModules = Module.createRequire(join(dir, "project", "node_modules", "file.js"));
        const probe = () => code(() => fromModules.resolve("late", { paths: [join(dir, "project")] }));
        const first = probe();
        create("project/node_modules/late.js");
        return [first, probe()];
      };
      // A hit from a directory that was not read, then a request of two segments from it for a
      // package that is created in `above`: that directory, or one above it that was not read.
      const lateAfterHit = (caller, above) => {
        const fromUnread = Module.createRequire(join(dir, caller, "file.js"));
        const hit = code(() => fromUnread.resolve("installed", { paths }));
        create(`${above}/node_modules/@scope/late/index.js`);
        return [hit, code(() => fromUnread.resolve("@scope/late"))];
      };

      // The directory of the calling module is not there, and an earlier request has found that.
      // Bun does not look for it again.
      const lateInMissingDirectory = () => {
        const fromGhost = Module.createRequire(join(dir, "ghost", "file.js"));
        const before = [
          code(() => fromGhost.resolve("./file.js")),
          code(() => fromGhost.resolve("installed", { paths })),
        ];
        create("ghost/node_modules/@scope/late/index.js");
        return [...before, code(() => fromGhost.resolve("@scope/late"))];
      };
      // A parent filename that ends in a separator: after a miss, Bun reads the directory above
      // it again.
      const lateAboveDirectoryParent = () => {
        const fromTop = Module.createRequire(join(dir, "top", "file.js"));
        const first = code(() => fromTop.resolve("late"));
        create("top/node_modules/late/index.js");
        const parent = { filename: join(dir, "top", "m") + sep };
        return [first, code(() => Module._resolveFilename("late", parent, false, { paths: [join(dir, "top")] }))];
      };

      expect({
        "from a module": lateAfterMiss("module", fromCaller => fromCaller.resolve("not-installed", { paths })),
        "from a string parent": lateAfterMiss("string", (fromCaller, file) =>
          Module._resolveFilename("not-installed", file, false, { paths }),
        ),
        "the same request again": sameRequestAgain(),
        "from a directory that was not read": lateAfterHit("unread", "unread"),
        "from a directory below directories that were not read": lateAfterHit("chain/a/b", "chain"),
        "from a directory that is not there": lateInMissingDirectory(),
        "from a parent that is a directory": lateAboveDirectoryParent(),
      }).toEqual({
        "from a module": ["MODULE_NOT_FOUND", "module/node_modules/@scope/late/index.js"],
        "from a string parent": ["MODULE_NOT_FOUND", "string/node_modules/@scope/late/index.js"],
        "the same request again": ["MODULE_NOT_FOUND", "project/node_modules/late.js"],
        "from a directory that was not read": [
          "entry/node_modules/installed/index.js",
          "unread/node_modules/@scope/late/index.js",
        ],
        "from a directory below directories that were not read": [
          "entry/node_modules/installed/index.js",
          "chain/node_modules/@scope/late/index.js",
        ],
        "from a directory that is not there": [
          "MODULE_NOT_FOUND",
          "entry/node_modules/installed/index.js",
          "MODULE_NOT_FOUND",
        ],
        "from a parent that is a directory": ["MODULE_NOT_FOUND", "top/node_modules/late/index.js"],
      });
    } finally {
      cleanup();
    }
  });

  // A registry with the `no-deps` of test/cli/install/registry/packages: 1.0.0 to 2.0.0, and
  // `latest` is 2.0.0. Every other name is a 404. `requests` has the path of each request.
  function noDepsRegistry() {
    const packages = join(import.meta.dir, "..", "..", "..", "cli", "install", "registry", "packages", "no-deps");
    const requests = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        if (pathname === "/no-deps") {
          const manifest = await Bun.file(join(packages, "package.json")).text();
          return Response.json(
            JSON.parse(manifest.replaceAll("http://localhost:4873", `http://127.0.0.1:${server.port}`)),
          );
        }
        const tarball = pathname.match(/^\/no-deps\/-\/(no-deps-[\d.]+\.tgz)$/);
        return tarball ? new Response(Bun.file(join(packages, tarball[1]))) : new Response("", { status: 404 });
      },
    });
    return { requests, server };
  }

  // The child prints what each [request, paths] loads, then the same for a name that is on no
  // disk. The request for that name shows that auto-install is on and that this registry is asked.
  const load = (...rows) => `
    const path = require("node:path");
    for (const [request, paths] of ${JSON.stringify([...rows, ["not-on-disk", ["other"]]])}) {
      try {
        console.log(require(request, { paths: paths.map(entry => path.join(__dirname, entry)) }).version);
      } catch (error) {
        console.log(error.code);
      }
    }
  `;
  const fromLocal = "7.0.0 in ./local";
  const installed = ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"];

  // Auto-install is on for a search when no directory above its start has a node_modules
  // directory, or with --install=fallback. There, as before, the package of an entry answers for
  // its "imports" and its own name, now after the search of node_modules. The registry gets
  // the requests that it got before.
  for (const [title, options, expected] of [
    [
      "the package of an entry answers in place of an install",
      {
        source: load(
          ["no-deps", ["local"]],
          ["no-deps", ["local", "other"]],
          ["no-deps/package.json", ["local", "other"]],
          ["#file", ["local"]],
          // A name that no registry has.
          ["_odd", ["odd"]],
          // Its "exports" do not have it, and nothing is installed for it.
          ["no-deps/hidden", ["local"]],
        ),
      },
      {
        stdout: [fromLocal, fromLocal, "7.0.0", fromLocal, "odd", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
        requests: ["/not-on-disk"],
      },
    ],
    [
      "also when the registry's package of that name is in the cache",
      { warm: true, source: load(["no-deps", ["local"]], ["no-deps", ["local", "other"]]) },
      { stdout: [fromLocal, fromLocal, "MODULE_NOT_FOUND"], requests: ["/not-on-disk"] },
    ],
    [
      "--install=fallback, with a node_modules directory",
      { args: ["--install=fallback"], nodeModules: true, source: load(["no-deps", ["local"]]) },
      { stdout: [fromLocal, "MODULE_NOT_FOUND"], requests: ["/not-on-disk"] },
    ],
    [
      "--install=force installs",
      { args: ["--install=force"], source: load(["no-deps", ["local"]]) },
      { stdout: ["2.0.0", "MODULE_NOT_FOUND"], requests: [...installed, "/not-on-disk"] },
    ],
    [
      "a directory whose nearest package.json has no name is in no package of that name",
      { source: load(["no-deps", ["local/dist/cjs"]]) },
      { stdout: ["2.0.0", "MODULE_NOT_FOUND"], requests: [...installed, "/not-on-disk"] },
    ],
    [
      "with a node_modules directory nothing is installed, and the package of an entry does not answer",
      { nodeModules: true, source: load(["no-deps", ["local"]], ["#file", ["local"]]) },
      { stdout: ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"], requests: [] },
    ],
    [
      "the later entries are searched as in Node for what the package of an earlier entry has",
      {
        source: load(
          // `project/` has a node_modules directory, and `other/` has none above it: no install.
          ["no-deps", ["project/local", "other"]],
          // `local/` is a package of that name too: it does not answer.
          ["no-deps", ["project/local", "local"]],
          // The package does not have it: the search goes on as before, with an install.
          ["no-deps/hidden", ["project/local", "other"]],
        ),
      },
      {
        stdout: ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
        requests: [...installed, "/not-on-disk"],
      },
    ],
    [
      "the package of the calling module answers for its name",
      {
        source: `console.log(require("./local/ask.js")([require("node:path").join(__dirname, "other")]));${load()}`,
      },
      { stdout: [fromLocal, "MODULE_NOT_FOUND"], requests: ["/not-on-disk"] },
    ],
  ]) {
    // An ASAN build starts too slowly to run all of these at the same time within the timeout.
    test.concurrentIf(!harness.isASAN)(`options.paths with auto-install: ${title}`, async () => {
      const { requests, server } = noDepsRegistry();
      const local = {
        "package.json": JSON.stringify({
          name: "no-deps",
          version: "7.0.0",
          exports: { ".": "./main.js" },
          imports: { "#file": "./main.js" },
        }),
        "main.js": `module.exports = { version: "${fromLocal}" };`,
      };
      const { path: dir, cleanup } = createTempDir("resolve-paths-install", {
        // `no-deps` is also a package on disk.
        ...Object.fromEntries(Object.entries(local).map(([file, text]) => [`local/${file}`, text])),
        "local/dist/cjs/package.json": JSON.stringify({ type: "commonjs" }),
        // A module of the package asks for the name of the package.
        "local/ask.js": `module.exports = paths => require("no-deps", { paths }).version;`,
        // The same package in a project that has a node_modules directory.
        ...Object.fromEntries(Object.entries(local).map(([file, text]) => [`project/local/${file}`, text])),
        "project/node_modules/abc/index.js": "",
        "odd/package.json": JSON.stringify({ name: "_odd", exports: "./main.js" }),
        "odd/main.js": `module.exports = { version: "odd" };`,
        "other/file.js": "",
        ...(options.nodeModules ? { "node_modules/abc/index.js": "" } : {}),
        "package.json": JSON.stringify({ name: "app" }),
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
        "warm.js": `console.log(require("no-deps").version);`,
        "index.js": options.source,
      });
      const run = async (...args) => {
        await using proc = Bun.spawn({
          cmd: [harness.bunExe(), ...args],
          cwd: dir,
          env: { ...harness.bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout: stdout.trim().split("\n"), stderr, exitCode };
      };

      try {
        if (options.warm) {
          expect({ ...(await run("warm.js")), requests }).toEqual({
            stdout: ["2.0.0"],
            stderr: "",
            exitCode: 0,
            requests: installed,
          });
          requests.length = 0;
        }
        expect({ ...(await run(...(options.args ?? []), "index.js")), requests }).toEqual({
          ...expected,
          stderr: "",
          exitCode: 0,
        });
      } finally {
        server.stop(true);
        cleanup();
      }
    });
  }

  // A search after a miss reads the calling module's directory again, and the listing that it
  // replaces is not freed: about 7 KB for each request. A search of entries elsewhere does not,
  // for a request that the package of the calling module does not claim.
  test.skipIf(harness.isASAN || harness.isDebug)(
    "options.paths: a request that misses does not read the calling module's directory again",
    async () => {
      const { path: dir, cleanup } = createTempDir("resolve-paths-miss", {
        "node_modules/keep/index.js": "",
        "entry/file.js": "",
        "caller/package.json": JSON.stringify({ name: "caller-pkg", exports: "./main.js" }),
        "caller/probe.cjs": `
          const paths = [require("node:path").join(__dirname, "..", "entry")];
          const miss = count => {
            for (let i = 0; i < count; i++) {
              for (const request of ["not-installed", "not-installed/"]) {
                try {
                  require.resolve(request, { paths });
                } catch {}
              }
            }
          };
          miss(500);
          Bun.gc(true);
          const before = process.memoryUsage.rss();
          miss(10000);
          Bun.gc(true);
          console.log(Math.round((process.memoryUsage.rss() - before) / 1024 / 1024));
        `,
      });

      try {
        await using proc = Bun.spawn({
          cmd: [harness.bunExe(), "--no-install", "caller/probe.cjs"],
          cwd: dir,
          env: harness.bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(stdout).toMatch(/^\d+\n$/);
        // 6 to 8 MB without the second search, over 100 MB with it.
        expect(Number(stdout)).toBeLessThan(40);
      } finally {
        cleanup();
      }
    },
  );

  // Only in Bun: when Node.js runs this file it must not spawn itself again.
  const node = harness.nodeExeAtLeast("26.3.0");
  (node ? test : test.skip)("the tests that are not only for Bun pass in Node.js", async () => {
    // A direct run, not `node --test`: node:test still exits non-zero on any failure.
    await using proc = Bun.spawn({
      cmd: [node, fileURLToPath(import.meta.url)],
      env: harness.bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  });
}
