import { beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { basename } from "node:path";
globalThis.importQueryFixtureOrder = [];
const resolvedPath = require.resolve("./import-query-fixture.ts");
const resolvedURL = Bun.pathToFileURL(resolvedPath).href;

beforeEach(() => {
  globalThis.importQueryFixtureOrder = [];
  delete require.cache[resolvedPath];
  delete require.cache[resolvedPath + "?query"];
  delete require.cache[resolvedPath + "?query2"];
});

test("[query, no query]", async () => {
  const second = await import("./import-query-fixture.ts?query" as string);
  const first = await import("./import-query-fixture.ts");
  expect(second.url).toBe(first.url + "?query");
  expect(globalThis.importQueryFixtureOrder).toEqual([resolvedURL + "?query", resolvedURL]);
});

test("[no query, query]", async () => {
  const first = await import("./import-query-fixture.ts");
  const second = await import("./import-query-fixture.ts?query" as string);
  expect(second.url).toBe(first.url + "?query");
  expect(globalThis.importQueryFixtureOrder).toEqual([resolvedURL, resolvedURL + "?query"]);
});

for (let order of [
  [resolvedPath, resolvedPath + "?query", resolvedPath + "?query2"],
  [resolvedPath + "?query", resolvedPath + "?query2", resolvedPath],
  [resolvedPath + "?query", resolvedPath, resolvedPath + "?query2"],
  [resolvedPath, resolvedPath + "?query2", resolvedPath + "?query"],
  [resolvedPath + "?query2", resolvedPath, resolvedPath + "?query"],
  [resolvedPath + "?query2", resolvedPath + "?query", resolvedPath],
]) {
  test(`[${order.map(url => url.replaceAll(import.meta.dir, "")).join(", ")}]`, async () => {
    for (const url of order) {
      await import(url);
    }

    expect(globalThis.importQueryFixtureOrder).toEqual(
      order.map(url => resolvedURL + (url.includes("?") ? "?" + url.split("?")[1] : "")),
    );
  });
}

// When the specifier contains non-ASCII characters (so toUTF8() must allocate a
// fresh buffer on the Zig side), the query string returned to C++ must not point
// into that freed buffer. With ASAN this is a heap-use-after-free; without it the
// resolved key comes back corrupted.
test("query string with non-ASCII specifier (dynamic import)", async () => {
  using dir = tempDir("import-query-nonascii", {
    "target.js": `console.log(JSON.stringify(import.meta.url));`,
    "entry.js": `await import("./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const url = JSON.parse(stdout.trim());
  expect(decodeURIComponent(url)).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});

test("query string with non-ASCII specifier (static import)", async () => {
  using dir = tempDir("import-query-nonascii-static", {
    "target.js": `console.log(JSON.stringify(import.meta.url));`,
    "entry.js": `import "./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e";`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const url = JSON.parse(stdout.trim());
  expect(decodeURIComponent(url)).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});

// A `.node` (Node-API addon) specifier must behave the same with and without a
// `?query` suffix. Query-suffixed spellings used to bypass the `.node` checks
// (which run before the query is stripped) and abort the process with
// `panic: entered unreachable code: napi modules go through provideFetch()`.
const NAPI_IMPORT_ERROR = "To load Node-API modules, use require() or process.dlopen instead of import.";

test("dynamic import of a .node addon ignores a query string suffix", async () => {
  using dir = tempDir("import-query-napi-dynamic", {
    "addon.node": "",
    "entry.mjs": `
      const out = [];
      for (const spec of ["./addon.node", "./addon.node?v=1", "./addon.node?v=2"]) {
        try {
          await import(spec);
          out.push(null);
        } catch (e) {
          out.push(e.constructor.name + ": " + e.message);
        }
      }
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify([
      `TypeError: ${NAPI_IMPORT_ERROR}`,
      `TypeError: ${NAPI_IMPORT_ERROR}`,
      `TypeError: ${NAPI_IMPORT_ERROR}`,
    ]),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("static import of a .node addon ignores a query string suffix", async () => {
  using dir = tempDir("import-query-napi-static", {
    "addon.node": "",
    "entry.mjs": `import "./addon.node?update=1";`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    firstLine: normalizeBunSnapshot(stderr, String(dir)).split("\n")[0],
    stdout,
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
    firstLine: `TypeError: ${NAPI_IMPORT_ERROR}`,
    stdout: "",
    exitCode: 1,
    signalCode: null,
  });
});

test("require of a .node addon with a query string reaches process.dlopen", async () => {
  using dir = tempDir("import-query-napi-require", {
    "addon.node": "",
    "entry.cjs": `
      const out = [];
      for (const spec of ["./addon.node", "./addon.node?v=1", "./addon.node?v=2"]) {
        try {
          require(spec);
          out.push(null);
        } catch (e) {
          out.push(e.constructor.name + ": " + e.message);
        }
      }
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({ stderr: "", exitCode: 0, signalCode: null });
  const [plain, withQuery, withOtherQuery] = JSON.parse(stdout.trim());
  // An empty `.node` file cannot be dlopen'd. The query-suffixed spellings must
  // fail with the identical dlopen error (proving the on-disk path was
  // stripped of the query), not the ESM "use require()" TypeError.
  expect(plain).not.toContain("Node-API");
  expect(withQuery).toBe(plain);
  expect(withOtherQuery).toBe(plain);
});

test("import of an extension mapped to the napi loader throws instead of crashing", async () => {
  using dir = tempDir("import-query-napi-loader-flag", {
    "thing.xyz": "",
    "entry.mjs": `
      try {
        await import("./thing.xyz");
        console.log(JSON.stringify(null));
      } catch (e) {
        console.log(JSON.stringify(e.constructor.name + ": " + e.message));
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--loader=.xyz:napi", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify(`TypeError: ${NAPI_IMPORT_ERROR}`),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("Bun.resolveSync with non-ASCII specifier and query string", async () => {
  using dir = tempDir("resolve-query-nonascii", {
    "target.js": ``,
    "entry.js": `console.log(JSON.stringify(Bun.resolveSync("./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e", import.meta.dir)));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const resolved = JSON.parse(stdout.trim());
  expect(resolved).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});

// The module key of a module imported with a `?query` is `<abs path>?query`, and
// that key is the referrer for the module's own imports. A `/` inside the query
// must not be taken as the last path separator of the referrer.
test("static imports inside a module imported with a ?query containing / resolve", async () => {
  using dir = tempDir("import-query-slash-referrer-esm", {
    "sub/b.mjs": `export const b = 42;`,
    "a.mjs": `import { b } from "./sub/b.mjs"; export const a = b; export const url = import.meta.url;`,
    "entry.mjs": `
      import { a as viaStatic, url as staticUrl } from "./a.mjs?path=/x/y";
      const dyn = await import("./a.mjs?dir=/x/y/&flag");
      console.log(JSON.stringify({
        viaStatic,
        staticUrl: staticUrl.slice(staticUrl.lastIndexOf("/a.mjs") + 1),
        viaDynamic: dyn.a,
        dynamicUrl: dyn.url.slice(dyn.url.lastIndexOf("/a.mjs") + 1),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    viaStatic: 42,
    staticUrl: "a.mjs?path=/x/y",
    viaDynamic: 42,
    dynamicUrl: "a.mjs?dir=/x/y/&flag",
  });
  expect(exitCode).toBe(0);
});

// Same for a CommonJS module: its key is the referrer for `require()`, and
// `__dirname`, `module.paths` and `require.resolve.paths()` derive from it.
test("require() inside a CommonJS module loaded with a ?query containing / resolves", async () => {
  using dir = tempDir("import-query-slash-referrer-cjs", {
    "sub/b.cjs": `module.exports = { b: 42 };`,
    "a.cjs": `
      const path = require("node:path");
      module.exports = {
        b: require("./sub/b.cjs").b,
        resolved: path.relative(__dirname, require.resolve("./sub/b.cjs")).replaceAll(path.sep, "/"),
        dirname: path.basename(__dirname),
        paths0: path.basename(path.dirname(module.paths[0])) + "/" + path.basename(module.paths[0]),
        lookupRelative: path.basename(require.resolve.paths("./sub/b.cjs")[0]),
        lookupBare: path.basename(path.dirname(require.resolve.paths("pkg")[0])) + "/" + path.basename(require.resolve.paths("pkg")[0]),
      };
    `,
    // The two loads have different keys, so each one goes through the loader.
    "entry.cjs": `
      import("./a.cjs?path=/x/y").then(imported => {
        console.log(JSON.stringify({ imported: imported.default, required: require("./a.cjs?path=/x/z") }));
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const dirName = basename(String(dir));
  const expected = {
    b: 42,
    resolved: "sub/b.cjs",
    dirname: dirName,
    paths0: dirName + "/node_modules",
    lookupRelative: dirName,
    lookupBare: dirName + "/node_modules",
  };
  expect(JSON.parse(stdout.trim())).toEqual({ imported: expected, required: expected });
  expect(exitCode).toBe(0);
});

// With `..` in the query, the directory that was taken from the key is another directory
// that exists. It has the same file names, so the module got the wrong files with no error.
test("a ?query with .. in it does not move a module's imports to another directory", async () => {
  using dir = tempDir("import-query-dot-dot", {
    "app/dep.mjs": `export default "app";`,
    "app/dep.cjs": `module.exports = "app";`,
    "app/a.mjs": `import dep from "./dep.mjs"; export default dep;`,
    "app/a.cjs": `module.exports = require("./dep.cjs");`,
    "decoy/dep.mjs": `export default "decoy";`,
    "decoy/dep.cjs": `module.exports = "decoy";`,
    "entry.mjs": `
      import { createRequire } from "node:module";
      import esm from "./app/a.mjs?next=/../../decoy/x";
      import cjsImported from "./app/a.cjs?next=/../../decoy/x";
      const cjsRequired = createRequire(import.meta.url)("./app/a.cjs?next=/../../decoy/y");
      console.log(JSON.stringify({ esm, cjsImported, cjsRequired }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ esm: "app", cjsImported: "app", cjsRequired: "app" });
  expect(exitCode).toBe(0);
});

// A `Module._extensions` hook that wraps `module._compile` (pirates, @babel/register) gets the
// source from Bun's loader, so the loader knows the path of that module too.
test("a module that a Module._extensions hook compiles resolves from its own directory", async () => {
  using dir = tempDir("import-query-extensions-hook", {
    "app/dep.js": `module.exports = "app";`,
    "app/dep.mjs": `export default "app";`,
    "app/a.js": `
      const path = require("node:path");
      module.exports = import("./dep.mjs").then(imported => ({
        required: require("./dep.js"),
        imported: imported.default,
        dirname: path.basename(__dirname),
        modulePath: path.basename(module.path),
        paths0: path.basename(path.dirname(module.paths[0])),
      }));
    `,
    "decoy/dep.js": `module.exports = "decoy";`,
    "decoy/dep.mjs": `export default "decoy";`,
    "entry.cjs": `
      const Module = require("node:module");
      const load = Module._extensions[".js"];
      let compiled = 0;
      let copy = false;
      let paths;
      let read;
      Module._extensions[".js"] = (module, filename) => {
        // A hook can read module.paths before the loader reads the file, and can assign it.
        if (paths === "read") {
          read = module;
          module.paths;
          return load(module, filename);
        }
        if (paths === "assign") module.paths = ["/assigned/node_modules", ...module.paths];
        const compile = module._compile;
        module._compile = function (code, file) {
          compiled++;
          // A hook can pass on another string with the same text.
          return compile.call(this, code, copy ? file.slice(0, 1) + file.slice(1) : file);
        };
        return load(module, filename);
      };
      // A hook is chosen by the extension at the end of the key.
      (async () => {
        const same = await require("./app/a.js?next=/../../decoy/x.js");
        copy = true;
        const copied = await require("./app/a.js?next=/../../decoy/y.js");
        const result = { compiled, same, copied };
        copy = false;
        paths = "read";
        result.pathsRead = await require("./app/a.js?next=/../../decoy/z.js");
        paths = "assign";
        result.pathsAssigned = await require("./app/a.js?next=/../../decoy/w.js");
        // The loader can give a module its source again.
        read.paths.push("/pushed/node_modules");
        read.path = "/assigned";
        read.loaded = false;
        load(read, read.filename);
        result.loadedAgain = { path: read.path, lastPath: read.paths.at(-1) };
        console.log(JSON.stringify(result));
      })();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const expected = { required: "app", imported: "app", dirname: "app", modulePath: "app", paths0: "app" };
  expect(JSON.parse(stdout.trim())).toEqual({
    compiled: 3,
    same: expected,
    copied: expected,
    // The list that the hook read came from the whole key: the module derives its own list again.
    pathsRead: expected,
    // A list that the hook assigned stays, as for any other key.
    pathsAssigned: { ...expected, paths0: "assigned" },
    // What JS changed after the first load stays too.
    loadedAgain: { path: "/assigned", lastPath: "/pushed/node_modules" },
  });
  expect(exitCode).toBe(0);
});

// The loader records where the path ends in its key, in code units of the key. The directory name
// is not ASCII, so a count of bytes would end at another place. The parent has the same file names.
test("a module loaded with a ?query in a non-ASCII directory resolves from that directory", async () => {
  using dir = tempDir("import-query-non-ascii-dir", {
    "sub/b.cjs": `module.exports = "parent";`,
    "sub/b.mjs": `export default "parent";`,
    "other/sub/b.cjs": `module.exports = "other";`,
    "日本語/sub/b.cjs": `module.exports = "inside";`,
    "日本語/sub/b.mjs": `export default "inside";`,
    "日本語/a.mjs": `import b from "./sub/b.mjs"; export default b;`,
    "日本語/a.cjs": `
      const Module = require("node:module");
      const path = require("node:path");

      const root = globalThis.root;
      const rel = p => path.relative(root, p).replaceAll(path.sep, "/");
      const other = path.join(root, "other", "f.cjs");
      const missing = () => {
        try {
          return require.resolve("./missing.cjs");
        } catch (e) {
          return e.code;
        }
      };

      const out = {
        b: require("./sub/b.cjs"),
        resolved: rel(require.resolve("./sub/b.cjs")),
        dirname: rel(__dirname),
        modulePath: rel(module.path),
        paths0: rel(module.paths[0]),
        lookupRelative: require.resolve.paths("./sub/b.cjs").map(rel),
        lookupBare: rel(require.resolve.paths("pkg")[0]),
        resolveFilename: rel(Module._resolveFilename("./sub/b.cjs", module)),
        lookupPaths: Module._resolveLookupPaths("./sub/b.cjs", module).map(rel),
        missing: missing(),
      };

      // An own \`filename\` property hides the accessor. It is a path, not the key of this module.
      Object.defineProperty(module, "filename", { value: other, configurable: true });
      out.ownFilename = rel(require.resolve("./sub/b.cjs"));
      delete module.filename;
      out.afterDelete = rel(require.resolve("./sub/b.cjs"));

      // An assignment to \`module.filename\` replaces the key.
      module.filename = other;
      out.assigned = rel(require.resolve("./sub/b.cjs"));
      out.assignedLookup = require.resolve.paths("./sub/b.cjs").map(rel);
      out.assignedResolveFilename = rel(Module._resolveFilename("./sub/b.cjs", module));

      module.exports = out;
    `,
    // Each load has its own key, so each one goes through the loader.
    "entry.cjs": `
      globalThis.root = __dirname;
      (async () => {
        const out = {};
        for (const query of ["?path=/x/y", "?v=1"]) {
          out[query] = {
            esmImported: (await import("./日本語/a.mjs" + query)).default,
            esmRequired: require("./日本語/a.mjs" + query + "&required").default,
            cjsImported: (await import("./日本語/a.cjs" + query)).default,
            cjsRequired: require("./日本語/a.cjs" + query + "&required"),
          };
        }
        console.log(JSON.stringify(out));
      })();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const cjs = {
    b: "inside",
    resolved: "日本語/sub/b.cjs",
    dirname: "日本語",
    modulePath: "日本語",
    paths0: "日本語/node_modules",
    lookupRelative: ["日本語"],
    lookupBare: "日本語/node_modules",
    resolveFilename: "日本語/sub/b.cjs",
    lookupPaths: ["日本語"],
    missing: "MODULE_NOT_FOUND",
    ownFilename: "other/sub/b.cjs",
    afterDelete: "日本語/sub/b.cjs",
    assigned: "other/sub/b.cjs",
    assignedLookup: ["other"],
    assignedResolveFilename: "other/sub/b.cjs",
  };
  const loads = { esmImported: "inside", esmRequired: "inside", cjsImported: cjs, cjsRequired: cjs };
  expect(JSON.parse(stdout.trim())).toEqual({ "?path=/x/y": loads, "?v=1": loads });
  expect(exitCode).toBe(0);
});

// A file path that the user passes in is not a module key: a `?` in one of its
// directories is part of the name. The parent directory has the same file names,
// so a resolve from the parent returns the wrong file with no error.
test.skipIf(isWindows)("a file path in a directory with ? in its name resolves inside that directory", async () => {
  const project = {
    "package.json": `{ "name": "project" }`,
    "config.json": `{ "from": "project" }`,
    "node_modules/some-plugin/package.json": `{ "name": "some-plugin", "main": "index.js" }`,
    "node_modules/some-plugin/index.js": `module.exports = "project";`,
  };
  using dir = tempDir("import-query-question-mark-dir", {
    "config.json": `{ "from": "parent" }`,
    "node_modules/some-plugin/package.json": `{ "name": "some-plugin", "main": "index.js" }`,
    "node_modules/some-plugin/index.js": `module.exports = "parent";`,
    "what?": project,
    "wh?at": project,
    "entry.mjs": `
      import fs from "node:fs";
      import Module, { createRequire } from "node:module";
      import path from "node:path";
      import { fileURLToPath } from "node:url";
      import vm from "node:vm";

      const root = import.meta.dirname;
      const rel = p => path.relative(root, p).replaceAll(path.sep, "/");
      const load = async fn => {
        try {
          return await fn();
        } catch (e) {
          return e.message.replaceAll(root, "<root>");
        }
      };

      const probe = async name => {
        const project = path.join(root, name);
        const file = path.join(project, "package.json");
        const req = createRequire(file);
        const parent = { id: file, filename: file, paths: Module._nodeModulePaths(project) };
        return {
          resolved: {
            relative: rel(req.resolve("./config.json")),
            readWithFs: JSON.parse(fs.readFileSync(req.resolve("./config.json"), "utf8")).from,
            bare: rel(req.resolve("some-plugin")),
            pathsRelative: req.resolve.paths("./x").map(rel),
            pathsBare: rel(req.resolve.paths("some-plugin")[0]),
            trailingSlash: rel(createRequire(project + path.sep).resolve("./config.json")),
            resolveFilenameRelative: rel(Module._resolveFilename("./config.json", parent)),
            resolveFilenameBare: rel(Module._resolveFilename("some-plugin", parent)),
            resolveLookupPaths: Module._resolveLookupPaths("./x", parent).map(rel),
            findPath: rel(Module._findPath("some-plugin", [path.join(project, "node_modules")])),
            importMetaResolve: rel(fileURLToPath(import.meta.resolve("some-plugin", file))),
          },
          loaded: {
            requireRelative: await load(() => req("./config.json").from),
            requireBare: await load(() => req("some-plugin")),
            vmImport: await load(async () => {
              const namespace = await vm.runInThisContext('import("./config.json", { with: { type: "json" } })', {
                filename: path.join(project, "virtual.js"),
                importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
              });
              return namespace.default.from;
            }),
          },
        };
      };

      console.log(JSON.stringify({ "what?": await probe("what?"), "wh?at": await probe("wh?at") }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(Object.keys(result)).toEqual(["what?", "wh?at"]);
  for (const [name, { resolved, loaded }] of Object.entries<any>(result)) {
    expect(resolved).toEqual({
      relative: `${name}/config.json`,
      readWithFs: "project",
      bare: `${name}/node_modules/some-plugin/index.js`,
      pathsRelative: [name],
      pathsBare: `${name}/node_modules`,
      trailingSlash: `${name}/config.json`,
      resolveFilenameRelative: `${name}/config.json`,
      resolveFilenameBare: `${name}/node_modules/some-plugin/index.js`,
      resolveLookupPaths: [name],
      findPath: `${name}/node_modules/some-plugin/index.js`,
      importMetaResolve: `${name}/node_modules/some-plugin/index.js`,
    });
    // Bun cannot load a file under such a directory yet: the loader reads the path up to the `?` (#7928).
    // The load fails. It does not get the parent's file.
    const enoent = `ENOENT reading "<root>/${name.slice(0, name.indexOf("?"))}"`;
    expect(loaded).toEqual({ requireRelative: enoent, requireBare: enoent, vmImport: enoent });
  }
  expect(exitCode).toBe(0);
});

// Bun's loader is not involved when a `Module._extensions` handler reads the file, so a whole
// graph under such a directory runs. The other calls only take a directory from a string.
test.skipIf(isWindows)("a directory named what? keeps its modules and its lookup paths", async () => {
  using dir = tempDir("import-query-question-mark-graph", {
    "lib/util.js": `module.exports = "parent";`,
    "node_modules/dep/index.js": `module.exports = "parent";`,
    "other/x.js": `module.exports = "other";`,
    "what?/lib/util.js": `module.exports = "project";`,
    "what?/node_modules/dep/index.js": `module.exports = "project";`,
    "what?/main.js": `
      const path = require("node:path");
      module.exports = {
        dirname: path.basename(__dirname),
        modulePath: path.basename(module.path),
        paths0: module.paths[0],
        lookupRelative: require.resolve.paths("./x"),
        relative: require("./lib/util"),
        bare: require("dep"),
      };
    `,
    "entry.cjs": `
      const fs = require("node:fs");
      const Module = require("node:module");
      const path = require("node:path");

      const root = __dirname;
      const rel = p => path.relative(root, p).replaceAll(path.sep, "/");
      const code = fn => {
        try {
          return fn();
        } catch (e) {
          return e.code;
        }
      };

      Module._extensions[".js"] = (module, filename) => module._compile(fs.readFileSync(filename, "utf8"), filename);
      const hooked = Module.createRequire(path.join(root, "what?", "package.json"))("./main.js");
      hooked.paths0 = rel(hooked.paths0);
      hooked.lookupRelative = hooked.lookupRelative.map(rel);

      const later = Module.createRequire(path.join(root, "later?", "package.json"));
      const beforeMkdir = later.resolve.paths("./config.json").map(rel);
      fs.mkdirSync(path.join(root, "later?"));
      fs.writeFileSync(path.join(root, "later?", "config.json"), "{}");

      const missing = Module.createRequire(path.join(root, "missing?", "sub", "x.js"));
      // Node reads the argument of createRequire() as a path. It has no query.
      const withQuery = Module.createRequire(path.join(root, "other", "x.js") + "?v=/a/b");

      console.log(
        JSON.stringify({
          hooked,
          beforeMkdir,
          afterMkdir: rel(later.resolve("./config.json")),
          missingRelative: missing.resolve.paths("./y").map(rel),
          missingBare: rel(missing.resolve.paths("pkg")[0]),
          missingLookup: Module._resolveLookupPaths("./y", { id: "x", filename: path.join(root, "missing?", "sub", "x.js") }).map(rel),
          queryLookup: withQuery.resolve.paths("./x.js").map(rel),
          queryResolve: code(() => withQuery.resolve("./x.js")),
        }),
      );
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    hooked: {
      dirname: "what?",
      modulePath: "what?",
      paths0: "what?/node_modules",
      lookupRelative: ["what?"],
      relative: "project",
      bare: "project",
    },
    beforeMkdir: ["later?"],
    afterMkdir: "later?/config.json",
    missingRelative: ["missing?/sub"],
    missingBare: "missing?/sub/node_modules",
    missingLookup: ["missing?/sub"],
    queryLookup: ["other/x.js?v=/a"],
    queryResolve: "MODULE_NOT_FOUND",
  });
  expect(exitCode).toBe(0);
});
