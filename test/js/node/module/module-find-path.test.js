// Module._findPath(request, paths) looks `request` up in each directory of `paths`.
// `bun test` runs this file, and one of its tests runs it again in Node.js. So it uses no test harness.
// The expected values are those of Node.js v26.3.0.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import Module, { _findPath as namedFindPath } from "module";
import { tmpdir } from "os";
import { dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

const isBun = typeof Bun !== "undefined";
const isWindows = process.platform === "win32";
let test, expect, afterAll;

if (isBun) {
  ({ test, expect, afterAll } = await import("bun:test"));
} else {
  const nodeTest = await import("node:test");
  const assert = await import("node:assert/strict");
  test = nodeTest.test;
  afterAll = nodeTest.after;
  expect = value => ({
    toBe: expected => assert.strictEqual(value, expected),
    toEqual: expected => assert.deepStrictEqual(value, expected),
  });
}

// Use realpathSync to resolve symlinks (handles /tmp -> /private/tmp on macOS)
const root = realpathSync(mkdtempSync(join(tmpdir(), "module-find-path-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files = {
  "node_modules/rootpkg/index.js": "",
  "plugins/host.js": "",
  "plugins/node_modules/plug/index.js": "",
  "plugins/node_modules/plug/both.js": "",
  "plugins/node_modules/plug/both.ts": "",
  "plugins/node_modules/withmain/package.json": JSON.stringify({ name: "withmain", main: "./lib/entry.js" }),
  "plugins/node_modules/withmain/lib/entry.js": "",
  "plugins/node_modules/withmain/lib/other.js": "",
  "plugins/node_modules/@scope/pkg/index.js": "",
  "plugins/node_modules/@scope/exports/package.json": JSON.stringify({
    name: "@scope/exports",
    exports: { ".": "./main.js", "./feature": "./lib/feature.js" },
  }),
  "plugins/node_modules/@scope/exports/main.js": "",
  "plugins/node_modules/@scope/exports/lib/feature.js": "",
  "plugins/node_modules/@scope/exports/lib/hidden.js": "",
  "plugins/node_modules/withexports/package.json": JSON.stringify({
    name: "withexports",
    exports: {
      ".": { require: "./dist/cjs.js", import: "./dist/esm.mjs" },
      "./feature": "./dist/feature.js",
      "./gone": "./dist/gone.js",
    },
  }),
  "plugins/node_modules/withexports/dist/cjs.js": "",
  "plugins/node_modules/withexports/dist/esm.mjs": "",
  "plugins/node_modules/withexports/dist/feature.js": "",
  "plugins/node_modules/withexports/dist/hidden.js": "",
  "plugins/node_modules/subpaths-only/package.json": JSON.stringify({ exports: { "./sub": "./sub.js" } }),
  "plugins/node_modules/subpaths-only/sub.js": "",
  "plugins/node_modules/subpaths-only/index.js": "",
  "plugins/node_modules/conditions/package.json": JSON.stringify({
    exports: { bun: "./for-bun.js", node: "./for-node.js" },
  }),
  "plugins/node_modules/conditions/for-bun.js": "",
  "plugins/node_modules/conditions/for-node.js": "",
  "plugins/node_modules/exports-true/package.json": JSON.stringify({ exports: true }),
  "plugins/node_modules/exports-true/index.js": "",
  "plugins/node_modules/folders/package.json": JSON.stringify({ exports: { "./dir/": "./dist/" } }),
  "plugins/node_modules/folders/dist/both.js": "",
  "plugins/node_modules/folders/dist/both.ts": "",
  // Like gopd: a file at the root of the package has the name of the package in another case.
  "plugins/node_modules/cased/Cased.js": 'module.exports = "Cased";',
  "plugins/node_modules/cased/index.js": 'module.exports = require("./Cased");',
  "badmain-first/badmain/package.json": JSON.stringify({ main: "./missing.js" }),
  "badmain-second/badmain/index.js": "",
  // Like mocha: a file at the root of the package has the name of the package.
  "plugins/node_modules/rootfile/rootfile.js": "",
  "plugins/node_modules/rootfile/index.js": "",
  "plugins/node_modules/rootmjs/rootmjs.mjs": "",
  "plugins/node_modules/rootmjs/index.js": "",
  "copies/withexports/dist/hidden.js": "",
  "lib/a.js": "",
  "lib/data.json": "{}",
  "lib/typed.ts": "",
  "lib/both.js": "",
  "lib/both.ts": "",
  "lib/odd.findpath-extension": "",
  "lib/sub/index.js": "",
  "lib/ünï/çödé.js": "",
  "deep/a/b/c.js": "",
  "top.js": "",
  // What a specifier reaches from a file in project/src, and a path in project/src does not.
  "project/package.json": JSON.stringify({
    name: "project",
    imports: { "#internal": "./internal.js" },
    exports: { "./internal": "./internal.js" },
  }),
  "project/tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: "./base", paths: { "@alias/*": ["./aliased/*"] } },
  }),
  "project/internal.js": "",
  "project/base/viabase.js": "",
  "project/aliased/file.js": "",
  "project/src/index.js": "",
  // What `bun install --linker=isolated` writes: a package is a link into a store.
  "app/node_modules/.bun/stored@1.0.0/node_modules/stored/package.json": JSON.stringify({
    name: "stored",
    main: "./lib/main.js",
  }),
  "app/node_modules/.bun/stored@1.0.0/node_modules/stored/lib/main.js": "",
  "app/node_modules/.bun/stored@1.0.0/node_modules/stored/lib/other.js": "",
  "app/node_modules/.bun/stored-exports@1.0.0/node_modules/stored-exports/package.json": JSON.stringify({
    name: "stored-exports",
    exports: { ".": "./dist/index.js", "./feature": "./dist/feature.js" },
  }),
  "app/node_modules/.bun/stored-exports@1.0.0/node_modules/stored-exports/dist/index.js": "",
  "app/node_modules/.bun/stored-exports@1.0.0/node_modules/stored-exports/dist/feature.js": "",
  "app/node_modules/.bun/@stored+scoped@1.0.0/node_modules/@stored/scoped/index.js": "",
  "app/node_modules/@stored/.keep": "",
};
for (const [file, content] of Object.entries(files)) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

const abs = (...segments) => join(root, ...segments);
// A path under `root` that is relative to the current directory. On Windows it stays absolute when
// the temporary directory is on another drive.
const rel = (...segments) => relative(process.cwd(), abs(...segments));
const shown = text => text.replaceAll(root, "<root>").replaceAll(sep, "/");

symlinkSync(abs("plugins", "node_modules", "plug"), abs("linked"), "junction");
const store = abs("app", "node_modules", ".bun");
for (const [link, target] of [
  ["stored", join(store, "stored@1.0.0", "node_modules", "stored")],
  ["stored-exports", join(store, "stored-exports@1.0.0", "node_modules", "stored-exports")],
  [join("@stored", "scoped"), join(store, "@stored+scoped@1.0.0", "node_modules", "@stored", "scoped")],
]) {
  symlinkSync(target, abs("app", "node_modules", link), "junction");
}

// What Node.js throws where the exports of a package do not give the request.
const notExported = (subpath, name) => ({
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  message:
    subpath === "."
      ? `No "exports" main defined in <root>/plugins/node_modules/${name}/package.json`
      : `Package subpath '${subpath}' is not defined by "exports" in <root>/plugins/node_modules/${name}/package.json`,
});

// The result of Module._findPath: a path from `root`, false, or the code and message of what it throws.
function find(request, paths, findPath = Module._findPath) {
  let found;
  try {
    found = findPath(request, paths);
  } catch (error) {
    const { code, message, path } = error;
    return path === undefined
      ? { code, message: shown(message) }
      : { code, message: shown(message), path: shown(path) };
  }
  return typeof found === "string" ? shown(found) : found;
}

test("an entry of paths is a directory that holds the request", () => {
  const nodeModules = abs("plugins", "node_modules");
  expect({
    "a package": find("plug", [nodeModules]),
    "a file of a package": find("plug/index.js", [nodeModules]),
    "a file of a package, no extension": find("plug/index", [nodeModules]),
    "a .js file of a package, beside a .ts file": find("plug/both", [nodeModules]),
    "the main of a package": find("withmain", [nodeModules]),
    "a file of a package with a main": find("withmain/lib/other", [nodeModules]),
    "a scoped package": find("@scope/pkg", [nodeModules]),
    "a file": find("a", [abs("lib")]),
    "a file with its extension": find("a.js", [abs("lib")]),
    "a .json file": find("data", [abs("lib")]),
    "a directory with an index": find("sub", [abs("lib")]),
    "a path of two segments": find("lib/a", [root]),
    "./ and a file": find("./a", [abs("lib")]),
    "./ and a file with its extension": find("./a.js", [abs("lib")]),
    "./ and a file of a package": find("./index.js", [abs("plugins", "node_modules", "plug")]),
    "./ and a directory": find("./sub", [abs("lib")]),
    "./ and a directory with a slash": find("./sub/", [abs("lib")]),
    "./ and a package": find("./withmain", [nodeModules]),
    ". is the entry": find(".", [abs("lib", "sub")]),
    "'' is the entry": find("", [abs("lib", "sub")]),
    "../ leaves the entry": find("../top", [abs("lib")]),
    "../ from an entry that does not exist": find("../lib/a", [abs("nowhere")]),
    ".. from an entry that does not exist": find("..", [abs("lib", "sub", "nowhere")]),
    "a name, then ../..": find("sub/../../top", [abs("lib")]),
    "an entry with a slash at its end": find("a", [abs("lib") + sep]),
    "an entry with a .. segment": find("a", [abs("lib", "sub") + sep + ".."]),
    "a symlink is followed": find("./index", [abs("linked")]),
    "names that are not ASCII": find("çödé", [abs("lib", "ünï")]),
  }).toEqual({
    "a package": "<root>/plugins/node_modules/plug/index.js",
    "a file of a package": "<root>/plugins/node_modules/plug/index.js",
    "a file of a package, no extension": "<root>/plugins/node_modules/plug/index.js",
    "a .js file of a package, beside a .ts file": "<root>/plugins/node_modules/plug/both.js",
    "the main of a package": "<root>/plugins/node_modules/withmain/lib/entry.js",
    "a file of a package with a main": "<root>/plugins/node_modules/withmain/lib/other.js",
    "a scoped package": "<root>/plugins/node_modules/@scope/pkg/index.js",
    "a file": "<root>/lib/a.js",
    "a file with its extension": "<root>/lib/a.js",
    "a .json file": "<root>/lib/data.json",
    "a directory with an index": "<root>/lib/sub/index.js",
    "a path of two segments": "<root>/lib/a.js",
    "./ and a file": "<root>/lib/a.js",
    "./ and a file with its extension": "<root>/lib/a.js",
    "./ and a file of a package": "<root>/plugins/node_modules/plug/index.js",
    "./ and a directory": "<root>/lib/sub/index.js",
    "./ and a directory with a slash": "<root>/lib/sub/index.js",
    "./ and a package": "<root>/plugins/node_modules/withmain/lib/entry.js",
    ". is the entry": "<root>/lib/sub/index.js",
    "'' is the entry": "<root>/lib/sub/index.js",
    "../ leaves the entry": "<root>/top.js",
    "../ from an entry that does not exist": "<root>/lib/a.js",
    ".. from an entry that does not exist": "<root>/lib/sub/index.js",
    "a name, then ../..": "<root>/top.js",
    "an entry with a slash at its end": "<root>/lib/a.js",
    "an entry with a .. segment": "<root>/lib/a.js",
    "a symlink is followed": "<root>/plugins/node_modules/plug/index.js",
    "names that are not ASCII": "<root>/lib/ünï/çödé.js",
  });
});

test("nothing is looked up outside the entries", () => {
  const source = abs("project", "src");
  expect({
    "a package in a node_modules above the entry": find("rootpkg", [abs("lib")]),
    "a package in a node_modules far above the entry": find("rootpkg", [abs("deep", "a", "b")]),
    "a package in the node_modules of the entry": find("plug", [abs("plugins")]),
    "a package from its own directory": find("plug", [abs("plugins", "node_modules", "plug")]),
    "./ from an entry that is a file": find("./a", [abs("lib", "a.js")]),
    "a name from an entry that is a file": find("a", [abs("lib", "a.js")]),
    "'' from an entry that is a file": find("", [abs("lib", "a.js")]),
    "./ from an entry that does not exist": find("./a", [abs("nowhere")]),
    "'' from an entry that does not exist, beside a file of that name": find("", [abs("lib", "a")]),
    "a name, then ../.., from an entry that does not exist": find("sub/../../lib/a", [abs("nowhere")]),
    "a file with a slash at its end": find("./a.js/", [abs("lib")]),
    "a builtin": find("fs", [abs("lib")]),
    "a builtin with its prefix": find("node:fs", [abs("lib")]),
    "a directory without an index": find("lib", [root]),
    "a request longer than a path": find("./" + Buffer.alloc(70000, "a").toString(), [abs("lib")]),
    "an entry longer than a path": find("a", [abs("lib", Buffer.alloc(70000, "a").toString())]),
    "a request with a null byte": find("a\0", [abs("lib")]),
    "an entry with a null byte": find("a", [abs("lib") + "\0"]),
    "nothing": find("nowhere", [abs("lib")]),
    // A specifier in a file of project/src reaches these. A path in project/src does not.
    "an import of the package.json above the entry": find("#internal", [source]),
    "the name of the package above the entry": find("project/internal", [source]),
    "a path of the tsconfig.json above the entry": find("@alias/file", [source]),
    "the baseUrl of the tsconfig.json above the entry": find("viabase", [source]),
  }).toEqual({
    "a package in a node_modules above the entry": false,
    "a package in a node_modules far above the entry": false,
    "a package in the node_modules of the entry": false,
    "a package from its own directory": false,
    "./ from an entry that is a file": false,
    "a name from an entry that is a file": false,
    "'' from an entry that is a file": false,
    "./ from an entry that does not exist": false,
    "'' from an entry that does not exist, beside a file of that name": false,
    "a name, then ../.., from an entry that does not exist": false,
    "a file with a slash at its end": false,
    "a builtin": false,
    "a builtin with its prefix": false,
    "a directory without an index": false,
    "a request longer than a path": false,
    "an entry longer than a path": false,
    "a request with a null byte": false,
    "an entry with a null byte": false,
    "nothing": false,
    "an import of the package.json above the entry": false,
    "the name of the package above the entry": false,
    "a path of the tsconfig.json above the entry": false,
    "the baseUrl of the tsconfig.json above the entry": false,
  });
});

// On Windows a backslash separates two names and `c:` starts an absolute path.
(isWindows ? test.skip : test)("a backslash and a colon are characters of a name", () => {
  expect({
    "a backslash": find("sub\\index", [abs("lib")]),
    "a backslash in the entry": find("index", [abs("lib") + "\\sub"]),
    "a letter and a colon": find("c:/../a", [abs("lib")]),
  }).toEqual({
    "a backslash": false,
    "a backslash in the entry": false,
    "a letter and a colon": "<root>/lib/a.js",
  });
});

test("a relative entry is relative to the current directory", () => {
  expect({
    "a package": find("plug", [rel("plugins", "node_modules")]),
    "a file of a package": find("plug/index.js", [rel("plugins", "node_modules")]),
    "./ and a file of a package": find("./index.js", [rel("plugins", "node_modules", "plug")]),
    "a file": find("a", [rel("lib")]),
    "../ leaves the entry": find("../top", [rel("lib")]),
    "no walk": find("plug", [rel("plugins")]),
  }).toEqual({
    "a package": "<root>/plugins/node_modules/plug/index.js",
    "a file of a package": "<root>/plugins/node_modules/plug/index.js",
    "./ and a file of a package": "<root>/plugins/node_modules/plug/index.js",
    "a file": "<root>/lib/a.js",
    "../ leaves the entry": "<root>/top.js",
    "no walk": false,
  });

  // The current directory is read when Module._findPath is called.
  const cwd = process.cwd();
  try {
    process.chdir(abs("lib"));
    expect({
      "the entry .": find("sub", ["."]),
      "the entry ''": find("data", [""]),
      "a string is a list of one-character entries": find("a.js", "."),
      "the entry ..": find("top", [".."]),
    }).toEqual({
      "the entry .": "<root>/lib/sub/index.js",
      "the entry ''": "<root>/lib/data.json",
      "a string is a list of one-character entries": "<root>/lib/a.js",
      "the entry ..": "<root>/top.js",
    });
    process.chdir(root);
    expect(find("deep/a/b/c", ["."])).toBe("<root>/deep/a/b/c.js");
  } finally {
    process.chdir(cwd);
  }
});

test("the entries are searched in order", () => {
  const nodeModules = abs("plugins", "node_modules");
  expect({
    "the first entry that has it": find("index", [abs("lib", "sub"), abs("plugins", "node_modules", "plug")]),
    "in the other order": find("index", [abs("plugins", "node_modules", "plug"), abs("lib", "sub")]),
    "after an entry that does not exist": find("plug", [abs("nowhere"), nodeModules]),
    "after an entry that is a file": find("plug", [abs("top.js"), nodeModules]),
    "after an entry that does not have it": find("plug", [abs("lib"), rel("plugins", "node_modules")]),
    "the directory of the package, then node_modules": find("plug", [join(nodeModules, "plug"), nodeModules]),
    // The directory of the package has a file with the name of the package.
    "the directory of a package like mocha, then node_modules": find("rootfile", [
      join(nodeModules, "rootfile"),
      nodeModules,
    ]),
  }).toEqual({
    "the first entry that has it": "<root>/lib/sub/index.js",
    "in the other order": "<root>/plugins/node_modules/plug/index.js",
    "after an entry that does not exist": "<root>/plugins/node_modules/plug/index.js",
    "after an entry that is a file": "<root>/plugins/node_modules/plug/index.js",
    "after an entry that does not have it": "<root>/plugins/node_modules/plug/index.js",
    "the directory of the package, then node_modules": "<root>/plugins/node_modules/plug/index.js",
    "the directory of a package like mocha, then node_modules": "<root>/plugins/node_modules/rootfile/rootfile.js",
  });
});

// dd-trace (ritm.js) asks this of each file that require() loads from a package. The answer decides
// which of its hooks run.
test("Module._findPath(name, [directory of the package, ...lookup paths]) is the main file of the package", () => {
  const parent = new Module(abs("plugins", "host.js"));
  parent.filename = abs("plugins", "host.js");
  parent.paths = Module._nodeModulePaths(abs("plugins"));
  const findsMainFile = name => {
    const mainFile = Module._resolveFilename(name, parent);
    const lookupPaths = Module._resolveLookupPaths(name, parent);
    return Module._findPath(name, [abs("plugins", "node_modules", name), ...lookupPaths]) === mainFile;
  };
  expect({
    "plug": findsMainFile("plug"),
    "withmain": findsMainFile("withmain"),
    "withexports": findsMainFile("withexports"),
    "@scope/pkg": findsMainFile("@scope/pkg"),
    // rootfile/rootfile.js comes first.
    "rootfile": findsMainFile("rootfile"),
  }).toEqual({ "plug": true, "withmain": true, "withexports": true, "@scope/pkg": true, "rootfile": false });
});

// In Node.js, require() is Module._findPath over the lookup paths. In Bun they are two lookups, so
// this table says where they differ.
test("Module._findPath(request, lookup paths) is the file that Module._resolveFilename(request, parent) names", () => {
  const parent = new Module(abs("plugins", "host.js"));
  parent.filename = abs("plugins", "host.js");
  parent.paths = Module._nodeModulePaths(abs("plugins"));
  const named = lookup => {
    try {
      return shown(lookup() || "nothing");
    } catch {
      return "nothing";
    }
  };
  const compare = request => {
    const resolved = named(() => Module._resolveFilename(request, parent));
    const found = named(() => Module._findPath(request, Module._resolveLookupPaths(request, parent)));
    return found === resolved ? "the same" : { found, resolved };
  };
  const requests = [
    "plug",
    "plug/index",
    "plug/index.js",
    "plug/both",
    "withmain",
    "withmain/lib/other",
    "@scope/pkg",
    "withexports",
    "withexports/feature",
    "withexports/dist/hidden.js",
    "@scope/exports",
    "@scope/exports/feature",
    "subpaths-only",
    "conditions",
    "exports-true",
    "folders/dir/both",
    "rootfile",
    "rootmjs",
    "rootpkg",
    "nowhere",
    "./host",
    "./node_modules/plug",
    "../lib/a",
    "../lib/typed",
  ];
  expect({
    ...Object.fromEntries(requests.map(request => [request, compare(request)])),
    // Bun's require() finds "./feature" for "./feature.js", and the package.json that exports do not
    // list. Node.js throws for both.
    "withexports/feature.js": compare("withexports/feature.js"),
    "withexports/package.json": compare("withexports/package.json"),
  }).toEqual({
    ...Object.fromEntries(requests.map(request => [request, "the same"])),
    "withexports/feature.js": isBun
      ? { found: "nothing", resolved: "<root>/plugins/node_modules/withexports/dist/feature.js" }
      : "the same",
    "withexports/package.json": isBun
      ? { found: "nothing", resolved: "<root>/plugins/node_modules/withexports/package.json" }
      : "the same",
  });
});

test("an absolute request does not read paths", () => {
  expect({
    "no paths": find(abs("lib", "a")),
    "empty paths": find(abs("lib", "a"), []),
    "paths that do not have it": find(abs("lib", "a.js"), [abs("nowhere")]),
    "paths that are not strings": find(abs("lib", "a"), [1, null]),
    "paths that is not a list": find(abs("lib", "a"), 5),
    "a directory with an index": find(abs("lib", "sub")),
    "a directory without an index": find(abs("lib")),
    "nothing": find(abs("nowhere")),
  }).toEqual({
    "no paths": "<root>/lib/a.js",
    "empty paths": "<root>/lib/a.js",
    "paths that do not have it": "<root>/lib/a.js",
    "paths that are not strings": "<root>/lib/a.js",
    "paths that is not a list": "<root>/lib/a.js",
    "a directory with an index": "<root>/lib/sub/index.js",
    "a directory without an index": false,
    "nothing": false,
  });
});

test("paths is read through its length and its indexes", () => {
  const notStrings = received => ({
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "paths" argument must be array of strings. Received ${received}`,
  });
  expect({
    "undefined": find("a", undefined),
    "null": find("a", null),
    "an empty array": find("a", []),
    "a number": find("a", 5),
    "an object without a length": find("a", { 0: abs("lib") }),
    "a Set": find("a", new Set([abs("lib")])),
    "an object with a length": find("a", { length: 1, 0: abs("lib") }),
    "a number entry": find("a", [1]),
    "an undefined entry": find("a", [undefined]),
    "a String object entry": find("c", [new String(abs("deep", "a", "b"))]),
    "a hole": find("a", [, abs("lib")]),
    "a Buffer": find("a", Buffer.from("ab")),
    "an entry that is not a string, after the one that has it": find("a", [abs("lib"), 1]),
    "an entry that is not a string, before the one that has it": find("a", [abs("nowhere"), 1, abs("lib")]),
  }).toEqual({
    "undefined": false,
    "null": false,
    "an empty array": false,
    "a number": false,
    "an object without a length": false,
    "a Set": false,
    "an object with a length": "<root>/lib/a.js",
    "a number entry": notStrings("an instance of Array"),
    "an undefined entry": notStrings("an instance of Array"),
    "a String object entry": notStrings("an instance of Array"),
    "a hole": notStrings("an instance of Array"),
    "a Buffer": notStrings("an instance of Buffer"),
    "an entry that is not a string, after the one that has it": "<root>/lib/a.js",
    "an entry that is not a string, before the one that has it": notStrings("an instance of Array"),
  });
});

test("what a getter of paths throws is thrown", () => {
  const thrown = message => ({ code: undefined, message });
  expect({
    "length": find("a", {
      get length() {
        throw new Error("length threw");
      },
    }),
    "an index": find("a", {
      length: 1,
      get 0() {
        throw new Error("index threw");
      },
    }),
  }).toEqual({ "length": thrown("length threw"), "an index": thrown("index threw") });
});

test("a request that is not a string is rejected", () => {
  const notString = received => ({
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "path" argument must be of type string. Received ${received}`,
  });
  expect({
    "a number": find(42, [abs("lib")]),
    "undefined": find(undefined, [abs("lib")]),
    "a String object": find(new String("a"), [abs("lib")]),
  }).toEqual({
    "a number": notString("type number (42)"),
    "undefined": notString("undefined"),
    "a String object": notString("an instance of String"),
  });
});

test("the exports of a package in an entry decide", () => {
  const nodeModules = abs("plugins", "node_modules");
  // Where the exports do not give the request, no later entry is searched. Node.js throws there.
  // Bun returns false.
  const notGiven = (subpath, name) => (isBun ? false : notExported(subpath, name));
  const hidden = "withexports/dist/hidden.js";
  expect({
    "the require condition": find("withexports", [nodeModules]),
    "a subpath": find("withexports/feature", [nodeModules]),
    "from a relative entry": find("withexports", [rel("plugins", "node_modules")]),
    "a scoped package": find("@scope/exports", [nodeModules]),
    "a subpath of a scoped package": find("@scope/exports/feature", [nodeModules]),
    "a subpath that is not exported": find(hidden, [nodeModules]),
    "a subpath of a scoped package that is not exported": find("@scope/exports/lib/hidden.js", [nodeModules]),
    "a subpath that is not exported, after an entry without the package": find(hidden, [abs("lib"), nodeModules]),
    "a subpath that is not exported, before an entry that has the file": find(hidden, [nodeModules, abs("copies")]),
    "a subpath that is not exported, after an entry that has the file": find(hidden, [abs("copies"), nodeModules]),
    "a subpath that is exported without its .js": find("withexports/feature.js", [nodeModules]),
    "the package.json": find("withexports/package.json", [nodeModules]),
    "a package without a main export": find("subpaths-only", [nodeModules]),
    "an export whose file does not exist": find("withexports/gone", [nodeModules]),
    // The request is a path then, not a package.
    "./ does not read exports": find("./withexports/dist/hidden.js", [nodeModules]),
    "./ and the package directory": find("./withexports", [nodeModules]),
    "./ from the package directory": find("./dist/hidden.js", [join(nodeModules, "withexports")]),
    "'' from the package directory": find("", [join(nodeModules, "withexports")]),
    ".. from a directory of the package": find("..", [join(nodeModules, "withexports", "dist")]),
    "an absolute request does not read exports": find(join(nodeModules, "subpaths-only")),
  }).toEqual({
    "the require condition": "<root>/plugins/node_modules/withexports/dist/cjs.js",
    "a subpath": "<root>/plugins/node_modules/withexports/dist/feature.js",
    "from a relative entry": "<root>/plugins/node_modules/withexports/dist/cjs.js",
    "a scoped package": "<root>/plugins/node_modules/@scope/exports/main.js",
    "a subpath of a scoped package": "<root>/plugins/node_modules/@scope/exports/lib/feature.js",
    "a subpath that is not exported": notGiven("./dist/hidden.js", "withexports"),
    "a subpath of a scoped package that is not exported": notGiven("./lib/hidden.js", "@scope/exports"),
    "a subpath that is not exported, after an entry without the package": notGiven("./dist/hidden.js", "withexports"),
    "a subpath that is not exported, before an entry that has the file": notGiven("./dist/hidden.js", "withexports"),
    "a subpath that is not exported, after an entry that has the file": "<root>/copies/withexports/dist/hidden.js",
    "a subpath that is exported without its .js": notGiven("./feature.js", "withexports"),
    "the package.json": notGiven("./package.json", "withexports"),
    "a package without a main export": notGiven(".", "subpaths-only"),
    "an export whose file does not exist": isBun
      ? false
      : {
          code: "MODULE_NOT_FOUND",
          message: "Cannot find module '<root>/plugins/node_modules/withexports/dist/gone.js'",
          path: "<root>/plugins/node_modules/withexports",
        },
    "./ does not read exports": "<root>/plugins/node_modules/withexports/dist/hidden.js",
    "./ and the package directory": false,
    "./ from the package directory": "<root>/plugins/node_modules/withexports/dist/hidden.js",
    "'' from the package directory": false,
    ".. from a directory of the package": false,
    "an absolute request does not read exports": "<root>/plugins/node_modules/subpaths-only/index.js",
  });
});

test("a package that is a link into a store is found at its real path", () => {
  const nodeModules = abs("app", "node_modules");
  const stored = join(store, "stored@1.0.0", "node_modules", "stored");
  expect({
    "the main of a package": find("stored", [nodeModules]),
    "a file of a package": find("stored/lib/other.js", [nodeModules]),
    "the exports of a package": find("stored-exports", [nodeModules]),
    "a subpath of the exports of a package": find("stored-exports/feature", [nodeModules]),
    "a scoped package": find("@stored/scoped", [nodeModules]),
    "the real directory of the package, then node_modules": find("stored", [stored, nodeModules]),
  }).toEqual({
    "the main of a package": "<root>/app/node_modules/.bun/stored@1.0.0/node_modules/stored/lib/main.js",
    "a file of a package": "<root>/app/node_modules/.bun/stored@1.0.0/node_modules/stored/lib/other.js",
    "the exports of a package":
      "<root>/app/node_modules/.bun/stored-exports@1.0.0/node_modules/stored-exports/dist/index.js",
    "a subpath of the exports of a package":
      "<root>/app/node_modules/.bun/stored-exports@1.0.0/node_modules/stored-exports/dist/feature.js",
    "a scoped package": "<root>/app/node_modules/.bun/@stored+scoped@1.0.0/node_modules/@stored/scoped/index.js",
    "the real directory of the package, then node_modules":
      "<root>/app/node_modules/.bun/stored@1.0.0/node_modules/stored/lib/main.js",
  });
});

test("a file or a package that is created after a miss is found", () => {
  mkdirSync(abs("later"));
  // No other request reads this directory again.
  mkdirSync(abs("later-alone"));
  writeFileSync(abs("later-alone", "top.js"), "");
  mkdirSync(abs("later-nested"));
  // Reading the entry looks another request up in the same directory.
  const nested = {
    length: 1,
    get 0() {
      Module._findPath("not-there", [abs("later-nested")]);
      return abs("later-nested");
    },
  };
  const hidden = "withexports/dist/hidden.js";
  const findAll = () => ({
    "a file": find("file", [abs("later")]),
    "a package": find("package", [abs("later")]),
    "a file in a directory": find("directory/file", [abs("later")]),
    "an entry": find("file", [abs("later", "entry")]),
    "an entry in a directory": find("file", [abs("later", "above", "entry")]),
    "a package in a directory": find("above/package", [abs("later", "far")]),
    "an entry, for a request that goes through it": find("name/../../top", [abs("later-alone", "entry")]),
    "an entry before a package whose exports do not give the request": find(hidden, [
      abs("later", "copies"),
      abs("plugins", "node_modules"),
    ]),
    "an entry that a getter looks in too": find("file", nested),
  });
  const before = findAll();
  for (const file of [
    "file.js",
    "package/index.js",
    "directory/file.js",
    "entry/file.js",
    "above/entry/file.js",
    "far/above/package/index.js",
    "../later-alone/entry/unused.js",
    "../later-nested/file.js",
    "copies/withexports/dist/hidden.js",
  ]) {
    mkdirSync(dirname(abs("later", file)), { recursive: true });
    writeFileSync(abs("later", file), "");
  }
  expect({ before, after: findAll() }).toEqual({
    before: {
      "a file": false,
      "a package": false,
      "a file in a directory": false,
      "an entry": false,
      "an entry in a directory": false,
      "a package in a directory": false,
      "an entry, for a request that goes through it": false,
      "an entry before a package whose exports do not give the request": isBun
        ? false
        : notExported("./dist/hidden.js", "withexports"),
      "an entry that a getter looks in too": false,
    },
    after: {
      "a file": "<root>/later/file.js",
      "a package": "<root>/later/package/index.js",
      "a file in a directory": "<root>/later/directory/file.js",
      "an entry": "<root>/later/entry/file.js",
      "an entry in a directory": "<root>/later/above/entry/file.js",
      "a package in a directory": "<root>/later/far/above/package/index.js",
      "an entry, for a request that goes through it": "<root>/later-alone/top.js",
      "an entry before a package whose exports do not give the request":
        "<root>/later/copies/withexports/dist/hidden.js",
      "an entry that a getter looks in too": "<root>/later-nested/file.js",
    },
  });
});

// dd-trace passes the lookup paths of the file that requires. Most of them do not exist.
test("require() finds a node_modules directory that is created after Module._findPath looked for it", () => {
  const app = abs("installed-later", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "main.js"), "");
  const before = find("rootpkg", [abs("node_modules", "rootpkg"), ...Module._nodeModulePaths(app)]);
  for (const [file, content] of [
    ["late-package/index.js", 'module.exports = "late package";'],
    ["late-file.js", 'module.exports = "late file";'],
  ]) {
    mkdirSync(dirname(join(app, "node_modules", file)), { recursive: true });
    writeFileSync(join(app, "node_modules", file), content);
  }
  const requireFromApp = Module.createRequire(join(app, "main.js"));
  expect({ before, "a package": requireFromApp("late-package"), "a file": requireFromApp("late-file") }).toEqual({
    before: "<root>/node_modules/rootpkg/index.js",
    "a package": "late package",
    "a file": "late file",
  });
});

// Where the file system tells `Cased.js` from `cased.js`, so does Module._findPath.
const isCaseSensitive = !existsSync(abs("LIB"));
(isCaseSensitive ? test : test.skip)("a file is found by the name that the file system has for it", () => {
  const nodeModules = abs("plugins", "node_modules");
  const cased = join(nodeModules, "cased");
  const found = {
    "the directory of the package, then node_modules": find("cased", [cased, nodeModules]),
    "the file in another case": find("./cased", [cased]),
    "the file in another case, with its extension": find("./cased.js", [cased]),
    "the file": find("./Cased", [cased]),
    "a directory in another case": find("Plug", [nodeModules]),
    "an entry in another case": find("a", [abs("LIB")]),
    // Bun finds typed.ts for "./typed.js".
    "a .ts file for a .js request in another case": find("./Typed.js", [abs("lib")]),
  };
  // index.js requires "./Cased". It still finds the file after the lookups above.
  const loaded = Module.createRequire(abs("plugins", "host.js"))("cased");
  expect({ found, loaded }).toEqual({
    found: {
      "the directory of the package, then node_modules": "<root>/plugins/node_modules/cased/index.js",
      "the file in another case": false,
      "the file in another case, with its extension": false,
      "the file": "<root>/plugins/node_modules/cased/Cased.js",
      "a directory in another case": false,
      "an entry in another case": false,
      "a .ts file for a .js request in another case": false,
    },
    loaded: "Cased",
  });
});

test("an extension that is added to Module._extensions is added to the request", () => {
  const before = find("./odd", [abs("lib")]);
  Module._extensions[".findpath-extension"] = Module._extensions[".js"];
  try {
    expect({ before, after: find("./odd", [abs("lib")]) }).toEqual({
      before: false,
      after: "<root>/lib/odd.findpath-extension",
    });
  } finally {
    delete Module._extensions[".findpath-extension"];
  }
});

test("Module._findPath is one function however it is reached", () => {
  const detached = Module._findPath;
  expect({
    "the named export of node:module": namedFindPath === Module._findPath,
    "length": Module._findPath.length,
    "a call without a receiver": find("a", [abs("lib")], detached),
    "a call with another receiver": find("a", [abs("lib")], (...args) => detached.apply({}, args)),
  }).toEqual({
    "the named export of node:module": true,
    "length": 3,
    "a call without a receiver": "<root>/lib/a.js",
    "a call with another receiver": "<root>/lib/a.js",
  });
});

// Bun finds what its own require() finds. Node.js finds what its require() finds.
test("the extensions, the conditions and the exports are those of require()", () => {
  const nodeModules = abs("plugins", "node_modules");
  expect({
    // Bun's require() adds .ts and .mjs. That of Node.js does not.
    "a .ts file": find("./typed", [abs("lib")]),
    "a .ts file beside a .js file": find("./both", [abs("lib")]),
    "a .ts file for a .js request": find("./typed.js", [abs("lib")]),
    "the directory of a package that has <name>.mjs, then node_modules": find("rootmjs", [
      join(nodeModules, "rootmjs"),
      nodeModules,
    ]),
    "the bun condition and the node condition": find("conditions", [nodeModules]),
    // Node.js reads exports that are an object, an array or a string.
    "exports that are true": find("exports-true", [nodeModules]),
    // Node.js does not read an export that gives a directory.
    "an export that gives a directory": find("folders/dir/both", [nodeModules]),
    // Bun's require() looks further where the main of a package is no file. Node.js throws.
    "a main that is no file, then an entry that has the package": find("badmain", [
      abs("badmain-first"),
      abs("badmain-second"),
    ]),
  }).toEqual(
    isBun
      ? {
          "a .ts file": "<root>/lib/typed.ts",
          "a .ts file beside a .js file": "<root>/lib/both.ts",
          "a .ts file for a .js request": "<root>/lib/typed.ts",
          "the directory of a package that has <name>.mjs, then node_modules":
            "<root>/plugins/node_modules/rootmjs/rootmjs.mjs",
          "the bun condition and the node condition": "<root>/plugins/node_modules/conditions/for-bun.js",
          "exports that are true": false,
          "an export that gives a directory": "<root>/plugins/node_modules/folders/dist/both.js",
          "a main that is no file, then an entry that has the package": "<root>/badmain-second/badmain/index.js",
        }
      : {
          "a .ts file": false,
          "a .ts file beside a .js file": "<root>/lib/both.js",
          "a .ts file for a .js request": false,
          "the directory of a package that has <name>.mjs, then node_modules":
            "<root>/plugins/node_modules/rootmjs/index.js",
          "the bun condition and the node condition": "<root>/plugins/node_modules/conditions/for-node.js",
          "exports that are true": "<root>/plugins/node_modules/exports-true/index.js",
          "an export that gives a directory": notExported("./dir/both", "folders"),
          "a main that is no file, then an entry that has the package": {
            code: "MODULE_NOT_FOUND",
            message:
              "Cannot find module '<root>/badmain-first/badmain/missing.js'. " +
              'Please verify that the package.json has a valid "main" entry',
            path: "<root>/badmain-first/badmain/package.json",
          },
        },
  );
});

// Only in Bun: these tests need the test harness, and when Node.js runs this file it must not start itself again.
if (isBun) {
  const { bunEnv, bunExe, isDebug, nodeExeAtLeast, tempDir } = await import("harness");

  // On a miss, the resolver asks the registry for a name that no node_modules directory has.
  test("no package is asked of the registry", async () => {
    const requests = [];
    await using registry = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    using dir = tempDir("findpath-no-install", {});
    using cache = tempDir("findpath-no-install-cache", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--install=force",
        "-e",
        `console.log(require("node:module")._findPath("findpath-not-installed", [process.cwd()]));`,
      ],
      env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href, BUN_INSTALL_CACHE_DIR: String(cache) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, requests }).toEqual({
      stdout: "false\n",
      stderr: "",
      exitCode: 0,
      requests: [],
    });
  });

  // Reading an entry can run code that resolves a module. What the resolver logs for the next
  // entry is still no output of the program.
  test("what the resolver logs for an entry is not printed", async () => {
    using dir = tempDir("findpath-log", {
      "first/.keep": "",
      "second/broken/package.json": `{ "name": "broken", "main": `,
      "second/broken/index.js": "",
      "main.cjs": `
        const Module = require("node:module");
        const path = require("node:path");
        const paths = {
          length: 2,
          get 0() {
            try {
              require.resolve("./not-there");
            } catch {}
            return path.join(__dirname, "first");
          },
          1: path.join(__dirname, "second"),
        };
        console.log(path.relative(__dirname, Module._findPath("broken", paths) || ""));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: join("second", "broken", "index.js"),
      stderr: "",
      exitCode: 0,
    });
  });

  // A Worker has its own resolver, and all resolvers have one cache of the directories.
  test("a file that is written after a miss is found while a Worker looks in the same directory", async () => {
    using dir = tempDir("findpath-worker", {
      "worker.cjs": `
        const { parentPort, workerData } = require("node:worker_threads");
        const Module = require("node:module");
        let count = 0;
        (function look() {
          for (let i = 0; i < 4; i++) Module._findPath("missing-" + (count++ % 64), [workerData]);
          setImmediate(look);
        })();
        parentPort.postMessage("looking");
      `,
    });
    const directory = String(dir);
    const worker = new Worker(join(directory, "worker.cjs"), { workerData: directory });
    try {
      await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      const notFound = [];
      for (let i = 0; i < 25; i++) {
        const name = "written-" + i;
        const before = Module._findPath(name, [directory]);
        writeFileSync(join(directory, name + ".js"), "");
        const after = Module._findPath(name, [directory]);
        if (before !== false || after !== join(directory, name + ".js")) notFound.push({ name, before, after });
      }
      expect(notFound).toEqual([]);
    } finally {
      await worker.terminate();
    }
  });

  const node = nodeExeAtLeast("26.3.0");
  (node ? test : test.skip)("all tests pass in Node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [node, fileURLToPath(import.meta.url)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  });

  // `bun build --compile` copies the whole bun binary. That of a debug build is 1.6 GB.
  test(
    "the modules of a standalone executable are found",
    async () => {
      using dir = tempDir("findpath-standalone", {
        "entry.mjs": `
        import { _findPath } from "node:module";
        import path from "node:path";
        const self = import.meta.path;
        const root = path.dirname(self);
        const name = path.basename(self);
        console.log(JSON.stringify({
          absolute: _findPath(self) === self,
          relative: _findPath("./" + name, [root]) === self,
          bare: _findPath(name, [root]) === self,
          missing: [_findPath("./nowhere", [root]), _findPath(path.join(root, "nowhere"))],
        }));
      `,
      });
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "entry.mjs", "--outfile", "app"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExitCode] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect({ stderr: buildExitCode === 0 ? "" : buildStderr, exitCode: buildExitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });

      // The directory of the executable is not the current directory, so nothing is found on disk by accident.
      using cwd = tempDir("findpath-standalone-cwd", {});
      await using proc = Bun.spawn({
        cmd: [join(String(dir), isWindows ? "app.exe" : "app")],
        cwd: String(cwd),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ absolute: true, relative: true, bare: true, missing: [false, false] }),
        stderr: "",
        exitCode: 0,
      });
    },
    // A debug build takes a minute to copy. A release build keeps the timeout that the run has.
    isDebug ? 180_000 : undefined,
  );
}
