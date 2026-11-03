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

  // https://github.com/oven-sh/bun/issues/20336
  describe.concurrent("every module object is an instance of Module", () => {
    const isModule = `
      const isModule = m =>
        m instanceof Module && m.constructor === Module && Object.getPrototypeOf(m) === Module.prototype;`;
    // Each program prints one line of JSON. Node v26.3.0 prints the same line.
    async function printedBy(cwd, ...args) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        // Debug builds check every exception scope that the program goes through. Release builds ignore the option.
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        cwd: String(cwd),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: JSON.parse(stdout || "null"), stderr, exitCode };
    }

    test("of a CommonJS program", async () => {
      using dir = tempDir("module-class", {
        "child.cjs": `exports.module = module;`,
        "created.cjs": `exports.module = module;`,
        "handled.js": `module.exports = "handled";`,
        "main.cjs": `
          // Read before anything loads node:module.
          const early = module.constructor;
          const attempt = fn => {
            try {
              return fn();
            } catch (error) {
              return error.code ?? error.constructor.name;
            }
          };
          const reports = {
            // n8n calls it when it starts
            initPaths: typeof early._initPaths,
            // decache lists the keys of module.constructor._pathCache
            statics: attempt(() => [
              typeof early._pathCache,
              Array.isArray(Object.keys(early._pathCache)),
              early._cache === require.cache,
              typeof early._nodeModulePaths,
              typeof early._resolveFilename,
            ]),
            // solc compiles the compiler that it downloaded this way
            compiled: attempt(() => {
              const compiled = new early();
              compiled._compile("module.exports = 42", "from-string.js");
              return compiled.exports;
            }),
          };
          const child = require("./child.cjs");
          const Module = require("node:module");
          const path = require("node:path");
          ${isModule}

          const handled = [];
          const js = Module._extensions[".js"];
          Module._extensions[".js"] = function (m, filename) {
            handled.push(isModule(m), path.basename(filename));
            return js(m, filename);
          };
          handled.push(require("./handled.js"));
          Module._extensions[".js"] = js;

          const parents = [];
          const resolveFilename = Module._resolveFilename;
          Module._resolveFilename = function (request, parent) {
            if (request === "./created.cjs") parents.push(parent);
            return resolveFilename.apply(this, arguments);
          };
          const created = Module.createRequire(__filename)("./created.cjs");
          Module._resolveFilename = resolveFilename;

          // hexo requires its plugins through a module object that it made
          const plugin = path.join(__dirname, "plugin.js");
          const made = new Module(plugin);
          made.filename = plugin;
          made.paths = Module._nodeModulePaths(plugin);
          class Sub extends Module {}
          Sub.prototype.require = function () {
            return "sub";
          };
          const sub = new Sub("sub");
          console.log(
            JSON.stringify({
              early: early === Module,
              prototypeConstructor: Module.prototype.constructor === Module,
              module: isModule(module),
              main: isModule(require.main),
              cache: isModule(require.cache[require.resolve("./child.cjs")]),
              child: isModule(child.module),
              parent: isModule(child.module.parent),
              children: module.children.map(m => [path.basename(m.filename), isModule(m)]),
              extensionHandler: handled,
              createRequire: [parents.map(isModule), isModule(created.module), isModule(created.module.parent)],
              made: [isModule(made), typeof made.require, attempt(() => made.require("./child.cjs") === child)],
              // Code of a node:vm context reads require off a module object.
              inAContext: attempt(() =>
                require("node:vm").runInNewContext("typeof made.require('node:path').join", { made: new Module("made") }),
              ),
              sub: [
                sub instanceof Sub,
                sub instanceof Module,
                sub.constructor === Sub,
                sub.id,
                attempt(() => sub.require("y")),
              ],
              ...reports,
            }),
          );
        `,
      });
      expect(await printedBy(dir, "main.cjs")).toEqual({
        stdout: {
          early: true,
          prototypeConstructor: true,
          module: true,
          main: true,
          cache: true,
          child: true,
          parent: true,
          children: [
            ["child.cjs", true],
            ["handled.js", true],
          ],
          extensionHandler: [true, "handled.js", "handled"],
          createRequire: [[true], true, true],
          made: [true, "function", true],
          inAContext: "function",
          sub: [true, true, true, "sub", "sub"],
          initPaths: "function",
          statics: ["object", true, true, "function", "function"],
          compiled: 42,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test("that an ES module imports or requires", async () => {
      using dir = tempDir("module-class-esm", {
        "imported.cjs": `exports.module = module;`,
        "required.cjs": `exports.module = module;`,
        "main.mjs": `
          import Module, { createRequire } from "node:module";
          import imported from "./imported.cjs";
          ${isModule}
          const require = createRequire(import.meta.url);
          const parents = [];
          const resolveFilename = Module._resolveFilename;
          Module._resolveFilename = function (request, parent) {
            if (request === "./required.cjs") parents.push(parent);
            return resolveFilename.apply(this, arguments);
          };
          const required = require("./required.cjs");
          require.resolve("./required.cjs");
          Module._resolveFilename = resolveFilename;
          console.log(
            JSON.stringify({
              imported: isModule(imported.module),
              required: [isModule(required.module), required.module.parent === parents[0]],
              resolveFilenameParents: parents.map(isModule),
            }),
          );
        `,
      });
      expect(await printedBy(dir, "main.mjs")).toEqual({
        stdout: { imported: true, required: [true, true], resolveFilenameParents: [true, true] },
        stderr: "",
        exitCode: 0,
      });
    });

    test("of a Worker", async () => {
      using dir = tempDir("module-class-worker", {
        "child.cjs": `exports.module = module;`,
        "worker.cjs": `
          // Read before anything loads node:module.
          const early = module.constructor;
          const child = require("./child.cjs");
          const Module = require("node:module");
          ${isModule}
          require("node:worker_threads").parentPort.postMessage({
            early: early === Module,
            module: isModule(module),
            child: isModule(child.module),
            parent: isModule(child.module.parent),
          });
        `,
        "main.cjs": `
          const { once } = require("node:events");
          const Module = require("node:module");
          const { Worker } = require("node:worker_threads");
          ${isModule}
          once(new Worker(require.resolve("./worker.cjs")), "message").then(([worker]) =>
            console.log(JSON.stringify({ mainThread: isModule(module), worker })),
          );
        `,
      });
      expect(await printedBy(dir, "main.cjs")).toEqual({
        stdout: { mainThread: true, worker: { early: true, module: true, child: true, parent: true } },
        stderr: "",
        exitCode: 0,
      });
    });

    test("of bun -e", async () => {
      const script = `
        // Read before anything loads node:module.
        const early = module.constructor;
        const Module = require("node:module");
        ${isModule}
        console.log(JSON.stringify({ early: early === Module, module: isModule(module) }));
      `;
      expect(await printedBy(import.meta.dir, "-e", script)).toEqual({
        stdout: { early: true, module: true },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The Module class is created on first use: by the first module object or by the first load of node:module.
  describe.concurrent("module objects inherit a function stored on Module.prototype", () => {
    const report = `m => ({ inherits: m.x === x && !Object.hasOwn(m, "x"), instance: m instanceof Module })`;
    const files = {
      "after.cjs": `exports.module = module;`,
      "commonjs-first.cjs": `
        // The module object of this file is made before node:module is loaded.
        const Module = require("node:module");
        const report = ${report};
        function x() {}
        Module.prototype.x = x;
        const after = require("./after.cjs").module;
        console.log(JSON.stringify({ before: report(module), after: report(after) }));
      `,
      "node-module-first.mjs": `
        // No module object is made before the store.
        import Module, { createRequire } from "node:module";
        const report = ${report};
        function x() {}
        Module.prototype.x = x;
        const require = createRequire(import.meta.url);
        const after = require("./after.cjs").module;
        console.log(JSON.stringify({ after: report(after) }));
      `,
      "made-before-the-store.mjs": `
        // The first module object is made between the load of node:module and the store.
        import Module, { createRequire } from "node:module";
        const report = ${report};
        function x() {}
        const before = new Module("before");
        Module.prototype.x = x;
        const require = createRequire(import.meta.url);
        const after = require("./after.cjs").module;
        console.log(JSON.stringify({ before: report(before), after: report(after) }));
      `,
    };
    const inherited = { inherits: true, instance: true };

    test.each([
      ["when a CommonJS module is made first", "commonjs-first.cjs", { before: inherited, after: inherited }],
      ["when node:module is loaded first", "node-module-first.mjs", { after: inherited }],
      [
        "when node:module is loaded first and a module is made before the store",
        "made-before-the-store.mjs",
        { before: inherited, after: inherited },
      ],
    ])("%s", async (_, entry, expected) => {
      using dir = tempDir("module-prototype-store", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Node v26.3.0 prints the same line for each file.
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify(expected) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  test("the properties of Module.prototype and the names a module object lists", async () => {
    using dir = tempDir("module-prototype-shape", {
      "main.cjs": `
        const c = require("node:module").prototype._compile;
        const { _compile, require: r } = require("node:module").prototype;
        const Module = require("node:module");
        const util = require("node:util");
        const descriptorOf = name => {
          const descriptor = Object.getOwnPropertyDescriptor(Module.prototype, name);
          if (!descriptor) return null;
          for (const key of Object.keys(descriptor)) {
            if (typeof descriptor[key] !== "boolean") descriptor[key] = typeof descriptor[key];
          }
          return descriptor;
        };
        const listed = [];
        for (const key in module) listed.push(key);
        console.log(JSON.stringify({
          spellings: [typeof c, typeof _compile, typeof r],
          sameCompile: [c === _compile, Module.prototype._compile === module._compile],
          compileDescriptor: descriptorOf("_compile"),
          requireDescriptor: descriptorOf("require"),
          constructorDescriptor: descriptorOf("constructor"),
          inspectPrefix: util.inspect(module).split("{")[0],
          bun: {
            forIn: listed,
            keys: Object.keys(module),
            prototypeKeys: Object.keys(Module.prototype).sort(),
          },
        }));
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
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        // Node v26.3.0 prints the same for every row outside `bun`.
        spellings: ["function", "function", "function"],
        sameCompile: [true, true],
        compileDescriptor: { value: "function", writable: true, enumerable: true, configurable: true },
        requireDescriptor: { value: "function", writable: true, enumerable: true, configurable: true },
        constructorDescriptor: { get: "function", set: "undefined", enumerable: false, configurable: false },
        inspectPrefix: "",
        // Bun keeps the fields of a module on Module.prototype, so these rows are its own.
        bun: {
          forIn: ["exports", "require", "filename", "id", "loaded", "path", "paths", "_compile"],
          keys: ["exports", "require"],
          // Node prints ["_compile", "load", "require"].
          prototypeKeys: ["_compile", "filename", "id", "loaded", "path", "paths", "require"],
        },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a write through an accessor of Module.prototype stays with the object it is written to, and is dropped on the prototype itself", async () => {
    using dir = tempDir("module-prototype-receivers", {
      // Not strict, so a store that fails stays silent.
      "sloppy.cjs": `
        exports.storeConstructor = (object, value) => {
          object.constructor = value;
        };
      `,
      "main.cjs": `
        "use strict";
        const Module = require("node:module");
        const prototypeRequire = Module.prototype.require;
        const thrownBy = fn => {
          try {
            fn();
            return "nothing";
          } catch (error) {
            return error.constructor.name;
          }
        };

        const made = new Module("made");
        made.require = () => "made";
        class Sub extends Module {}
        Sub.prototype.require = () => "sub";
        const plain = Object.create(Module.prototype);
        plain.id = "plain";
        plain.paths = ["plain"];
        plain._compile = "plain";
        const hook = function hook() {};
        Module.prototype._compile = hook;

        const out = {
          made: made.require("node:os"),
          sub: new Sub("sub").require("node:os"),
          requireOfTheModule: typeof require("node:os").platform,
          prototypeRequire: Module.prototype.require === prototypeRequire,
          plain: [Object.keys(plain).sort(), plain.id, module.id],
          prototypeCompile: [Module.prototype._compile === hook, module._compile === hook],
        };

        // Module.prototype.constructor is a getter with no setter.
        const sloppy = new Module("sloppy");
        require("./sloppy.cjs").storeConstructor(sloppy, 5);
        out.constructorStores = {
          sloppy: [Object.hasOwn(sloppy, "constructor"), sloppy.constructor === Module],
          strict: thrownBy(() => {
            new Module("strict").constructor = 5;
          }),
          objectAssign: thrownBy(() => Object.assign(new Module("assigned"), { constructor: 5 })),
          // What TypeScript's __extends for ES5 does. ttypescript 1.5.6 to 1.5.14 extends Module with it.
          es5Subclass: thrownBy(() => {
            function Old() {}
            Old.prototype = Object.create(Module.prototype);
            Old.prototype.constructor = Old;
          }),
          reflectSet: Reflect.set(new Module("reflected"), "constructor", 5),
        };

        const fields = {};
        for (const name of ["id", "filename", "loaded", "path", "paths", "parent", "children"]) {
          const before = [module[name], made[name]];
          Module.prototype[name] = "P";
          const deleted = Reflect.deleteProperty(Module.prototype, name);
          const defined = Reflect.defineProperty(Module.prototype, name, { value: "D", writable: true, configurable: true });
          const heir = Object.create(Module.prototype);
          heir[name] = "H";
          const descriptor = Object.getOwnPropertyDescriptor(Module.prototype, name);
          fields[name] = [
            module[name] === before[0] && made[name] === before[1],
            typeof descriptor.get,
            Object.hasOwn(heir, name) && heir[name],
            [deleted, defined, descriptor.configurable],
          ];
        }
        out.bun = { fields, prototypeId: [String(Module.prototype.id), String(Object.create(Module.prototype).id)] };
        console.log(JSON.stringify(out));
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
    // A row: the module and a made one read as before, the prototype keeps its accessor, an heir holds its own value,
    // and the accessor can be neither deleted nor defined again.
    const row = [true, "function", "H", [false, false, false]];
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        // Node v26.3.0 prints the same for every row outside `bun`.
        made: "made",
        sub: "sub",
        requireOfTheModule: "function",
        prototypeRequire: true,
        plain: [["_compile", "id", "paths"], "plain", "."],
        prototypeCompile: [true, true],
        constructorStores: {
          sloppy: [false, true],
          strict: "TypeError",
          objectAssign: "TypeError",
          es5Subclass: "TypeError",
          reflectSet: false,
        },
        bun: {
          // Node stores "P" on the prototype and prints "undefined" in the middle for every name but parent.
          // It deletes and defines every name but parent: [true, true, true] at the end.
          fields: { id: row, filename: row, loaded: row, path: row, paths: row, parent: row, children: row },
          // Node prints ["P", "P"].
          prototypeId: ["undefined", "undefined"],
        },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  describe.concurrent("hooks on Module.prototype and Module._load", () => {
    async function run(cwd, ...args) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        // Debug builds check every exception scope that the program goes through. Release builds ignore the option.
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
        cwd: String(cwd),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }
    const printed = ({ stdout, stderr, exitCode }) => ({ stdout: JSON.parse(stdout || "null"), stderr, exitCode });

    // pirates and other transpile hooks store module._compile in a handler of Module._extensions.
    test("module._compile stored by a Module._extensions handler transforms the file", async () => {
      using dir = tempDir("module-compile-hook", {
        "hooked.js": `module.exports = "original";`,
        "main.cjs": `
          "use strict";
          const Module = require("node:module");
          const path = require("node:path");
          const defaultCompile = Module.prototype._compile;

          // The hook delegates, so the line is the same whether or not the loader calls it.
          const hook = function hook(code, file) {
            return defaultCompile.call(this, code, file);
          };
          Module.prototype._compile = hook;
          const compiled = [];
          const stores = [];
          const js = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            const compile = module._compile;
            module._compile = function (code, file) {
              compiled.push(path.basename(file));
              return compile.call(this, code.replace("original", "patched"), file);
            };
            stores.push([compile === hook, Object.hasOwn(module, "_compile")]);
            return js(module, filename);
          };
          const load = () => {
            delete require.cache[require.resolve("./hooked.js")];
            compiled.length = 0;
            return [require("./hooked.js"), compiled.slice()];
          };
          const out = {
            prototypeCompile: Module.prototype._compile === hook,
            hooked: load(),
          };
          // shimmer redefines the method as a data property.
          Object.defineProperty(Module.prototype, "_compile", {
            value: hook,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          out.hookedAfterDefineProperty = load();
          // For each load: the handler read the hook through the module, and its store made an own property.
          out.stores = stores;
          console.log(JSON.stringify(out));
        `,
        // Not strict, so a store that fails stays silent.
        "other-writes.cjs": `
          const Module = require("node:module");
          const path = require("node:path");
          const defaultCompile = Module.prototype._compile;
          const compiled = [];
          const transform = (code, file) => {
            compiled.push(path.basename(file));
            return code.replace("original", "patched");
          };
          const js = Module._extensions[".js"];

          class Sub extends Module {
            _compile(code, file) {
              return defaultCompile.call(this, transform(code, file), file);
            }
          }
          const file = path.join(__dirname, "hooked.js");
          const sub = new Sub(file, module);
          sub.filename = file;
          js(sub, file);
          const out = { subclass: [sub instanceof Sub, sub.exports, compiled.slice()] };

          const hook = function hook(code, file) {
            return defaultCompile.call(this, code, file);
          };
          Module._extensions[".js"] = function (module, filename) {
            const compile = module._compile;
            module._compile = function (code, file) {
              return compile.call(this, transform(code, file), file);
            };
            return js(module, filename);
          };
          const load = () => {
            delete require.cache[require.resolve("./hooked.js")];
            compiled.length = 0;
            return [require("./hooked.js"), compiled.slice()];
          };
          Object.defineProperty(Module.prototype, "_compile", { value: hook });
          out.redefined = load();
          Object.defineProperty(Module.prototype, "_compile", { value: hook, writable: false });
          out.nonWritable = load();
          Object.defineProperty(Module.prototype, "_compile", { get: () => hook, set() {} });
          out.accessor = load();
          console.log(JSON.stringify(out));
        `,
      });
      const [main, otherWrites] = await Promise.all([run(dir, "main.cjs"), run(dir, "other-writes.cjs")]);
      const patched = ["patched", ["hooked.js"]];
      const untouched = ["original", []];
      expect({ main: printed(main), otherWrites: printed(otherWrites) }).toEqual({
        // Node v26.3.0 prints the same line.
        main: {
          stdout: {
            prototypeCompile: true,
            hooked: patched,
            hookedAfterDefineProperty: patched,
            stores: [
              [true, true],
              [true, true],
            ],
          },
          stderr: "",
          exitCode: 0,
        },
        otherWrites: {
          stdout: {
            // Node v26.3.0 calls Sub.prototype._compile and prints [true, "patched", ["hooked.js"]].
            subclass: [true, "original", []],
            redefined: patched,
            // Node v26.3.0 prints the same: the store on the module fails.
            nonWritable: untouched,
            // Node v26.3.0 prints the same: the store goes to the setter.
            accessor: untouched,
          },
          stderr: "",
          exitCode: 0,
        },
      });
    });

    test("a file that a _compile or a handler of the program evaluated is loaded and can be imported", async () => {
      using dir = tempDir("module-compiled-by-the-program", {
        "dep.js": `
          globalThis.runs = (globalThis.runs || 0) + 1;
          module.exports = { dep: true, runs: globalThis.runs };
        `,
        "compile.cjs": `
          const Module = require("node:module");
          const vm = require("node:vm");
          const path = require("node:path");
          // Evaluates the text itself and never calls the built-in _compile, as v8-compile-cache does.
          exports.compile = function (content, filename) {
            const fn = vm.runInThisContext(Module.wrap(content), { filename });
            return fn.call(this.exports, this.exports, id => this.require(id), this, filename, path.dirname(filename));
          };
          exports.report = async () => {
            const first = require("./dep.js");
            const entry = require.cache[require.resolve("./dep.js")];
            const second = require("./dep.js");
            const imported = await import("./dep.js").then(
              namespace => namespace.default,
              error => error.message,
            );
            console.log(
              JSON.stringify({ first, loaded: entry.loaded, same: first === second, imported, runs: globalThis.runs }),
            );
          };
        `,
        // The function is on Module.prototype, and a handler wraps what it reads from the module, as pirates does.
        "prototype.cjs": `
          const Module = require("node:module");
          const { compile, report } = require("./compile.cjs");
          Module.prototype._compile = compile;
          const js = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            const inherited = module._compile;
            module._compile = function (code, file) {
              return inherited.call(this, code, file);
            };
            return js(module, filename);
          };
          report();
        `,
        // A handler stores the function on the module.
        "own.cjs": `
          const Module = require("node:module");
          const { compile, report } = require("./compile.cjs");
          const js = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            module._compile = compile;
            return js(module, filename);
          };
          report();
        `,
        // A handler evaluates the file and calls neither the built-in handler nor _compile.
        "handler.cjs": `
          const Module = require("node:module");
          const { compile, report } = require("./compile.cjs");
          Module._extensions[".js"] = function (module, filename) {
            compile.call(module, require("node:fs").readFileSync(filename, "utf8"), filename);
          };
          report();
        `,
      });
      const [onPrototype, own, handler] = await Promise.all(
        ["prototype.cjs", "own.cjs", "handler.cjs"].map(entry => run(dir, entry)),
      );
      // Node v26.3.0 prints the same line for each file.
      const evaluatedOnce = {
        stdout: { first: { dep: true, runs: 1 }, loaded: true, same: true, imported: { dep: true, runs: 1 }, runs: 1 },
        stderr: "",
        exitCode: 0,
      };
      expect({ onPrototype: printed(onPrototype), own: printed(own), handler: printed(handler) }).toEqual({
        onPrototype: evaluatedOnce,
        own: evaluatedOnce,
        handler: evaluatedOnce,
      });
    });

    test("Module._load loads the request for the parent", async () => {
      const loaded = `module.exports = require("./report.cjs").report(module);`;
      using dir = tempDir("module-load", {
        "child.cjs": `module.exports = { child: true };`,
        "virtual/dep.cjs": `module.exports = { dep: true, parentIsAModule: module.parent instanceof require("node:module") };`,
        // What a file knows about how it was loaded.
        "report.cjs": `
          exports.report = m => ({
            parent: m.parent === null ? "null" : typeof m.parent,
            id: m.id === m.filename ? "its filename" : m.id,
            mainModule: process.mainModule === m,
          });
        `,
        "no-parent.cjs": loaded,
        "null-parent.cjs": loaded,
        "plain-parent.cjs": loaded,
        "launched.cjs": loaded,
        "main.cjs": `
          const Module = require("node:module");
          const path = require("node:path");
          const vm = require("node:vm");
          const attempt = fn => {
            try {
              return fn();
            } catch (error) {
              return error.code ?? error.name;
            }
          };
          const child = attempt(() => module.constructor._load("./child.cjs", module));
          // require-like@0.1.2 makes the parent. The eval package under Docusaurus and vanilla-extract loads with it (#5925).
          function requireLike(file) {
            const parentModule = new Module(file);
            parentModule.filename = file;
            parentModule.paths = Module._nodeModulePaths(path.dirname(file));
            const requireLike = request => Module._load(request, parentModule);
            requireLike.parentModule = parentModule;
            return requireLike;
          }
          const made = requireLike(path.join(__dirname, "virtual", "file.js"));
          const plainParent = { filename: __filename };
          const cached = name => require.cache[path.join(__dirname, name)];
          console.log(
            JSON.stringify({
              builtin: Module._load("node:path", module) === require("node:path"),
              file: child,
              sameAsRequire: child === require("./child.cjs"),
              parent: cached("child.cjs").parent === module,
              missing: attempt(() => Module._load("./missing.cjs", module)),
              madeParent: attempt(() =>
                vm.runInNewContext('[require("./dep.cjs"), typeof require("os").platform]', { require: made }),
              ),
              madeParentIsTheParent: attempt(() => cached("virtual/dep.cjs").parent === made.parentModule),
              madeParentMissing: attempt(() => vm.runInNewContext('require("./missing.cjs")', { require: made })),
              noParent: attempt(() => [
                Module._load(path.join(__dirname, "no-parent.cjs")),
                cached("no-parent.cjs").parent === undefined,
              ]),
              nullParent: attempt(() => [
                Module._load(path.join(__dirname, "null-parent.cjs"), null),
                cached("null-parent.cjs").parent === null,
              ]),
              plainParent: attempt(() => [
                Module._load("./plain-parent.cjs", plainParent, false),
                cached("plain-parent.cjs").parent === plainParent,
              ]),
              bun: {
                // pm2 starts the script of an application this way.
                launched: attempt(() => Module._load(path.join(__dirname, "launched.cjs"), null, true)),
                mainIsStillTheEntry: require.main === module && process.mainModule === module,
              },
            }),
          );
        `,
      });
      const asLoaded = parent => ({ parent, id: "its filename", mainModule: false });
      expect(printed(await run(dir, "main.cjs"))).toEqual({
        stdout: {
          // Node v26.3.0 prints the same for every row outside `bun`.
          builtin: true,
          file: { child: true },
          sameAsRequire: true,
          parent: true,
          missing: "MODULE_NOT_FOUND",
          madeParent: [{ dep: true, parentIsAModule: true }, "function"],
          madeParentIsTheParent: true,
          madeParentMissing: "MODULE_NOT_FOUND",
          noParent: [asLoaded("undefined"), true],
          nullParent: [asLoaded("null"), true],
          plainParent: [asLoaded("object"), true],
          bun: {
            // Bun does not read the third argument. Node makes the file the main module: id ".", mainModule true.
            launched: asLoaded("null"),
            // Node prints false.
            mainIsStillTheEntry: true,
          },
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // The function is the one of @teambit/bit (scopes/harmony/bit/hook-require.ts).
    test("a require hook stored through module.constructor.prototype loads with this.constructor._load", async () => {
      using dir = tempDir("module-constructor-require-hook", {
        "child.cjs": `module.exports = { child: true, os: typeof require("node:os").platform };`,
        "main.cjs": `
          const path = require("path");
          const fs = require("fs");
          function hookRequire() {
            module.constructor.prototype.require = function (id) {
              if (typeof id !== 'string') throw new Error('hookRequire - id must be a string');
              if (!id) throw new Error('hookRequire - missing id');
              if (id.endsWith('.scss') || id.endsWith('.css') || id.endsWith('.less') || id === 'reset-css') {
                return {};
              }
              try {
                return this.constructor._load(id, this);
              } catch (firstErr) {
                if (firstErr.code !== 'MODULE_NOT_FOUND') {
                  throw firstErr;
                }
                try {
                  const pkgJson = this.constructor._load(path.join(id, 'package.json'), this);
                  if (!pkgJson.main || pkgJson.main === 'index.js') throw firstErr;
                  return this.constructor._load(path.join(id, pkgJson.main), this);
                } catch {
                  throw firstErr;
                }
              }
            };
          }
          hookRequire();
          const attempt = fn => {
            try {
              return fn();
            } catch (error) {
              return error.code ?? error.name;
            }
          };
          console.log(
            JSON.stringify({
              file: attempt(() => require("./child.cjs")),
              builtin: attempt(() => require("node:fs") === fs),
              missing: attempt(() => require("definitely-not-installed-pkg")),
              // Only the hook answers this name, and it loads nothing for it.
              answeredByTheHook: attempt(() => require("reset-css")),
              onObjectPrototype: Object.hasOwn(Object.prototype, "require"),
            }),
          );
        `,
      });
      // Node v26.3.0 prints the same line.
      expect(printed(await run(dir, "--no-install", "main.cjs"))).toEqual({
        stdout: {
          file: { child: true, os: "function" },
          builtin: true,
          missing: "MODULE_NOT_FOUND",
          answeredByTheHook: {},
          onObjectPrototype: false,
        },
        stderr: "",
        exitCode: 0,
      });
    });

    test('spyOn(Module.prototype, "_compile") installs and restores', async () => {
      using dir = tempDir("module-prototype-compile-spy", {
        "spy.test.cjs": `
          const { test, expect, spyOn } = require("bun:test");
          const Module = require("node:module");
          test("spy", () => {
            const original = Module.prototype._compile;
            const spy = spyOn(Module.prototype, "_compile");
            expect(Module.prototype._compile).toBe(spy);
            // A module object inherits the spy.
            const made = new Module("made");
            made._compile("module.exports = 42", "made.js");
            expect(spy.mock.calls).toEqual([["module.exports = 42", "made.js"]]);
            expect(made.exports).toBe(42);
            spy.mockRestore();
            expect(Module.prototype._compile).toBe(original);
            expect(Object.getOwnPropertyDescriptor(Module.prototype, "_compile")).toEqual({
              value: original,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          });
        `,
      });
      const { stderr, exitCode } = await run(dir, "test", "./spy.test.cjs");
      expect(stderr).toContain(" 1 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    });
  });

  test("every file of bun test --isolate has its own Module, and its module objects are instances of it", async () => {
    const file = `
      // Read before this file loads node:module.
      const early = module.constructor;
      const Module = require("node:module");
      const child = require("./child.cjs");
      test("reads its module object", () => {
        const inherits = ["leftByATestFile" in module];
        Module.prototype.leftByATestFile = true;
        inherits.push("leftByATestFile" in module);
        console.log(JSON.stringify({
          early: early === Module,
          module: module instanceof Module,
          child: child.module instanceof Module && child.module.constructor === Module,
          inherits,
        }));
      });
    `;
    using dir = tempDir("module-class-isolate", {
      "child.cjs": `exports.module = module;`,
      "1-first.test.cjs": file,
      "2-second.test.cjs": file,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./1-first.test.cjs", "./2-second.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printed = stdout.split("\n").filter(line => line.startsWith("{"));
    // The second file inherits nothing that the first left on Module.prototype.
    const rows = { early: true, module: true, child: true, inherits: [false, true] };
    expect(printed.map(line => JSON.parse(line))).toEqual([rows, rows]);
    expect(stderr).toContain(" 2 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  // The bundler wraps a CommonJS file in a function that is handed a plain object: no class reaches it.
  test("module.constructor is Object in a file that the bundler wrapped", async () => {
    using dir = tempDir("module-class-bundles", {
      "dependency.cjs": `
        const Module = require("node:module");
        const name = constructor =>
          constructor === Module ? "Module" : constructor === Object ? "Object" : typeof constructor;
        module.exports = { name, dependency: name(module.constructor) };
      `,
      "entry.cjs": `
        const { name, dependency } = require("./dependency.cjs");
        console.log(JSON.stringify({ entry: name(module.constructor), dependency }));
      `,
    });
    const run = async (...args) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const printedBy = async (format, outfile) => {
      const built = await run("build", "--target=bun", `--format=${format}`, "entry.cjs", "--outfile", outfile);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { stdout, stderr, exitCode } = await run(outfile);
      return { stdout: JSON.parse(stdout || "null"), stderr, exitCode };
    };
    const [esm, cjs] = await Promise.all([printedBy("esm", "bundle.mjs"), printedBy("cjs", "bundle.cjs")]);
    expect({ esm, cjs }).toEqual({
      esm: { stdout: { entry: "Object", dependency: "Object" }, stderr: "", exitCode: 0 },
      // The runtime loads a CommonJS bundle as a CommonJS file, so the entry point has a module object.
      cjs: { stdout: { entry: "Module", dependency: "Object" }, stderr: "", exitCode: 0 },
    });
  });
});
