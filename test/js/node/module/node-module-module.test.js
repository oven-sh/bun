import "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, ospath, tempDir } from "harness";
import Module, { _nodeModulePaths, builtinModules, createRequire, isBuiltin, wrap } from "module";
import path from "path";
import storesThatEndInADefinition from "../../bun/jsc/stores-that-end-in-a-definition-fixture.js";

const storesFixture = path.join(
  import.meta.dir,
  "..",
  "..",
  "bun",
  "jsc",
  "stores-that-end-in-a-definition-fixture.js",
);

describe.concurrent("node-module-module", () => {
  test("builtinModules exists", () => {
    expect(Array.isArray(builtinModules)).toBe(true);
    // "bun:wrap" is no longer listed: it is internal transpiler plumbing,
    // not a requireable public module.
    expect(builtinModules).toHaveLength(76);
  });

  test("isBuiltin() works", () => {
    expect(isBuiltin("fs")).toBe(true);
    expect(isBuiltin("path")).toBe(true);
    expect(isBuiltin("crypto")).toBe(true);
    expect(isBuiltin("assert")).toBe(true);
    expect(isBuiltin("util")).toBe(true);
    expect(isBuiltin("events")).toBe(true);
    expect(isBuiltin("node:events")).toBe(true);
    expect(isBuiltin("node:bacon")).toBe(false);
    expect(isBuiltin("node:test")).toBe(true);
    expect(isBuiltin("test")).toBe(false); // "test" does not alias to "node:test"
  });

  test("_stat() says what is at a path", () => {
    expect(Module._stat(import.meta.path)).toBe(0);
    expect(Module._stat(import.meta.dir)).toBe(1);
    expect(Module._stat(path.join(import.meta.dir, "does-not-exist"))).toBe(-1);
    // The path is converted to a string, an argument that was not passed included.
    expect(Module._stat()).toBe(-1);
    expect(Module._stat(undefined)).toBe(-1);
  });

  test("module.globalPaths exists", () => {
    expect(Array.isArray(require("module").globalPaths)).toBe(true);
  });

  test("Object.entries(Module) passes exception check validation", async () => {
    // jest-runtime copies Module's statics this way. Release builds ignore the option, so they only check that
    // the copy is complete.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const Module = require("node:module");
         const copy = Object.fromEntries(Object.entries(Module));
         const missing = Object.keys(Module).filter(key => !(key in copy));
         console.log(JSON.stringify({ missing, builtinModules: copy.builtinModules.length, globalPaths: Array.isArray(copy.globalPaths) }));`,
      ],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ missing: [], builtinModules: 76, globalPaths: true }),
      stderr: "",
      exitCode: 0,
    });
  });

  test("Module._findPath propagates an error thrown by an onResolve plugin", async () => {
    // Plugins are process-global; run in a child so the throwing resolver can't affect other tests.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.plugin({ name: "throws", setup(b) { b.onResolve({ filter: /\\.findpathprobe$/ }, () => { throw new Error("onResolve threw"); }); } });
        try {
          console.log("returned", require("module")._findPath("thing.findpathprobe", [process.cwd()]));
        } catch (e) {
          console.log("threw", e.message);
        }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("threw onResolve threw");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("Module.prototype is not enumerable", async () => {
    const Module = require("module");
    const { value, ...descriptor } = Object.getOwnPropertyDescriptor(Module, "prototype");
    expect(descriptor).toEqual({ writable: true, enumerable: false, configurable: false });
    expect(value).toBe(Module.prototype);
    expect(Object.keys(Module)).not.toContain("prototype");
    // and so, as in Node, it is not a named export of the ES module either
    const ns = await import("node:module");
    expect(Object.keys(ns)).not.toContain("prototype");
    expect(ns.default.prototype).toBe(Module.prototype);
  });

  // jest-runtime builds the `Module` it hands to tests this way. Assigning a class's `prototype` throws, so this
  // needs `prototype` to be non-enumerable; and the copy goes through the inherited `wrapper` / `_resolveFilename`
  // / `runMain` setters with their current values, which must not count as overriding them (an overridden wrapper
  // re-wraps every CommonJS module from source and bypasses the --isolate SourceProvider cache).
  test("Module's enumerable statics can be copied onto a subclass without overriding the CJS wrapper", async () => {
    using dir = tempDir("module-statics-copy", {
      "dep.cjs": `module.exports = "dep";`,
      "dep2.cjs": `module.exports = "dep2";`,
      "copy.test.js": `
        const { test, expect } = require("bun:test");
        const { isolatedModuleCacheSourceType } = require("bun:internal-for-testing");
        const Module = require("node:module");
        test("copy statics", () => {
          class Sub extends Module.Module {}
          for (const [key, value] of Object.entries(Module.Module)) Sub[key] = value;
          expect(Sub.prototype).toBeInstanceOf(Module);
          expect(Sub._extensions).toBe(Module._extensions);
          expect(Sub.wrapper[0]).toBe(Module.wrapper[0]);

          expect(require("./dep.cjs")).toBe("dep");
          expect(isolatedModuleCacheSourceType(require.resolve("./dep.cjs"))).toBe("Program");

          // A real override still takes effect (and such modules are not cached).
          Module.wrapper = ["(function(exports,require,module,__filename,__dirname){module.wrapped = true;", "})"];
          expect(require("./dep2.cjs")).toBe("dep2");
          expect(require.cache[require.resolve("./dep2.cjs")].wrapped).toBe(true);
          expect(isolatedModuleCacheSourceType(require.resolve("./dep2.cjs"))).toBe(null);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./copy.test.js"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("module.enableCompileCache validates its argument", () => {
    expect(Module.enableCompileCache.length).toBe(1);
    for (const invalid of [0, null, false, 1, NaN, true, Symbol(0)]) {
      expect(() => Module.enableCompileCache(invalid)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    }
    expect(() => Module.enableCompileCache({ directory: 1 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // A function is not treated as an options bag (typeof === "object" in node).
    expect(() => Module.enableCompileCache(function () {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // A throwing getter propagates unchanged.
    expect(() =>
      Module.enableCompileCache({
        get directory() {
          throw new RangeError("boom");
        },
      }),
    ).toThrow(RangeError);
    // Node destructures `directory` then `portable` before validating, so a throwing
    // `portable` getter propagates even when `directory` is already invalid.
    const order = [];
    expect(() =>
      Module.enableCompileCache({
        get directory() {
          order.push("directory");
          return 42;
        },
        get portable() {
          order.push("portable");
          throw new RangeError("portable boom");
        },
      }),
    ).toThrow(new RangeError("portable boom"));
    expect(order).toEqual(["directory", "portable"]);
  });

  test("module.enableCompileCache accepts valid shapes", async () => {
    // Run in a child so enabling the cache doesn't affect this test process.
    using dir = tempDir("compile-cache-shapes", {});
    const cacheDir = JSON.stringify(path.join(String(dir), "cc"));
    // Valid shapes: string | {directory?, portable?} | undefined. The first
    // call enables the cache; the rest report ALREADY_ENABLED.
    const code = `
      const Module = require("module");
      const { ENABLED, ALREADY_ENABLED } = Module.constants.compileCacheStatus;
      const shapes = [
        ${cacheDir},
        undefined,
        {},
        [],
        Object.create(null),
        { directory: ${cacheDir} },
        { directory: undefined },
      ];
      for (const shape of shapes) {
        const r = Module.enableCompileCache(shape);
        if (r.status !== ENABLED && r.status !== ALREADY_ENABLED) {
          console.error("unexpected status", r.status, JSON.stringify(r));
          process.exit(1);
        }
        if (typeof r.directory !== "string") {
          console.error("missing directory", JSON.stringify(r));
          process.exit(1);
        }
      }
      console.log("shapes-ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("shapes-ok");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.skipIf(process.platform === "win32")(
    "compile cache persists modules loaded after a non-fatal self-kill",
    async () => {
      // A self-directed signal that proves non-fatal (SIGWINCH is ignored by
      // default) must not latch the exit-time persist: modules loaded after
      // the kill still reach the cache when the process really exits.
      using dir = tempDir("compile-cache-selfkill", {
        "late.js": "module.exports = 42;",
        "main.js": `process.kill(process.pid, "SIGWINCH");
console.log("survived", require("./late.js"));`,
      });
      const cacheDir = path.join(String(dir), "cc");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        env: { ...bunEnv, NODE_COMPILE_CACHE: cacheDir },
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("survived 42");
      expect(exitCode).toBe(0);
      // Both main.js and late.js are cached; pre-fix only main.js was.
      const files = [...new Bun.Glob("**/*").scanSync({ cwd: cacheDir, onlyFiles: true })];
      expect(files.length).toBe(2);
    },
  );

  test.skipIf(!isWindows)("enableCompileCache default dir prefers TEMP over TMP like os.tmpdir", async () => {
    using dir = tempDir("compile-cache-tmporder", {});
    const temp = path.join(String(dir), "from-temp");
    const tmp = path.join(String(dir), "from-tmp");
    fs.mkdirSync(temp);
    fs.mkdirSync(tmp);
    const env = { ...bunEnv, TEMP: temp, TMP: tmp };
    delete env.NODE_COMPILE_CACHE;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = require("module").enableCompileCache();
        console.log(JSON.stringify(r.directory));`,
      ],
      env,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toStartWith(path.join(temp, "node-compile-cache"));
    expect(exitCode).toBe(0);
  });

  test("compile cache entries are keyed by sha256 and accepted on re-run", async () => {
    using dir = tempDir("compile-cache-sha", {
      "main.js": `console.log(require("./dep.js"));`,
      "dep.js": "module.exports = 7;",
    });
    const cacheDir = path.join(String(dir), "cc");
    const env = { ...bunEnv, NODE_COMPILE_CACHE: cacheDir, NODE_DEBUG_NATIVE: "COMPILE_CACHE" };
    {
      await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env, cwd: String(dir), stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("7");
      expect(exitCode).toBe(0);
    }
    // Entry names are the first 8 bytes of SHA256(type byte || path) in hex.
    const files = [...new Bun.Glob("**/*").scanSync({ cwd: cacheDir, onlyFiles: true })];
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(path.basename(f)).toMatch(/^[0-9a-f]{16}$/);
    }
    {
      await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env, cwd: String(dir), stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("7");
      // The second run accepts both entries from disk and rewrites nothing.
      expect(stderr).toContain("was accepted");
      expect(stderr).not.toContain("writing cache");
      expect(exitCode).toBe(0);
    }
  });

  test("compile cache writes do not run the bytecode optimizer", async () => {
    // The optimizer is for `bun build --bytecode`, where it runs once. A compile cache
    // write runs on every cold start, after `exit`, so it must skip the optimizer.
    // `BUN_JSC_reportBytecodeOptimizer=1` prints one line per code block the optimizer touches.
    using dir = tempDir("compile-cache-no-optimizer", {
      "main.mjs": `import { f } from "./dep.mjs"; console.log(f(1));`,
      "dep.mjs": `export function f(a) { let x = a + 1; return x; }`,
    });
    const cacheDir = path.join(String(dir), "cc");
    const env = {
      ...bunEnv,
      NODE_COMPILE_CACHE: cacheDir,
      NODE_DEBUG_NATIVE: "COMPILE_CACHE",
      BUN_JSC_reportBytecodeOptimizer: "1",
    };
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.mjs"], env, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("2");
    expect(stderr).toMatch(/writing cache for ESM .*dep\.mjs.*success/);
    expect(stderr).not.toContain("BytecodeOptimizer:");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("compile cache entries are created 0600 like Node", async () => {
    // Entries hold the module's post-transpile source, and the default cache
    // location is a world-readable tmpdir; Node creates entry files 0600.
    using dir = tempDir("compile-cache-mode", {
      "main.js": `process.umask(0o022); console.log(require("./dep.js"));`,
      "dep.js": "module.exports = 7;",
    });
    const cacheDir = path.join(String(dir), "cc");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, NODE_COMPILE_CACHE: cacheDir },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("7");
    expect(stderr).toBe("");
    const files = [...new Bun.Glob("**/*").scanSync({ cwd: cacheDir, onlyFiles: true })];
    expect(files.length).toBe(2);
    const modes = files.map(f => (fs.statSync(path.join(cacheDir, f)).mode & 0o777).toString(8));
    expect(modes).toEqual(["600", "600"]);
    expect(exitCode).toBe(0);
  });

  const compileCacheEnv = { ...bunEnv };
  delete compileCacheEnv.NODE_COMPILE_CACHE;
  delete compileCacheEnv.NODE_COMPILE_CACHE_PORTABLE;
  delete compileCacheEnv.NODE_DISABLE_COMPILE_CACHE;

  let compileCacheTagPromise;
  function compileCacheTag() {
    return (compileCacheTagPromise ??= (async () => {
      using dir = tempDir("compile-cache-tag", {});
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const m = require("module");
           m.enableCompileCache({ directory: ${JSON.stringify(String(dir))} });
           process.stdout.write(require("path").basename(m.getCompileCacheDir()));`,
        ],
        env: compileCacheEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout, stderr).toMatch(/^v/);
      expect(exitCode).toBe(0);
      return stdout;
    })());
  }

  test.skipIf(isWindows)(
    "enableCompileCache only uses a cache directory owned by the current user and not writable by others",
    async () => {
      using dir = tempDir("compile-cache-owner", {});
      const base = path.join(String(dir), "cc");
      const leaf = path.join(base, await compileCacheTag());
      fs.mkdirSync(leaf, { recursive: true });
      fs.chmodSync(leaf, 0o777);
      const code = `
        const fs = require("fs");
        const Module = require("module");
        const first = Module.enableCompileCache({ directory: ${JSON.stringify(base)} });
        fs.chmodSync(${JSON.stringify(leaf)}, 0o755);
        const second = Module.enableCompileCache({ directory: ${JSON.stringify(base)} });
        process.stdout.write(JSON.stringify({ first, second, dir: Module.getCompileCacheDir() }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", code],
        env: compileCacheEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout, stderr).toStartWith("{");
      const { FAILED, ENABLED } = Module.constants.compileCacheStatus;
      expect(JSON.parse(stdout)).toEqual({
        first: {
          status: FAILED,
          message:
            "Cannot use cache directory: it must be owned by the current user and not be group- or world-writable",
        },
        second: { status: ENABLED, directory: base },
        dir: leaf,
      });
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(isWindows)("enableCompileCache does not follow a symlink at the cache directory leaf", async () => {
    using dir = tempDir("compile-cache-symlink-leaf", {});
    const base = path.join(String(dir), "cc");
    const target = path.join(String(dir), "elsewhere");
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.chmodSync(target, 0o755);
    const leaf = path.join(base, await compileCacheTag());
    fs.symlinkSync(target, leaf);
    const code = `
      const Module = require("module");
      const result = Module.enableCompileCache({ directory: ${JSON.stringify(base)} });
      process.stdout.write(JSON.stringify({ result, dir: String(Module.getCompileCacheDir()) }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: compileCacheEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout, stderr).toStartWith("{");
    const { FAILED } = Module.constants.compileCacheStatus;
    expect(JSON.parse(stdout)).toEqual({
      result: {
        status: FAILED,
        message: expect.stringMatching(/^Cannot create cache directory: (ENOTDIR|ELOOP)$/),
      },
      dir: "undefined",
    });
    expect(fs.readdirSync(target)).toEqual([]);
    expect(fs.lstatSync(leaf).isSymbolicLink()).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("native module functions are not constructors", () => {
    // Constructing these used to crash instead of throwing.
    const compile = new Module("not-a-constructor-test")._compile;
    expect(typeof compile).toBe("function");
    expect(() => new compile()).toThrow(TypeError);
    expect(() => Reflect.construct(compile, [])).toThrow(TypeError);
    expect(() => new Module.runMain()).toThrow(TypeError);
    expect(() => Reflect.construct(Module.runMain, [])).toThrow(TypeError);
    expect(() => new Module._resolveFilename("fs")).toThrow(TypeError);
    expect(() => Reflect.construct(Module._resolveFilename, ["fs"])).toThrow(TypeError);
    // Calling still works.
    expect(Module._resolveFilename("fs")).toBe("fs");
  });

  test("Module.runMain propagates an error from stringifying its argument", () => {
    const boom = new Error("boom");
    expect(() =>
      Module.runMain({
        toString() {
          throw boom;
        },
      }),
    ).toThrow(boom);
  });

  test("module.filename/id/path setters propagate a failed string conversion", () => {
    const m = new Module("x");
    for (const key of ["filename", "id", "path"]) {
      expect(() => {
        m[key] = Symbol("s");
      }).toThrow(TypeError);
    }
  });

  test("Module._resolveFilename accepts an options object without paths", () => {
    // An options object without .paths used to segfault on the isArray() check.
    expect(Module._resolveFilename("fs", null, false, {})).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, Object.create(null))).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, [])).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, { paths: undefined })).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, { paths: null })).toBe("fs");
  });

  // Hitting the real limit needs 5 GB, so the child runs with a 64 KiB synthetic allocation limit (2730 entries).
  test("options.paths with too many entries for the native list throws a RangeError", async () => {
    const LIMIT_BYTES = 64 * 1024;
    const MAX_PATHS = Math.floor(LIMIT_BYTES / 24);
    using dir = tempDir("resolve-paths-limit", {
      "lib/node_modules/limit-pkg/package.json": JSON.stringify({ name: "limit-pkg", main: "index.js" }),
      "lib/node_modules/limit-pkg/index.js": "module.exports = 1;",
      "main.cjs": `
        const path = require("node:path");
        const Module = require("node:module");
        const resolvers = {
          "require.resolve": paths => require.resolve("limit-pkg", { paths }),
          "Module._resolveFilename": paths => Module._resolveFilename("limit-pkg", module, false, { paths }),
        };
        // Only the last entry contains the package, so resolving it proves the whole list reached the resolver.
        const resolveWith = (resolve, count) => {
          const paths = new Array(count).fill(path.join(__dirname, "missing"));
          paths[count - 1] = path.join(__dirname, "lib");
          try {
            return path.relative(__dirname, resolve(paths));
          } catch (e) {
            return e.name + ": " + e.message;
          }
        };
        const result = {};
        for (const [name, resolve] of Object.entries(resolvers)) {
          result[name] = { atLimit: resolveWith(resolve, ${MAX_PATHS}), onePast: resolveWith(resolve, ${MAX_PATHS + 1}) };
        }
        console.log(JSON.stringify(result));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "main.cjs")],
      env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(LIMIT_BYTES) },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const resolved = path.join("lib", "node_modules", "limit-pkg", "index.js");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout || "null")).toEqual({
      "require.resolve": { atLimit: resolved, onePast: "RangeError: Out of memory" },
      "Module._resolveFilename": { atLimit: resolved, onePast: "RangeError: Out of memory" },
    });
    expect(exitCode).toBe(0);
  });

  test("createRequire trailing slash", () => {
    const req = createRequire(import.meta.dir + "/");
    expect(req.resolve("./node-module-module.test.js")).toBe(
      ospath(path.resolve(import.meta.dir, "./node-module-module.test.js")),
    );
  });

  // Runs in a child because a failure here crashes the process.
  test("module APIs don't crash on paths longer than a path buffer", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const m = require("node:module");
         const long = Buffer.alloc(100_000, "a").toString();
         // createRequire() joins "noop.js" onto a directory path.
         const req = m.createRequire("/" + Buffer.alloc(100_000, "d/").toString());
         let code;
         try { req.resolve("./x"); } catch (e) { code = e.code; }
         console.log(JSON.stringify({
           createRequire: code,
           nodeModulePaths: m._nodeModulePaths("/" + long).map(p => p.length),
           enableCompileCache: m.enableCompileCache(long).message,
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const root = path.resolve("/").length;
    expect(JSON.parse(stdout)).toEqual({
      createRequire: "MODULE_NOT_FOUND",
      nodeModulePaths: [root + 100_000 + "/node_modules".length, root + "node_modules".length],
      enableCompileCache: "Cannot create cache directory: path too long",
    });
    expect(exitCode).toBe(0);
  });

  test("createRequire trailing slash file url", () => {
    const req = createRequire(Bun.pathToFileURL(import.meta.dir + "/"));
    expect(req.resolve("./node-module-module.test.js")).toBe(
      ospath(path.resolve(import.meta.dir, "./node-module-module.test.js")),
    );
  });

  test("Module exists", () => {
    expect(Module).toBeDefined();
  });

  test("module.Module works", () => {
    expect(Module.Module === Module).toBeTrue();

    const m = new Module("asdf");
    expect(m.exports).toEqual({});
  });

  test("_nodeModulePaths() works", () => {
    const root = path.resolve("/");
    expect(() => {
      _nodeModulePaths();
    }).toThrow();
    expect(_nodeModulePaths(".").length).toBeGreaterThan(0);
    expect(_nodeModulePaths(".").pop()).toBe(root + "node_modules");
    expect(_nodeModulePaths("")).toEqual(_nodeModulePaths("."));
    expect(_nodeModulePaths("/")).toEqual([root + "node_modules"]);
    expect(_nodeModulePaths("/a/b/c/d")).toEqual([
      ospath(root + "a/b/c/d/node_modules"),
      ospath(root + "a/b/c/node_modules"),
      ospath(root + "a/b/node_modules"),
      ospath(root + "a/node_modules"),
      ospath(root + "node_modules"),
    ]);
    expect(_nodeModulePaths("/a/b/../d")).toEqual([
      ospath(root + "a/d/node_modules"),
      ospath(root + "a/node_modules"),
      ospath(root + "node_modules"),
    ]);
    // Node resolves `from` through `path.resolve`, so a trailing separator is
    // dropped rather than producing an extra ".../<sep>/node_modules" entry.
    expect(_nodeModulePaths("/a/b/c/d/")).toEqual(_nodeModulePaths("/a/b/c/d"));
    expect(_nodeModulePaths(ospath("/a/b/c/d") + path.sep)).toEqual(_nodeModulePaths("/a/b/c/d"));
  });

  test("_nodeModulePaths() is stable across process.chdir()", async () => {
    // process.chdir() re-seeds the resolver's cached top-level dir with a
    // trailing separator; _nodeModulePaths("") then used to emit a duplicate
    // `<cwd>//node_modules` entry, which surfaced as a `--parallel` flake when
    // an earlier test file in the same worker had chdir'd.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const m = require("module");
         const before = m._nodeModulePaths("");
         const here = process.cwd();
         process.chdir(require("os").tmpdir());
         process.chdir(here);
         process.stdout.write(JSON.stringify({
           before,
           empty: m._nodeModulePaths(""),
           dot: m._nodeModulePaths("."),
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { before, empty, dot } = JSON.parse(stdout);
    expect(empty).toEqual(before);
    expect(empty).toEqual(dot);
    for (const p of empty) expect(p).not.toMatch(/[/\\]{2}node_modules$/);
    expect(exitCode).toBe(0);
  });

  test("_nodeModulePaths() does not leak the input string", async () => {
    // 20 components keeps the joined path well under macOS PATH_MAX (1024)
    // while generating 21 result strings per call, so the leak signal
    // dominates RSS noise within a few thousand iterations.
    const code = /* js */ `
        const m = require("module");
        const rss = process.memoryUsage.rss;
        const comp = Buffer.alloc(30, "a").toString();
        const base = "/" + Array(20).fill(comp).join("/");
        for (let i = 0; i < 200; i++) m._nodeModulePaths(base + i);
        Bun.gc(true); Bun.gc(true);
        const before = rss();
        for (let i = 0; i < 5000; i++) m._nodeModulePaths(base + i);
        Bun.gc(true); Bun.gc(true); Bun.gc(true);
        process.stdout.write(String((rss() - before) / 1024 / 1024));
      `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", code],
      env: {
        ...bunEnv,
        // Disable ASAN's free-quarantine so the RSS delta reflects live
        // allocations only; harmless on non-ASAN builds.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const growthMB = Number(stdout.trim());
    if (!Number.isFinite(growthMB)) {
      throw new Error(`subprocess did not report growth\nstdout: ${stdout}\nstderr: ${stderr}\nexit: ${exitCode}`);
    }
    expect(growthMB).toBeLessThan(25);
    expect(exitCode).toBe(0);
  }, 20_000);

  test("Module._stat truncates the path at the first null byte", async () => {
    using dir = tempDir("module-stat-null-byte", { "file.js": "", "directory": { "x": "" } });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { _stat } = require("node:module");
         const path = require("node:path");
         const file = path.join(process.cwd(), "file.js");
         const directory = path.join(process.cwd(), "directory");
         console.log(JSON.stringify({
           file: _stat(file + "\\0ignored"),
           directory: _stat(directory + "\\0ignored"),
           missing: _stat(path.join(process.cwd(), "missing\\0file.js")) < 0,
         }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // node v26.3.0 prints the same line. It passes the path to uv_fs_stat as a C string.
    expect(stdout).toBe('{"file":0,"directory":1,"missing":true}\n');
    expect(exitCode).toBe(0);
  });

  test("Module.wrap", () => {
    var mod = { exports: {} };
    expect(eval(wrap("exports.foo = 1; return 42"))(mod.exports, mod)).toBe(42);
    expect(mod.exports.foo).toBe(1);
    expect(wrap()).toBe("(function (exports, require, module, __filename, __dirname) { undefined\n});");
  });

  test("Overwriting _resolveFilename", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(import.meta.dir, "resolveFilenameOverwrite.cjs")],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const stdout = await proc.stdout.text();
    expect(stdout.trim().endsWith("--pass--")).toBe(true);
    expect(await proc.exited).toBe(0);
  });

  test("Overridden _resolveFilename receives Node-compatible arguments from a CJS entry", async () => {
    using dir = tempDir("resolve-filename-args-cjs", {
      "real.cjs": "module.exports = 'REAL';",
      "lvl2.cjs": "module.exports = require('./real.cjs');",
      "main.cjs": `
        const path = require("node:path");
        const { Module } = require("node:module");
        const oR = Module._resolveFilename;
        const rows = [];
        Module._resolveFilename = function (request, parent, isMain, options) {
          if (request.startsWith("./")) {
            rows.push({
              request,
              parentType: typeof parent,
              parentFilename: path.basename(String(parent && parent.filename)),
              isMain,
              options,
              argc: arguments.length,
              thisIsModule: this === Module,
            });
          }
          return oR.apply(this, arguments);
        };
        require("./lvl2.cjs");
        require.resolve("./real.cjs");
        const userOptions = { paths: [__dirname], conditions: ["custom"], extra: 1 };
        require.resolve("./real.cjs", userOptions);
        rows[rows.length - 1].optionsIsUserObject = rows[rows.length - 1].options === userOptions;
        rows[rows.length - 1].options = Object.keys(userOptions);
        console.log(JSON.stringify(rows));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "main.cjs")],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      {
        request: "./lvl2.cjs",
        parentType: "object",
        parentFilename: "main.cjs",
        isMain: false,
        argc: 4,
        thisIsModule: true,
      },
      {
        request: "./real.cjs",
        parentType: "object",
        parentFilename: "lvl2.cjs",
        isMain: false,
        argc: 4,
        thisIsModule: true,
      },
      {
        request: "./real.cjs",
        parentType: "object",
        parentFilename: "main.cjs",
        isMain: false,
        options: {},
        argc: 4,
        thisIsModule: true,
      },
      {
        request: "./real.cjs",
        parentType: "object",
        parentFilename: "main.cjs",
        isMain: false,
        options: ["paths", "conditions", "extra"],
        optionsIsUserObject: true,
        argc: 4,
        thisIsModule: true,
      },
    ]);
    expect(exitCode).toBe(0);
  });

  test("require() throws when an overridden _resolveFilename returns a path with a null byte", async () => {
    using dir = tempDir("resolve-filename-null-byte", {
      "x.js": `module.exports = "loaded:" + __filename;`,
      "main.cjs": `
        const path = require("node:path");
        const { Module } = require("node:module");
        const real = path.join(__dirname, "x.js");
        Module._resolveFilename = () => real + "\\u0000IGNORED";
        const out = {};
        try {
          out.require = "loaded " + require("anything");
        } catch (e) {
          out.require = e.code;
          out.requireMessageMentionsNullBytes = e.message.includes("without null bytes");
        }
        // Node returns the override's value from require.resolve() unchanged.
        try {
          out.resolveKeepsNullByte = require.resolve("anything").endsWith("\\u0000IGNORED");
        } catch (e) {
          out.resolveKeepsNullByte = e.code;
        }
        console.log(JSON.stringify(out));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "main.cjs")],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // Node v26.3.0 prints this exact object.
    expect(JSON.parse(stdout)).toEqual({
      require: "ERR_INVALID_ARG_VALUE",
      requireMessageMentionsNullBytes: true,
      resolveKeepsNullByte: true,
    });
    expect(exitCode).toBe(0);
  });

  test("Overridden _resolveFilename receives a parent Module for createRequire from ESM", async () => {
    using dir = tempDir("resolve-filename-args-esm", {
      "real.cjs": "module.exports = 'REAL';",
      "main.mjs": `
        import path from "node:path";
        import { Module, createRequire } from "node:module";
        const req = createRequire(import.meta.url);
        const oR = Module._resolveFilename;
        const rows = [];
        const parents = [];
        Module._resolveFilename = function (request, parent, isMain, options) {
          if (request.endsWith("real.cjs")) {
            parents.push(parent);
            rows.push({
              parentType: typeof parent,
              parentFilename: path.basename(String(parent && parent.filename)),
              isMain,
              options,
              argc: arguments.length,
              thisIsModule: this === Module,
            });
          }
          return oR.apply(this, arguments);
        };
        req("./real.cjs");
        req.resolve("./real.cjs");
        req.resolve("./real.cjs");
        Module._resolveFilename = oR;
        console.log(JSON.stringify({
          rows,
          sameParentAcrossRequireAndResolve: parents[0] === parents[1] && parents[1] === parents[2],
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "main.mjs")],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      rows: [
        { parentType: "object", parentFilename: "main.mjs", isMain: false, argc: 4, thisIsModule: true },
        { parentType: "object", parentFilename: "main.mjs", isMain: false, options: {}, argc: 4, thisIsModule: true },
        { parentType: "object", parentFilename: "main.mjs", isMain: false, options: {}, argc: 4, thisIsModule: true },
      ],
      sameParentAcrossRequireAndResolve: true,
    });
    expect(exitCode).toBe(0);
  });

  test("require and require.resolve inside new Module(id)._compile() both resolve from cwd", async () => {
    using dir = tempDir("resolve-filename-compile", {
      "sib.cjs": "module.exports = 'ROOT';",
      "sub/sib.cjs": "module.exports = 'SUB';",
      "main.cjs": `
        const path = require("node:path");
        const { Module } = require("node:module");
        function run() {
          const m = new Module(path.join(__dirname, "sub", "a.cjs"));
          m._compile(
            'module.exports = { req: require("./sib.cjs"), res: require.resolve("./sib.cjs") };',
            path.join(__dirname, "sub", "a.cjs"),
          );
          return { req: m.exports.req, res: path.relative(__dirname, m.exports.res) };
        }
        const noHook = run();
        const oR = Module._resolveFilename;
        Module._resolveFilename = function () {
          return oR.apply(this, arguments);
        };
        const withHook = run();
        Module._resolveFilename = oR;
        console.log(JSON.stringify({ noHook, withHook }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      noHook: { req: "ROOT", res: "sib.cjs" },
      withHook: { req: "ROOT", res: "sib.cjs" },
    });
    expect(exitCode).toBe(0);
  });

  test("Overwriting _resolveFilename with a non-callable makes require() throw like Node", async () => {
    // Node keeps _resolveFilename as a plain data property: any value can be
    // assigned and reads back, and require() throws when it goes to call it.
    using dir = tempDir("resolve-filename-non-callable", {
      "dep.cjs": `module.exports = "dep";`,
      "main.cjs": `
        const Module = require("module");
        const original = Module._resolveFilename;
        const attempt = fn => {
          try {
            return "returned " + String(fn());
          } catch (e) {
            return e.constructor.name + ": " + e.message;
          }
        };
        const results = {};
        for (const [label, value] of [
          ["object", {}],
          ["string", "not a function"],
          ["undefined", undefined],
          ["null", null],
          ["number", 42],
          ["symbol", Symbol("s")],
        ]) {
          Module._resolveFilename = value;
          results[label] = {
            readsBack: Object.is(Module._resolveFilename, value),
            require: attempt(() => require("./dep.cjs")),
            requireResolve: attempt(() => require.resolve("./dep.cjs")),
            createRequire: attempt(() => Module.createRequire(__filename)("./dep.cjs")),
          };
        }
        // Callable objects other than plain functions are still honored.
        Module._resolveFilename = new Proxy(original, {});
        results.callableProxy = attempt(() => require("./dep.cjs"));
        Module._resolveFilename = original;
        results.restored = {
          readsBack: Module._resolveFilename === original,
          require: attempt(() => require("./dep.cjs")),
        };
        console.log(JSON.stringify(results));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "main.cjs")],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const notAFunction = {
      readsBack: true,
      require: "TypeError: Module._resolveFilename is not a function",
      requireResolve: "TypeError: Module._resolveFilename is not a function",
      createRequire: "TypeError: Module._resolveFilename is not a function",
    };
    expect(JSON.parse(stdout)).toEqual({
      object: notAFunction,
      string: notAFunction,
      undefined: notAFunction,
      null: notAFunction,
      number: notAFunction,
      symbol: notAFunction,
      callableProxy: "returned dep",
      restored: { readsBack: true, require: "returned dep" },
    });
    expect(exitCode).toBe(0);
  });

  describe.concurrent(
    "Module._resolveFilename gives an ES module by a path the resolver would spell differently",
    () => {
      test.each([
        ["a . segment", `__dirname + "/./esm.mjs"`],
        ["a .. segment", `__dirname + "/sub/../esm.mjs"`],
        ["a doubled separator", `__dirname + "//esm.mjs"`],
        ["relative to the working directory", `"./esm.mjs"`],
        ["a symlink to the file", `__dirname + "/link.mjs"`],
        ["a symlink to its directory", `__dirname + "/linked/esm.mjs"`],
      ])("%s", async (_, filename) => {
        using dir = tempDir("resolve-filename-other-spelling", {
          "esm.mjs": `import { dep } from "./dep.mjs"; export const who = "esm, " + dep;`,
          "dep.mjs": `export const dep = "dep";`,
          "sub/empty.txt": "",
          "main.cjs": `
          const Module = require("node:module");
          Module._resolveFilename = () => ${filename};
          console.log(require("anything").who, require("anything") === require("something else"));
        `,
        });
        fs.symlinkSync("esm.mjs", path.join(String(dir), "link.mjs"), "file");
        fs.symlinkSync(".", path.join(String(dir), "linked"), "dir");
        await using proc = Bun.spawn({
          cmd: [bunExe(), "main.cjs"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "esm, dep true\n", stderr: "", exitCode: 0 });
      });
    },
  );

  test("Overwriting Module.prototype.require", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(import.meta.dir, "modulePrototypeOverwrite.cjs")],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const stdout = await proc.stdout.text();
    expect(stdout.trim().endsWith("--pass--")).toBe(true);
    expect(await proc.exited).toBe(0);
  });

  // Module.prototype.require is a data property to a script, and native code keeps the function that require() calls.
  // Each store of the fixture ends in a definition of the value on Module.prototype, and that definition has to reach
  // the native side. "Object.defineProperty that repeats the attributes" is what wrap() of shimmer does.
  test("Module.prototype.require: every store that ends in a definition installs the function", async () => {
    using dir = tempDir("module-prototype-require-stores", {
      "dep.cjs": `module.exports = "dep";`,
      "main.cjs": `
        const stores = require(${JSON.stringify(storesFixture)});
        const Module = require("node:module");
        const original = Module.prototype.require;
        const results = {};
        for (const [what, store] of Object.entries(stores)) {
          const seen = [];
          const hook = who =>
            function (id) {
              seen.push(who + " " + id);
              return original.apply(this, arguments);
            };
          const first = hook("the first");
          store(Module.prototype, "require", first);
          const readBack = Module.prototype.require === first;
          require("./dep.cjs");
          Module.prototype.require = hook("the second");
          require("./dep.cjs");
          new Proxy(Module.prototype, {}).require = original;
          require("./dep.cjs");
          results[what] = [readBack, seen, JSON.stringify(Object.getOwnPropertyDescriptor(Module.prototype, "require"))];
        }
        console.log(JSON.stringify(results));
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
    expect({ stdout: stdout && JSON.parse(stdout), stderr }).toEqual({
      stdout: Object.fromEntries(
        Object.keys(storesThatEndInADefinition).map(what => [
          what,
          [
            true,
            ["the first ./dep.cjs", "the second ./dep.cjs"],
            `{"writable":true,"enumerable":true,"configurable":true}`,
          ],
        ]),
      ),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Object.preventExtensions() defines nothing, and Object.seal() marks a plain object like Module.prototype as a whole
  // and defines nothing either. After each of them the property is what it was, and a store reaches the native side.
  test.each(["preventExtensions", "seal"])(
    "Module.prototype.require: a store after Object.%s(Module.prototype) installs the function",
    async level => {
      using dir = tempDir("module-prototype-require-" + level, {
        "dep.cjs": `module.exports = "dep";`,
        "main.cjs": `
          const Module = require("node:module");
          const original = Module.prototype.require;
          const seen = [];
          const hook = who =>
            function (id) {
              seen.push(who + " " + id);
              return original.apply(this, arguments);
            };
          Object.${level}(Module.prototype);
          Object.defineProperty(Module.prototype, "require", { value: hook("a definition") });
          require("./dep.cjs");
          new Proxy(Module.prototype, {}).require = hook("a proxy");
          require("./dep.cjs");
          Module.prototype.require = hook("an assignment");
          require("./dep.cjs");
          console.log(JSON.stringify(seen));
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
      expect({ stdout: stdout && JSON.parse(stdout), stderr }).toEqual({
        stdout: ["a definition ./dep.cjs", "a proxy ./dep.cjs", "an assignment ./dep.cjs"],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );

  // Node's Module.prototype.require is `Module._load(id, this, false)`, so `this` is only used as the parent.
  test("Module.prototype.require accepts a `this` that isn't a module", async () => {
    using dir = tempDir("module-prototype-require-this", {
      "dep.cjs": `module.exports = { name: "dep" };`,
      "bad.cjs": `module.exports = ;`,
      "main.cjs": `
        const Module = require("node:module");
        const path = require("node:path");
        const dep = path.join(__dirname, "dep.cjs");
        const bad = path.join(__dirname, "bad.cjs");

        function load(parent, request) {
          try {
            return Module.prototype.require.call(parent, request);
          } catch (e) {
            return "threw " + e.name;
          }
        }

        const plain = { id: __filename, filename: __filename };
        const result = {};
        result.plainObject = load(plain, dep);
        result.parentIsThis = require.cache[dep].parent === plain;
        result.requireAgain = require(dep) === result.plainObject;
        delete require.cache[dep];
        result.number = load(5, dep);
        delete require.cache[dep];
        result.nullThis = load(null, dep);
        delete require.cache[dep];
        result.relative = load(plain, "./dep.cjs");
        result.builtin = load({}, "path") === path;
        // A failed load must remove its placeholder module from require.cache.
        result.failedLoad = load(plain, bad);
        result.leftInCache = bad in require.cache;
        console.log(JSON.stringify(result));
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      plainObject: { name: "dep" },
      parentIsThis: true,
      requireAgain: true,
      number: { name: "dep" },
      nullThis: { name: "dep" },
      relative: { name: "dep" },
      builtin: true,
      failedLoad: "threw BuildMessage",
      leftInCache: false,
    });
    expect(exitCode).toBe(0);
  });

  test.each([
    "/file/name/goes/here.js",
    "file/here.js",
    "file\\here.js",
    "/file\\here.js",
    "\\file\\here.js",
    "\\file/here.js",
  ])("Module.prototype._compile", filename => {
    const module = new Module("module id goes here");
    const starting_exports = module.exports;
    const r = module._compile("module.exports = { module, exports, require, __filename, __dirname }", filename);
    expect(r).toBe(undefined);
    expect(module.exports).not.toBe(starting_exports);
    const { module: m, exports: e, require: req, __filename: fn, __dirname: dn } = module.exports;
    expect(m).toBe(module);
    expect(e).toBe(starting_exports);
    expect(req).toBe(module.require);
    expect(fn).toBe(filename);
    expect(dn).toBe(path.dirname(filename));
  });

  test("Module._extensions", () => {
    expect(".js" in Module._extensions).toBeTrue();
    expect(".json" in Module._extensions).toBeTrue();
    expect(".node" in Module._extensions).toBeTrue();
    expect(require.extensions).toBe(Module._extensions);
  });

  test("Module._resolveLookupPaths", () => {
    expect(Module._resolveLookupPaths("foo")).toEqual([]);
    expect(Module._resolveLookupPaths("./bar", { id: "1", filename: "/baz/abc" })).toEqual(["/baz"]);
    expect(Module._resolveLookupPaths("./bar", {})).toEqual(["."]);
    expect(Module._resolveLookupPaths("./bar", { paths: ["a"] })).toEqual(["."]);
    expect(Module._resolveLookupPaths("bar", { paths: ["a"] })).toEqual(["a"]);
  });

  describe("require.resolve.paths", () => {
    // Calls the `paths` of `own` in every way, with a bare and with a relative request, and
    // answers [the first folder, the folders] of each call, relative to `root`.
    const callShapes = `
      const path = require("node:path");
      exports.callShapes = (own, other, root) => {
        const where = list => list.map(folder => path.relative(root, folder).split(path.sep).join("/") || ".");
        const { paths } = own.resolve;
        // vitest's vm pools do this with the resolve of a createRequire().
        const copied = id => other.resolve(id);
        copied.paths = own.resolve.paths;
        const shapes = {
          method: request => own.resolve.paths(request),
          destructured: request => paths(request),
          callback: request => [request].map(own.resolve.paths)[0],
          copied: request => copied.paths(request),
          calledOnOtherResolve: request => own.resolve.paths.call(other.resolve, request),
          reflectApply: request => Reflect.apply(own.resolve.paths, undefined, [request]),
          bound: request => own.resolve.paths.bind(other.resolve)(request),
        };
        const answers = {};
        for (const [shape, call] of Object.entries(shapes)) answers[shape] = [where(call("pkg"))[0], where(call("./x"))];
        return answers;
      };
    `;
    const answersFrom = folder => {
      const answer = [folder === "." ? "node_modules" : `${folder}/node_modules`, [folder]];
      return {
        method: answer,
        destructured: answer,
        callback: answer,
        copied: answer,
        calledOnOtherResolve: answer,
        reflectApply: answer,
        bound: answer,
      };
    };

    test("answers for the module of its require, however it is called", async () => {
      using dir = tempDir("require-resolve-paths-cjs", {
        "shapes.cjs": callShapes,
        "main.cjs": `
          const path = require("node:path");
          const Module = require("node:module");
          const { callShapes } = require("./shapes.cjs");
          const other = Module.createRequire(path.join(__dirname, "other", "x.js"));
          const compiled = new Module(path.join(__dirname, "compiled", "c.js"));
          compiled.filename = compiled.id;
          compiled.paths = Module._nodeModulePaths(path.dirname(compiled.id));
          compiled._compile("module.exports = require;", compiled.id);
          console.log(JSON.stringify({
            file: callShapes(require, other, __dirname),
            createRequire: callShapes(other, require, __dirname),
            compile: callShapes(compiled.exports, other, __dirname),
          }));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        file: answersFrom("."),
        createRequire: answersFrom("other"),
        compile: answersFrom("compiled"),
      });
      expect(exitCode).toBe(0);
    });

    test("answers for an ES module's createRequire() and import.meta.require, however it is called", async () => {
      using dir = tempDir("require-resolve-paths-esm", {
        "shapes.cjs": callShapes,
        "main.mjs": `
          import { createRequire } from "node:module";
          import path from "node:path";
          const made = createRequire(import.meta.url);
          const { callShapes } = made("./shapes.cjs");
          const other = createRequire(path.join(import.meta.dirname, "other", "x.js"));
          console.log(JSON.stringify({
            createRequire: callShapes(made, other, import.meta.dirname),
            importMetaRequire: callShapes(import.meta.require, other, import.meta.dirname),
          }));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ createRequire: answersFrom("."), importMetaRequire: answersFrom(".") });
      expect(exitCode).toBe(0);
    });

    test("answers for the module of `bun -e` without its require.resolve", async () => {
      using dir = tempDir("require-resolve-paths-eval", {});
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const path = require("node:path");
           const where = list => list.map(folder => path.relative(process.cwd(), folder) || ".");
           const { paths } = require.resolve;
           console.log(JSON.stringify([where(paths("./x")), where(["./x"].map(require.resolve.paths)[0])]));`,
        ],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([["."], ["."]]);
      expect(exitCode).toBe(0);
    });

    test("is kept on its require.resolve once it is read, one for each require", async () => {
      using dir = tempDir("require-resolve-paths-shape", {
        "main.cjs": `
          const path = require("node:path");
          const { createRequire, globalPaths } = require("node:module");
          const where = list => list.map(folder => path.relative(__dirname, folder).split(path.sep).join("/") || ".");
          const fresh = name => createRequire(path.join(__dirname, name, "x.js"));
          const describeOwn = resolve => {
            const d = Object.getOwnPropertyDescriptor(resolve, "paths");
            return d && { value: typeof d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable };
          };
          const collect = globalThis.gc ?? (() => Bun.gc(true));
          const out = {};

          const read = fresh("read");
          out.sameOnEveryRead = read.resolve.paths === read.resolve.paths;
          out.ownOnceRead = [describeOwn(read.resolve), Object.keys(read.resolve)];
          collect();
          out.sameAfterCollection = read.resolve.paths === Object.getOwnPropertyDescriptor(read.resolve, "paths").value;
          out.oneForEachRequire = read.resolve.paths !== fresh("read").resolve.paths;
          out.assignCopiesOnceRead = where(Object.assign(id => id, read.resolve).paths("./x"));

          const stored = fresh("stored");
          stored.resolve.paths = () => "stored";
          out.stored = [stored.resolve.paths("./x"), describeOwn(stored.resolve)];

          const defined = fresh("defined");
          Object.defineProperty(defined.resolve, "paths", { value: "defined", configurable: true });
          out.defined = defined.resolve.paths;

          const frozen = fresh("frozen");
          Object.freeze(frozen.resolve);
          out.frozen = [where(frozen.resolve.paths("./x")), Object.isFrozen(frozen.resolve)];
          try {
            // A class body is strict code.
            new (class {
              constructor() {
                frozen.resolve.paths = 1;
              }
            })();
            out.frozenRefusesAStrictStore = false;
          } catch (error) {
            out.frozenRefusesAStrictStore = error instanceof TypeError;
          }

          // Reflect.get() names a receiver that the read does not go through.
          const named = fresh("named");
          Object.defineProperty(named.resolve, "paths", { value: "kept" });
          Reflect.get(fresh("reader").resolve, "paths", named.resolve);
          Reflect.get(fresh("reader").resolve, "paths", named);
          out.namedReceiverIsUntouched = [named.resolve.paths, Object.hasOwn(named, "paths")];

          out.boundResolveHasNone = typeof fresh("bound").resolve.bind(null).paths;
          out.aboveResolveHasNone = typeof Object.getPrototypeOf(require.resolve).paths;

          const kept = Array.from({ length: 500 }, (_, i) => fresh("kept" + i).resolve.paths);
          collect();
          out.eachOutlivesItsRequire = kept.every((paths, i) => where(paths("./x"))[0] === "kept" + i);

          const { paths } = require.resolve;
          out.name = paths.name;
          out.length = paths.length;
          out.builtin = [paths("fs"), paths("node:fs")];
          const attempt = fn => {
            try {
              return fn();
            } catch (error) {
              return error.name + " " + error.code + ": " + error.message;
            }
          };
          out.notAString = [attempt(() => paths()), attempt(() => paths(1))];

          // The function holds the module and not the name of its file.
          out.beforeRename = where(paths("./x"));
          module.filename = path.join(__dirname, "renamed", "file.js");
          out.afterRename = where(paths("./x"));

          const nameless = new (require("node:module"))("nameless");
          nameless._compile("module.exports = require;", "nameless.js");
          out.withoutFileName = [
            nameless.filename,
            nameless.exports.resolve.paths("./x"),
            // Node.js lists its global folders for a bare request.
            nameless.exports.resolve.paths("pkg").filter(folder => !globalPaths.includes(folder)),
          ];

          console.log(JSON.stringify(out));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const ownData = { value: "function", writable: true, enumerable: true, configurable: true };
      // What `node --expose-gc main.cjs` prints too (v26.3.0).
      expect(JSON.parse(stdout)).toEqual({
        sameOnEveryRead: true,
        ownOnceRead: [ownData, ["paths"]],
        sameAfterCollection: true,
        oneForEachRequire: true,
        assignCopiesOnceRead: ["read"],
        stored: ["stored", ownData],
        defined: "defined",
        frozen: [["frozen"], true],
        frozenRefusesAStrictStore: true,
        namedReceiverIsUntouched: ["kept", false],
        boundResolveHasNone: "undefined",
        aboveResolveHasNone: "undefined",
        eachOutlivesItsRequire: true,
        name: "paths",
        length: 1,
        builtin: [null, null],
        notAString: [
          'TypeError ERR_INVALID_ARG_TYPE: The "request" argument must be of type string. Received undefined',
          'TypeError ERR_INVALID_ARG_TYPE: The "request" argument must be of type string. Received type number (1)',
        ],
        beforeRename: ["."],
        afterRename: ["renamed"],
        withoutFileName: [null, ["."], []],
      });
      expect(exitCode).toBe(0);
    });

    // The DFG and the FTL hand a getter the global object of the code they have inlined: oven-sh/WebKit#762, #44518.
    test("is a function of the module's realm, whatever realm the reader or the receiver is of", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const vm = require("node:vm");
           const read = vm.runInNewContext("(function (r) { return r.paths; })");
           // Nothing is stored on a frozen function, so every read calls the getter.
           const resolve = Object.freeze(require("node:module").createRequire(__filename).resolve);
           let paths;
           for (let i = 0; i < 5_000; i++) paths = read(resolve);
           // A function of the context that is bound to the module is a receiver that the getter answers.
           const bound = vm.runInNewContext("(function () {}).bind(m)", { m: module });
           const ofBound = Reflect.get(require.resolve, "paths", bound);
           const list = ofBound("./x");
           console.log(JSON.stringify({
             read: [typeof paths, paths("./x").length, Object.getPrototypeOf(paths) === Function.prototype],
             receiver: [Object.getPrototypeOf(ofBound) === Function.prototype, list instanceof Array, list.length],
           }));`,
        ],
        // The FTL compiles the loop on the main thread after about a thousand turns.
        env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0", BUN_JSC_jitPolicyScale: "0.01" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ read: ["function", 1, true], receiver: [true, true, 1] });
      expect(exitCode).toBe(0);
    });

    test("is made for a module when something first asks for it", async () => {
      const count = 100;
      const files = {};
      for (let i = 0; i <= count; i++) {
        files[`plain/m${i}.cjs`] = `module.exports = ${i};`;
        files[`reads/m${i}.cjs`] = `module.exports = typeof require.resolve.paths;`;
      }
      using dir = tempDir("require-resolve-paths-heap", {
        ...files,
        "main.cjs": `
          const { heapStats } = require("bun:jsc");
          const functions = () => {
            Bun.gc(true);
            return heapStats().objectTypeCounts.Function;
          };
          // Function objects that stay for each module, after the first of its kind has made what all share.
          const functionsForEach = kind => {
            require("./" + kind + "/m0.cjs");
            const before = functions();
            for (let i = 1; i <= ${count}; i++) require("./" + kind + "/m" + i + ".cjs");
            return Math.round((functions() - before) / ${count});
          };
          console.log(JSON.stringify({ plain: functionsForEach("plain"), reads: functionsForEach("reads") }));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      // `require` and `require.resolve`, and `paths` for the modules that read it.
      expect(JSON.parse(stdout)).toEqual({ plain: 2, reads: 3 });
      expect(exitCode).toBe(0);
    });

    // In Node.js `paths` is an own property of each require.resolve from the start. Here the first read makes it one.
    // Each row holds what Node.js does and fails until then. A row that starts to pass becomes a plain test.
    describe("as in Node.js, before its first read", () => {
      const fresh = name => createRequire(path.join(import.meta.dir, name, "x.js")).resolve;
      const folderOf = name => [path.join(import.meta.dir, name)];

      test.failing("is an own data property", () => {
        expect(Object.getOwnPropertyDescriptor(fresh("own"), "paths")).toEqual({
          value: expect.any(Function),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      });

      // mock.method() of node:test, vi.spyOn() of vitest and stub() of sinon look for a function in this way.
      test.failing("a spy library finds a function in the first descriptor of it, on the object or above", () => {
        let holder = fresh("spied");
        while (!Object.hasOwn(holder, "paths")) holder = Object.getPrototypeOf(holder);
        expect(Object.getOwnPropertyDescriptor(holder, "paths").value).toBeFunction();
      });

      test.failing("an object that inherits from the require.resolve reads it", () => {
        expect(Object.create(fresh("heir")).paths("./x")).toEqual(folderOf("heir"));
      });

      test.failing("a Proxy of the require.resolve reads it", () => {
        expect(new Proxy(fresh("proxy"), {}).paths("./x")).toEqual(folderOf("proxy"));
      });

      test.failing("a Proxy that binds what it reads to its target reads it", () => {
        const proxy = new Proxy(fresh("binding-proxy"), {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        expect(proxy.paths("./x")).toEqual(folderOf("binding-proxy"));
      });

      test.failing("Reflect.get() answers for the require.resolve that it reads, whatever the receiver", () => {
        expect(Reflect.get(fresh("read"), "paths", fresh("receiver"))("./x")).toEqual(folderOf("read"));
      });

      test.failing("a frozen require.resolve has one function", () => {
        const resolve = Object.freeze(fresh("frozen"));
        expect(resolve.paths).toBe(resolve.paths);
      });

      test.failing("a sloppy store on a frozen require.resolve is ignored, and Reflect.set() answers false", () => {
        const resolve = Object.freeze(fresh("frozen-store"));
        new Function("resolve", "resolve.paths = 1;")(resolve);
        expect(Reflect.set(resolve, "paths", 1)).toBe(false);
      });

      test.failing("a store on a require.resolve that is not extensible replaces it", () => {
        const resolve = Object.preventExtensions(fresh("not-extensible"));
        resolve.paths = 1;
        expect(resolve.paths).toBe(1);
      });
    });
  });

  test("Module.findSourceMap doesn't throw", () => {
    expect(Module.findSourceMap("foo")).toEqual(undefined);
  });

  test("require cache relative specifier", () => {
    require.cache["./bar.cjs"] = { exports: { default: "bar" } };
    expect(() => require("./bar.cjs")).toThrow("Cannot find module");
  });
  test("builtin resolution", () => {
    expect(require.resolve("fs")).toBe("fs");
    expect(require.resolve("node:fs")).toBe("node:fs");
  });
  test("require cache node builtins specifier", () => {
    // as js builtin
    try {
      const fake = { default: "bar" };
      const real = require("fs");
      expect(require.cache["fs"]).toBe(undefined);
      require.cache["fs"] = { exports: fake };
      expect(require("fs")).toBe(fake);
      expect(require("node:fs")).toBe(real);
    } finally {
      delete require.cache["fs"];
    }

    // as native module
    try {
      const fake = { default: "bar" };
      const real = require("util/types");
      expect(require.cache["util/types"]).toBe(undefined);
      require.cache["util/types"] = { exports: fake };
      expect(require("util/types")).toBe(fake);
      expect(require("node:util/types")).toBe(real);
    } finally {
      delete require.cache["util/types"];
    }
  });
  // https://github.com/oven-sh/bun/issues/40551
  test("require.cache does not expose builtins from the ESM registry", () => {
    // `fs` and `bun:sqlite` are ESM-imported at the top of this file, so the
    // ESM registry holds "node:fs" and "bun:sqlite". Node.js never puts
    // builtins in require.cache; serving the frozen module namespace object
    // here breaks require-in-the-middle consumers (dd-trace, OpenTelemetry)
    // that patch cached exports.
    expect(require.cache["node:fs"]).toBeUndefined();
    expect("node:fs" in require.cache).toBe(false);
    expect(Object.getOwnPropertyDescriptor(require.cache, "node:fs")).toBeUndefined();
    expect(Object.keys(require.cache).filter(k => k.startsWith("node:"))).toEqual([]);
    // bun:* builtins have the same frozen-namespace hazard. Other bun: keys
    // can legitimately be in require.cache via require() (for example the
    // harness requires "bun:jsc"), so only assert on the ESM-only import.
    expect(require.cache["bun:sqlite"]).toBeUndefined();
    expect("bun:sqlite" in require.cache).toBe(false);
    expect(Object.getOwnPropertyDescriptor(require.cache, "bun:sqlite")).toBeUndefined();
    expect(Object.keys(require.cache)).not.toContain("bun:sqlite");
  });
  test("require a cjs file uses the 'module.exports' export", () => {
    expect(require("./esm_to_cjs_interop.mjs")).toEqual(Symbol.for("meow"));
  });

  test("require.cache throws if it's first accessed near the stack limit, and the next access creates it", async () => {
    const code = `
      const Module = require("node:module");
      // Only the deepest frame catches the overflow, and any call into the builtin from there overflows again.
      function probe(useModuleCache) {
        let outcome;
        function recurse() {
          try {
            recurse();
          } catch {
            try {
              outcome = typeof (useModuleCache ? Module._cache : require.cache);
            } catch (err) {
              outcome = err.constructor.name;
            }
          }
        }
        recurse();
        return outcome;
      }
      const probes = [probe(false), probe(true)];
      const cache = require.cache;
      const hasEvalEntry = Object.keys(cache).some(key => key.endsWith("[eval]"));
      const marker = {};
      cache.fs = { exports: marker };
      console.log(
        JSON.stringify([
          probes,
          Object.getPrototypeOf(cache),
          Module._cache === cache,
          hasEvalEntry,
          require("fs") === marker,
        ]),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify([["RangeError", "RangeError"], null, true, true, true]));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("Module.runMain", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--require",
        path.join(import.meta.dir, "overwrite-module-run-main-1.cjs"),
        path.join(import.meta.dir, "overwrite-module-run-main-2.cjs"),
      ],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const stdout = await proc.stdout.text();
    expect(stdout.trim()).toBe("pass");
    expect(await proc.exited).toBe(0);
  });
  test("Module.runMain 2", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--require",
        path.join(import.meta.dir, "overwrite-module-run-main-3.cjs"),
        path.join(import.meta.dir, "overwrite-module-run-main-2.cjs"),
      ],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const stdout = await proc.stdout.text();
    expect(stdout.trim()).toBe("pass");
    expect(await proc.exited).toBe(0);
  });
  describe.concurrent("Module.runMain resolves its argument from the working directory", () => {
    test.each([
      ["a relative path", "./server.js", "server.js"],
      ["no extension", "./server", "server.js"],
      ["a directory", "./dir", "dir/index.js"],
      ["a . segment", "./dir/./index.js", "dir/index.js"],
      ["a symlink", "./link.js", "server.js"],
      ["a file that is missing", "./missing", "ResolveMessage"],
    ])("%s", async (_, argument, expected) => {
      const file = `console.log(require("node:path").relative(process.cwd(), __filename).replaceAll("\\\\", "/"));`;
      using dir = tempDir("run-main-argument", {
        "server.js": file,
        "dir/index.js": file,
        "main.cjs": `
          try {
            require("node:module").runMain(${JSON.stringify(argument)});
          } catch (error) {
            console.log(error.name);
          }
        `,
      });
      fs.symlinkSync("server.js", path.join(String(dir), "link.js"), "file");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
    });
  });

  describe.concurrent("Module.runMain set by a preload", () => {
    const handlers = `
      process.on("uncaughtException", error => console.log("uncaughtException: " + error.message));
      process.on("unhandledRejection", error => console.log("unhandledRejection: " + error.message));
    `;
    async function run(preload, inWorker = false, main = `console.log("main ran");`) {
      using dir = tempDir("module-run-main", {
        "preload.cjs": preload,
        "main.cjs": main,
        "worker.mjs": `new Worker(import.meta.dir + "/main.cjs", { preload: [import.meta.dir + "/preload.cjs"] });`,
      });
      await using proc = Bun.spawn({
        cmd: inWorker ? [bunExe(), "./worker.mjs"] : [bunExe(), "--require", "./preload.cjs", "./main.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr: normalizeBunSnapshot(stderr, dir), exitCode };
    }

    test.each([
      ["{}", "Object"],
      ["[]", "Array"],
      [`"a string"`, `"a string"`],
      [`Symbol("s")`, "Symbol(s)"],
      ["10n", "10"],
    ])("to %s, which is not a function", async (value, described) => {
      expect(await run(`require("module").runMain = ${value};`)).toEqual({
        stdout: "",
        stderr: `TypeError: ${described} is not a function\n\nBun v<bun-version>`,
        exitCode: 1,
      });
    });

    test("to a function that throws", async () => {
      const { stdout, stderr, exitCode } = await run(
        `require("module").runMain = () => {\n  throw new RangeError("from the override");\n};`,
      );
      expect(stderr).toMatchInlineSnapshot(`
        "1 | require("module").runMain = () => {
        2 |   throw new RangeError("from the override");
                        ^
        RangeError: from the override
            at <anonymous> (file:NN:NN)

        Bun v<bun-version>"
      `);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });

    test("to a function that calls the original and throws", async () => {
      const preload = `
        const Module = require("module");
        const runMain = Module.runMain;
        Module.runMain = (...args) => {
          runMain(...args);
          throw new Error("after the original");
        };
      `;
      expect(await run(preload)).toMatchObject({ stdout: "main ran\n", exitCode: 1 });
      expect(await run(handlers + preload)).toEqual({
        stdout: "main ran\nunhandledRejection: after the original\n",
        stderr: "",
        exitCode: 0,
      });
      // What the main file throws is not lost for it.
      expect(await run(handlers + preload, false, `throw new Error("from main");`)).toEqual({
        stdout: "unhandledRejection: after the original\nuncaughtException: from main\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.each([
      ["is not a function", "{}", "Object is not a function"],
      ["throws", `() => { throw new Error("thrown"); }`, "thrown"],
    ])("one that %s is reported once", async (_, value, message) => {
      const expected = { stdout: `uncaughtException: ${message}\n`, stderr: "", exitCode: 0 };
      expect(await run(`${handlers} require("module").runMain = ${value};`)).toEqual(expected);
      expect(await run(`${handlers} require("module").runMain = ${value};`, true)).toEqual(expected);
    });
  });
  test.each(["no args", "--access-early"])("children, %s", async arg => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "children-fixture/a.cjs"), arg],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const stdout = await proc.stdout.text();
    expect(stdout.trim()).toBe(`. (./a.cjs)
 ./b.cjs
  . (./a.cjs) (seen)
  ./b.cjs (seen)
  ./c.cjs
   ./d.cjs
    ./d.cjs (seen)
 ./d.cjs (seen)
 ./f.cjs
  ./d.cjs (seen)
 ./g.cjs
  ./b.cjs (seen)
  . (./a.cjs) (seen)
  ./h.cjs
   ./i.cjs
    ./j.cjs
     ./i.cjs (seen)
     ./j.cjs (seen)
     ./k.cjs
      ./j.cjs (seen)
   ./j.cjs (seen)
   ./k.cjs (seen)`);
    expect(await proc.exited).toBe(0);
  });

  test("new Module().exports survives object spread", async () => {
    // exports was built with inline capacity 0, so spreading it hit JSC's
    // tryCreateObjectViaCloning hasInlineStorage() debug assert. Run in a
    // subprocess so a regressing assert shows up as missing stdout rather than
    // killing the test runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const Module = require("node:module");
         const m = new Module("x");
         m.exports.a = 1;
         console.log(JSON.stringify({ ...m.exports }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe('{"a":1}');
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
