import "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, ospath, tempDir } from "harness";
import Module, { _nodeModulePaths, builtinModules, createRequire, isBuiltin, wrap } from "module";
import path from "path";

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

  // Node's require() looks for a package in the `paths` of the module that requires, and each module gets its `paths` from
  // Module._nodeModulePaths when it is loaded. The answers below are those of Node 26.
  describe("the `paths` of the module that requires", () => {
    const from = place => `exports.from = ${JSON.stringify(place)};`;
    const packages = {
      "node_modules/installed/index.js": from("node_modules"),
      "node_modules/both/index.js": from("node_modules"),
      "extra/only/index.js": from("extra"),
      "extra/both/index.js": from("extra"),
      "extra/with-exports/package.json": JSON.stringify({
        name: "with-exports",
        exports: { ".": "./main.js", "./feature": "./lib/feature.js" },
      }),
      "extra/with-exports/main.js": from("main"),
      "extra/with-exports/lib/feature.js": from("feature"),
      "extra/with-exports/lib/hidden.js": from("hidden"),
      "extra/own-name/index.js": from("extra"),
      "global/from-node-path/index.js": from("global"),
      "global/from-node-path-exports/package.json": JSON.stringify({
        name: "from-node-path-exports",
        exports: "./entry.js",
      }),
      "global/from-node-path-exports/entry.js": from("global exports"),
      "own-name/package.json": JSON.stringify({ name: "own-name", exports: "./main.cjs" }),
      "own-name/main.cjs": from("own package"),
      "own-name/asks.cjs": `module.paths.unshift(require("node:path").join(__dirname, "..", "extra"));\nmodule.exports = require("own-name").from;`,
      "late/keep.txt": "",
    };
    // A case that asks twice has a package of its own: Node remembers a loaded module for the file that loaded it first.
    for (const name of ["in-front", "left-out", "under-text", "for-a-peer"]) {
      packages[`node_modules/${name}/index.js`] = from("node_modules");
      packages[`extra/${name}/index.js`] = from("extra");
    }

    // Each case is the body of a module of its own, in a directory of its own: [what it does, what it answers in Node].
    const cases = {
      "push": [`module.paths.push(extra); return from("only");`, "extra"],
      "push, require.resolve": [
        `module.paths.push(extra); return where(require.resolve("only"));`,
        "extra/only/index.js",
      ],
      "push, module.require": [`module.paths.push(extra); return module.require("only").from;`, "extra"],
      "push, Module.prototype.require": [
        `module.paths.push(extra); return Module.prototype.require.call(module, "only").from;`,
        "extra",
      ],
      "push, a file of the package": [`module.paths.push(extra); return from("only/index.js");`, "extra"],
      "push leaves the nearer copy in front": [`module.paths.push(extra); return from("both");`, "node_modules"],
      "unshift puts the listed copy in front": [`module.paths.unshift(extra); return from("both");`, "extra"],
      "a new list is the whole search": [
        `module.paths = [extra]; return [from("only"), from("installed")];`,
        ["extra", "MODULE_NOT_FOUND"],
      ],
      "an empty list": [`module.paths = []; return from("installed");`, "MODULE_NOT_FOUND"],
      "an entry relative to the working directory": [`module.paths = ["extra"]; return from("only");`, "extra"],
      "an entry with a trailing separator and dot segments": [
        `module.paths = [path.join(extra, "..", "extra") + path.sep]; return from("only");`,
        "extra",
      ],
      "a path and a builtin are found without the list": [
        `module.paths = []; return [require("../../extra/only").from, require(path.join(extra, "only")).from, typeof require("fs").readFileSync];`,
        ["extra", "extra", "function"],
      ],
      "a list that was only read": [
        `void module.paths; return [from("installed"), from("only")];`,
        ["node_modules", "MODULE_NOT_FOUND"],
      ],
      "a copy of the list assigned back": [
        `module.paths = module.paths.slice(); return [from("installed"), from("only")];`,
        ["node_modules", "MODULE_NOT_FOUND"],
      ],
      "a list without its last entry": [
        `module.paths.pop(); return [from("installed"), from("only")];`,
        ["node_modules", "MODULE_NOT_FOUND"],
      ],
      "an entry that is written in place": [
        `module.paths[0] = extra; return [from("only"), from("installed")];`,
        ["extra", "node_modules"],
      ],
      "a list that is cut to no entry": [`module.paths.length = 0; return from("installed");`, "MODULE_NOT_FOUND"],
      "a list that was read before the module got another file name": [
        `void module.paths; module.filename = path.join(path.parse(root).root, "no-such-directory", "file.cjs"); return from("installed");`,
        "node_modules",
      ],
      "a text is no list": [
        `module.paths = "text"; try { require("only"); } catch (e) { return [e.name, e.code ?? null]; }`,
        ["TypeError", null],
      ],
      "a number lists nothing": [`module.paths = 5; return from("installed");`, "MODULE_NOT_FOUND"],
      "an object with a length": [`module.paths = { length: 1, 0: extra }; return from("only");`, "extra"],
      "an entry that is no string, before the package": [
        `module.paths = [1, extra]; return from("only");`,
        "ERR_INVALID_ARG_TYPE",
      ],
      "an entry that is no string, after the package": [`module.paths = [extra, 1]; return from("only");`, "extra"],
      "package.json exports in a listed directory": [
        `module.paths.push(extra); return [from("with-exports"), from("with-exports/feature"), from("with-exports/lib/hidden.js") === "hidden"];`,
        ["main", "feature", false],
      ],
      "NODE_PATH after the list": [
        `module.paths = [extra]; return [from("from-node-path"), from("from-node-path-exports")];`,
        ["global", "global exports"],
      ],
      "NODE_PATH after an empty list": [`module.paths = []; return from("from-node-path");`, "global"],
      "require.resolve.paths": [
        `module.paths = [extra]; return [require.resolve.paths("only")[0] === extra, require.resolve.paths("./only")[0] === __dirname];`,
        [true, true],
      ],
      "Module._resolveFilename with a module": [
        `module.paths.push(extra); return where(Module._resolveFilename("only", module));`,
        "extra/only/index.js",
      ],
      "Module._resolveFilename with an object that has paths": [
        `return [where(Module._resolveFilename("only", { paths: [extra] })), where(Module._resolveFilename("only", { id: __filename, filename: __filename, paths: [extra] }))];`,
        ["extra/only/index.js", "extra/only/index.js"],
      ],
      "Module._resolveFilename with the paths of Module._nodeModulePaths": [
        `return where(Module._resolveFilename("installed", { id: __filename, filename: __filename, paths: Module._nodeModulePaths(__dirname) }));`,
        "node_modules/installed/index.js",
      ],
      "Module.prototype.require with an object that has paths": [
        `return Module.prototype.require.call({ paths: [extra] }, "only").from;`,
        "extra",
      ],
      "options.paths, not the list of the module": [
        `module.paths = [extra]; return [where(require.resolve("installed", { paths: [root] })), where(Module._resolveFilename("installed", module, false, { paths: [root] }))];`,
        ["node_modules/installed/index.js", "node_modules/installed/index.js"],
      ],
      "the package of the file itself comes before the list": [
        `return require("../../own-name/asks.cjs");`,
        "own package",
      ],
      "a loaded module is answered again, in front of a changed list": [
        `const loaded = require("in-front"); module.paths.unshift(extra); return [loaded.from, require("in-front") === loaded, module.require("in-front") === loaded, from("in-front/index.js"), where(require.resolve("in-front"))];`,
        ["node_modules", true, true, "extra", "extra/in-front/index.js"],
      ],
      "a loaded module is answered again, without a list that has it": [
        `const loaded = require("left-out"); module.paths = []; const again = require("left-out") === loaded; delete require.cache[require.resolve("left-out", { paths: [root] })]; return [again, from("left-out")];`,
        [true, "MODULE_NOT_FOUND"],
      ],
      "a loaded module is answered again, with a text for a list": [
        `const loaded = require("under-text"); module.paths = "text"; return require("under-text") === loaded;`,
        true,
      ],
      "a loaded module is answered again, to another file of the directory": [
        `const loaded = require("for-a-peer"); return [loaded.from, require("./peer.cjs") === loaded];`,
        ["node_modules", true],
        {
          "peer.cjs": `module.paths.unshift(require("node:path").join(__dirname, "..", "..", "extra"));\nmodule.exports = require("for-a-peer");`,
        },
      ],
      "a package that is created after a miss": [
        `const late = path.join(root, "late"); module.paths.push(late); const first = from("made-late"); fs.mkdirSync(path.join(late, "made-late")); fs.writeFileSync(path.join(late, "made-late", "index.js"), 'exports.from = "late";'); return [first, from("made-late")];`,
        ["MODULE_NOT_FOUND", "late"],
      ],
      "import() does not read the list": [
        `module.paths.push(extra); return import("only").then(() => "loaded", e => e.code);`,
        "ERR_MODULE_NOT_FOUND",
      ],
      // The file that starts the program then asks for the file by its name.
      "require.main.paths": [
        `require.main.paths.push(path.join(extra, "with-exports", "lib")); return "hidden";`,
        "hidden",
      ],
    };

    test("is where require() and require.resolve() look for a package", async () => {
      const names = Object.keys(cases);
      const files = { ...packages };
      names.forEach((name, index) => {
        const [body, , beside = {}] = cases[name];
        files[`cases/${index}/case.cjs`] = `
          const path = require("node:path"), fs = require("node:fs"), Module = require("node:module");
          const root = path.join(__dirname, "..", "..");
          const extra = path.join(root, "extra");
          const where = found => path.relative(root, found).split(path.sep).join("/");
          const from = id => { try { return require(id).from; } catch (e) { return e.code ?? e.name; } };
          module.exports = (() => { ${body} })();
        `;
        for (const [file, text] of Object.entries(beside)) files[`cases/${index}/${file}`] = text;
      });
      files["main.cjs"] = `
        const names = ${JSON.stringify(names)};
        const results = {};
        (async () => {
          for (let index = 0; index < names.length; index++) {
            try {
              results[names[index]] = await require("./cases/" + index + "/case.cjs");
            } catch (e) {
              results[names[index]] = "threw " + (e.code ?? e.name);
            }
          }
          try {
            results["require.main.paths"] = require("hidden.js").from;
          } catch (e) {
            results["require.main.paths"] = e.code;
          }
          console.log(JSON.stringify(results));
        })();
      `;
      using dir = tempDir("module-paths", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.cjs"],
        env: { ...bunEnv, NODE_PATH: path.join(String(dir), "global") },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(Object.fromEntries(names.map(name => [name, cases[name][1]])));
      expect(exitCode).toBe(0);
    });

    const askers = {
      "loaded/first.cjs": `module.exports = { paths: module.paths.slice(), from: (() => { try { return require("only").from; } catch (e) { return e.code; } })() };`,
      "loaded/second.cjs": `module.exports = "second";`,
      "loaded/by-import.cjs": `module.exports = { listed: module.paths.some(entry => entry.endsWith("extra")), from: (() => { try { return require("only").from; } catch (e) { return e.code; } })() };`,
      "loaded-before/before.cjs": `module.exports = () => { try { return require("only").from; } catch (e) { return e.code; } };`,
      "loaded-after/third.cjs": `module.exports = { paths: module.paths.slice(), from: (() => { try { return require("only").from; } catch (e) { return e.code; } })() };`,
    };

    async function run(files, ...args) {
      using dir = tempDir("module-paths", { ...packages, ...askers, ...files });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const said = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      return said;
    }

    test("comes from Module._nodeModulePaths as the program has replaced it", async () => {
      const said = await run(
        {
          "main.cjs": `
            const path = require("node:path"), Module = require("node:module");
            const extra = path.join(__dirname, "extra");
            const original = Module._nodeModulePaths;
            const calls = [];
            const take = () => calls.splice(0);
            const where = found => path.relative(__dirname, found).split(path.sep).join("/");
            const results = {};
            const before = require("./loaded-before/before.cjs");
            const listsExtra = function (from) {
              calls.push([this === Module, where(from)]);
              return original.call(this, from).concat([extra]);
            };
            Module._nodeModulePaths = listsExtra;
            results["the property"] = [Object.keys(Object.getOwnPropertyDescriptor(Module, "_nodeModulePaths")).sort().join(), Module._nodeModulePaths === listsExtra];
            const first = require("./loaded/first.cjs");
            results["a module that is loaded"] = [first.paths.includes(extra), first.from, take()];
            results["a module that is loaded already"] = [require("./loaded/first.cjs") === first, take()];
            results["require.resolve"] = [where(require.resolve("./loaded/second.cjs")), take()];
            results["createRequire"] = [where(Module.createRequire(path.join(__dirname, "late", "none.js")).resolve("only")), take()];
            results["options.paths"] = [where(require.resolve("only", { paths: [path.join(__dirname, "loaded"), path.join(__dirname, "late")] })), take()];
            results["options.paths, a relative request"] = [where(require.resolve("./second.cjs", { paths: [path.join(__dirname, "loaded")] })), take()];
            results["a module that was loaded before"] = [before(), module.paths.includes(extra), take()];
            class Sub extends Module {}
            Sub._nodeModulePaths = () => [];
            results["a write to a subclass"] = [Module._nodeModulePaths === listsExtra, Object.hasOwn(Sub, "_nodeModulePaths")];
            Module._nodeModulePaths = original;
            const third = require("./loaded-after/third.cjs");
            results["the first function written back"] = [third.paths.includes(extra), third.from, take()];
            Module._nodeModulePaths = () => { throw new Error("from the replaced function"); };
            delete require.cache[require.resolve("./loaded/second.cjs")];
            try { require("./loaded/second.cjs"); } catch (e) { results["a function that throws"] = [e.message, require.resolve("./loaded/second.cjs") in require.cache]; }
            Module._nodeModulePaths = original;
            // module-alias replaces Module._resolveFilename too, with a function that calls the one it found.
            const resolveFilename = Module._resolveFilename;
            let resolved = 0;
            Module._resolveFilename = function (...given) { resolved++; return resolveFilename.apply(this, given); };
            module.paths.push(extra);
            results["a Module._resolveFilename that calls the first"] = [require("only").from, resolved];
            Module._resolveFilename = resolveFilename;
            console.log(JSON.stringify(results));
          `,
        },
        "main.cjs",
      );
      expect(said).toEqual({
        "the property": ["configurable,enumerable,value,writable", true],
        // Node calls the function once for each module that it loads, with the directory of the file.
        "a module that is loaded": [
          true,
          "extra",
          [
            [true, "loaded"],
            [true, "extra/only"],
          ],
        ],
        "a module that is loaded already": [true, []],
        "require.resolve": ["loaded/second.cjs", []],
        "createRequire": ["extra/only/index.js", [[true, "late"]]],
        "options.paths": [
          "extra/only/index.js",
          [
            [true, "loaded"],
            [true, "late"],
          ],
        ],
        "options.paths, a relative request": ["loaded/second.cjs", []],
        "a module that was loaded before": ["MODULE_NOT_FOUND", false, []],
        "a write to a subclass": [true, true],
        "the first function written back": [false, "MODULE_NOT_FOUND", []],
        "a function that throws": ["from the replaced function", false],
        "a Module._resolveFilename that calls the first": ["extra", 1],
      });
    });

    test("comes from the replaced Module._nodeModulePaths for a CommonJS file that import() loads", async () => {
      const said = await run(
        {
          "main.mjs": `
            import Module from "node:module";
            import path from "node:path";
            const extra = path.join(import.meta.dirname, "extra");
            const original = Module._nodeModulePaths;
            let calls = 0;
            Module._nodeModulePaths = function (from) { calls++; return original.call(this, from).concat([extra]); };
            const loaded = await import("./loaded/by-import.cjs");
            console.log(JSON.stringify([loaded.default, calls]));
          `,
        },
        "main.mjs",
      );
      expect(said).toEqual([{ listed: true, from: "extra" }, 2]);
    });

    test("is read in a Worker", async () => {
      const said = await run(
        {
          "worker.cjs": `
            const { parentPort } = require("node:worker_threads");
            module.paths.push(require("node:path").join(__dirname, "extra"));
            let from; try { from = require("only").from; } catch (e) { from = e.code; }
            parentPort.postMessage(from);
          `,
          "main.cjs": `
            const { Worker } = require("node:worker_threads");
            new Worker(require("node:path").join(__dirname, "worker.cjs")).once("message", from => console.log(JSON.stringify(from)));
          `,
        },
        "main.cjs",
      );
      expect(said).toBe("extra");
    });
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
