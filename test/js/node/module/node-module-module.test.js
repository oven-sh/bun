import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, ospath, tempDir } from "harness";
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

  test("module.globalPaths exists", () => {
    expect(Array.isArray(require("module").globalPaths)).toBe(true);
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

  test("Module._resolveFilename accepts an options object without paths", () => {
    // An options object without .paths used to segfault on the isArray() check.
    expect(Module._resolveFilename("fs", null, false, {})).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, Object.create(null))).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, [])).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, { paths: undefined })).toBe("fs");
    expect(Module._resolveFilename("fs", null, false, { paths: null })).toBe("fs");
  });

  test("createRequire trailing slash", () => {
    const req = createRequire(import.meta.dir + "/");
    expect(req.resolve("./node-module-module.test.js")).toBe(
      ospath(path.resolve(import.meta.dir, "./node-module-module.test.js")),
    );
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
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
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

  describe("Module.prototype._compile with a hashbang line", () => {
    // Only text that user code hands to _compile itself (require-from-string style
    // helpers, require.extensions handlers that readFileSync) still has the file's
    // "#!" line; what bun's loader passes to an overridden _compile is transpiled
    // output with the hashbang already removed. Node accepts the hashbang.
    function compile(source, filename = "/hashbang-test/module.js") {
      const module = new Module(filename);
      module._compile(source, filename);
      return module.exports;
    }

    test.each([
      ["\\n", "#!/usr/bin/env node\nmodule.exports = 42;\n", 42],
      ["\\r\\n", "#!/usr/bin/env node\r\nmodule.exports = 'crlf';\r\n", "crlf"],
      ["\\r", "#!/usr/bin/env node\rmodule.exports = 'cr';", "cr"],
      ["\\u2028", "#!/usr/bin/env node\u2028module.exports = 'ls';", "ls"],
      ["\\u2029", "#!/usr/bin/env node\u2029module.exports = 'ps';", "ps"],
    ])("hashbang line ended by %s", (_, source, expected) => {
      expect(compile(source)).toBe(expected);
    });

    test("source that is only a hashbang line", () => {
      expect(compile("#!/usr/bin/env node")).toEqual({});
      expect(compile("#!")).toEqual({});
    });

    test("a directive prologue after the hashbang still applies", () => {
      const source = [
        "#!/usr/bin/env node",
        '"use strict";',
        "module.exports = (function () { return this; })() === undefined;",
      ].join("\n");
      expect(compile(source)).toBe(true);
    });

    test("line numbers are unchanged", () => {
      const filename = "/hashbang-test/lines.js";
      const error = compile(["#!/usr/bin/env node", "", "module.exports = new Error('here');"].join("\n"), filename);
      expect(error.stack).toContain(`${filename}:3:`);

      let syntaxError;
      try {
        compile(["#!/usr/bin/env node", "var ok = 1;", "var = ;"].join("\n"), filename);
      } catch (e) {
        syntaxError = e;
      }
      expect(syntaxError).toBeInstanceOf(SyntaxError);
      expect(syntaxError.stack).toMatch(/\/hashbang-test\/lines\.js:3\b/);
    });

    test("a hashbang line is not a sourceURL directive", () => {
      const exportError = "module.exports = new Error('x');";
      for (const marker of ["#", "@"]) {
        const { stack } = compile(`#!${marker} sourceURL=fake.js\n${exportError}`, "/hashbang-test/real.js");
        expect(stack).toContain("/hashbang-test/real.js:2:");
        expect(stack).not.toContain("fake.js");
      }
      // The same line as a real comment is a directive, so the check above is meaningful.
      const { stack } = compile(`//# sourceURL=directive.js\n${exportError}`, "/hashbang-test/real.js");
      expect(stack).toContain("directive.js:2:");
    });

    test("a hashbang anywhere but offset 0 is still a syntax error, as in node", () => {
      for (const source of [
        " #!/usr/bin/env node\nmodule.exports = 1;",
        "\n#!/usr/bin/env node\nmodule.exports = 1;",
        "\uFEFF#!/usr/bin/env node\nmodule.exports = 1;",
        "#\nmodule.exports = 1;",
        "module.exports = 1;\n#!/usr/bin/env node\n",
      ]) {
        expect(() => compile(source)).toThrow(SyntaxError);
      }
    });

    test("require.extensions hook that passes the file contents to _compile", async () => {
      using dir = tempDir("compile-hashbang-hook", {
        "cli.js": "#!/usr/bin/env node\nmodule.exports = new Error('x');\n",
        "main.cjs": /* js */ `
          const fs = require("node:fs");
          require.extensions[".js"] = function (module, filename) {
            module._compile(fs.readFileSync(filename, "utf8"), filename);
          };
          const error = require("./cli.js");
          console.log(JSON.stringify({ frame: /cli\\.js:\\d+/.exec(error.stack)[0] }));
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
      expect(JSON.parse(stdout)).toEqual({ frame: "cli.js:2" });
      expect(exitCode).toBe(0);
    });

    test("with an overridden Module.wrapper", async () => {
      // Module.wrapper is process-wide once assigned, so this runs in a child.
      // Node rejects this combination (a patched wrapper makes it compile
      // Module.wrap(source) as a script, which also breaks require() of every
      // shebang file); bun's require() keeps working there and so does _compile.
      const code = /* js */ `
        const Module = require("node:module");
        Module.wrapper = [
          "(function (exports, require, module, __filename, __dirname) { globalThis.wrapped = (globalThis.wrapped ?? 0) + 1;",
          "\\n});",
        ];
        const filename = "/hashbang-test/wrapped.js";
        const m = new Module(filename);
        m._compile(["#!/usr/bin/env node", "module.exports = new Error('x');"].join("\\n"), filename);
        console.log(JSON.stringify({ wrapped: globalThis.wrapped, frame: /wrapped\\.js:\\d+/.exec(m.exports.stack)[0] }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", code],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ wrapped: 1, frame: "wrapped.js:2" });
      expect(exitCode).toBe(0);
    });
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
  test("require a cjs file uses the 'module.exports' export", () => {
    expect(require("./esm_to_cjs_interop.mjs")).toEqual(Symbol.for("meow"));
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
});
