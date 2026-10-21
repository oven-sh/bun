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

  describe.concurrent("Module.prototype._compile override", () => {
    // The `_compile` hook receives the body Bun hands to the wrapper, so a rewrite targets that text.
    const files = {
      "package.json": JSON.stringify({ type: "commonjs" }),
      "target.js": "module.exports = function target() { return require('./nested.js') + 1; };\n",
      "nested.js": "module.exports = 1;\n",
      "meta.cjs": "exports.meta = typeof import.meta.url;\nexports.n = 1;\n",
      "hook.js": `
        const Module = require("node:module");
        const path = require("node:path");
        const orig = Module.prototype._compile;
        const compiled = [];
        Module.prototype._compile = function (content, filename, ...rest) {
          compiled.push({ file: path.basename(filename), isModule: this instanceof Module, id: this.id === filename });
          return orig.call(this, content.replace("= 1;", "= 100;"), filename, ...rest);
        };
        module.exports = { compiled, orig };
      `,
    };

    async function run(dir, args) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      return parsed;
    }

    test("require() calls it for every CommonJS file, with the module as this", async () => {
      using dir = tempDir("module-prototype-compile", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const { compiled, orig } = require("./hook.js");
          const result = require("./target.js")();
          Module.prototype._compile = orig;
          const afterRestore = compiled.length;
          delete require.cache[require.resolve("./nested.js")];
          require("./nested.js");
          console.log(JSON.stringify({ compiled, result, calledAfterRestore: compiled.length - afterRestore }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({
        compiled: [
          { file: "target.js", isModule: true, id: true },
          { file: "nested.js", isModule: true, id: true },
        ],
        result: 101,
        calledAfterRestore: 0,
      });
    });

    test("an own module._compile shadows the prototype override", async () => {
      using dir = tempDir("module-prototype-compile-own", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const { compiled, orig } = require("./hook.js");
          let own = 0;
          const ext = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            if (filename.endsWith("nested.js")) {
              module._compile = function (content, filename) {
                own++;
                return orig.call(this, content, filename);
              };
            }
            return ext.call(this, module, filename);
          };
          const result = require("./target.js")();
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), own, result }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["target.js"], own: 1, result: 2 });
    });

    test("a Module._extensions wrapper that delegates still reaches the prototype override", async () => {
      using dir = tempDir("module-prototype-compile-bridge", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const { compiled } = require("./hook.js");
          const ext = Module._extensions[".js"];
          let wrapped = 0;
          Module._extensions[".js"] = function (module, filename) {
            wrapped++;
            return ext.call(this, module, filename);
          };
          const result = require("./target.js")();
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), wrapped, result }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["target.js", "nested.js"], wrapped: 2, result: 101 });
    });

    test("import of a CommonJS file from ESM goes through it", async () => {
      using dir = tempDir("module-prototype-compile-esm", {
        ...files,
        "main.mjs": `
          import { createRequire } from "node:module";
          const { compiled } = createRequire(import.meta.url)("./hook.js");
          const { default: target } = await import("./target.js");
          const result = target();
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), result }));
        `,
      });
      expect(await run(dir, ["main.mjs"])).toEqual({ compiled: ["target.js", "nested.js"], result: 101 });
    });

    test("the default _compile wraps a rewritten body that uses import.meta with its parameter", async () => {
      using dir = tempDir("module-prototype-compile-meta", {
        ...files,
        "main.js": `
          const { compiled } = require("./hook.js");
          const meta = require("./meta.cjs");
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), meta }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["meta.cjs"], meta: { meta: "string", n: 100 } });
    });

    test("a hook that evaluates the body itself leaves a loaded module with exports", async () => {
      using dir = tempDir("module-prototype-compile-self", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const vm = require("node:vm");
          let calls = 0;
          Module.prototype._compile = function (content, filename) {
            calls++;
            const fn = vm.runInThisContext(Module.wrap(content), { filename });
            fn.call(this.exports, this.exports, this.require.bind(this), this, filename, require("path").dirname(filename));
          };
          const result = require("./target.js")();
          const entry = require.cache[require.resolve("./nested.js")];
          console.log(JSON.stringify({ calls, result, loaded: entry.loaded, exports: entry.exports }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ calls: 2, result: 2, loaded: true, exports: 1 });
    });

    test("bun test --isolate runs it for a file served from the isolation cache", async () => {
      using dir = tempDir("module-prototype-compile-isolate", {
        ...files,
        "a.test.js": `
          const { compiled } = require("./hook.js");
          test("a", () => { expect(require("./target.js")()).toBe(101); expect(compiled.map(c => c.file)).toEqual(["target.js", "nested.js"]); });
        `,
        "b.test.js": `
          const { compiled } = require("./hook.js");
          test("b", () => { expect(require("./target.js")()).toBe(101); expect(compiled.map(c => c.file)).toEqual(["target.js", "nested.js"]); });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "a.test.js", "b.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 2 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });

    test("module.constructor is Module before anything loads node:module", async () => {
      using dir = tempDir("module-prototype-compile-ctor", {
        "main.js": `
          const ctor = module.constructor;
          const protoRequire = Object.getPrototypeOf(module).require;
          const Module = require("node:module");
          console.log(JSON.stringify({
            ctor: ctor === Module,
            protoRequire: typeof protoRequire === "function",
            instance: module instanceof Module,
            compile: Object.getPrototypeOf(module)._compile === Module.prototype._compile,
          }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ ctor: true, protoRequire: true, instance: true, compile: true });
    });

    test("bun build --format=cjs output with a hashbang reaches the hook as its body", async () => {
      using dir = tempDir("module-prototype-compile-bundled", {
        ...files,
        "src.js": "#!/usr/bin/env bun\nmodule.exports = require('./nested.js') + 1;\n",
        "main.js": `
          const { compiled } = require("./hook.js");
          const result = require("./out/bundled.cjs");
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), result }));
        `,
      });
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--outfile=out/bundled.cjs", "src.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).toBe("");
      expect(buildExit).toBe(0);
      const bundled = await Bun.file(`${dir}/out/bundled.cjs`).text();
      expect(bundled.startsWith("#!/usr/bin/env bun\n// @bun @bun-cjs\n(function(")).toBe(true);
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["bundled.cjs"], result: 101 });
    });

    test("a bundle with a block comment footer reaches the hook as its body", async () => {
      using dir = tempDir("module-prototype-compile-footer", {
        ...files,
        "src.js": "module.exports = require('./nested.js') + 1;\n",
        "main.js": `
          const { compiled } = require("./hook.js");
          const result = require("./out/bundled.cjs");
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), result }));
        `,
      });
      await using build = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--target=bun",
          "--format=cjs",
          "--footer=/* (c) ACME\n two lines */",
          "--outfile=out/bundled.cjs",
          "src.js",
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).toBe("");
      expect(buildExit).toBe(0);
      expect((await Bun.file(`${dir}/out/bundled.cjs`).text()).trimEnd().endsWith("two lines */")).toBe(true);
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["bundled.cjs"], result: 101 });
    });

    test("an imported CommonJS file fetched around the install of a hook gets the overridden wrapper once", async () => {
      using dir = tempDir("module-prototype-compile-window", {
        "wrapper.cjs": `
          const Module = require("node:module");
          const [start, end] = Module.wrapper;
          Module.wrapper = [start + "globalThis.prefixRuns = (globalThis.prefixRuns ?? 0) + 1;", end];
        `,
        "setup.cjs": `
          const Module = require("node:module");
          const orig = Module.prototype._compile;
          globalThis.hooked = [];
          Module.prototype._compile = function (content, filename) {
            globalThis.hooked.push(require("path").basename(filename));
            return orig.call(this, content, filename);
          };
        `,
        "app.cjs": "module.exports = 42;\n",
        "main.mjs": `
          import "./setup.cjs";
          import app from "./app.cjs";
          console.log(JSON.stringify({ app, hooked: globalThis.hooked, prefixRuns: globalThis.prefixRuns }));
        `,
      });
      // The loader links the two CommonJS files in the order their fetches finish, so the hook
      // is installed before or after app.cjs is fetched. Either way the wrapper runs once per file.
      const { hooked, ...rest } = await run(dir, ["--preload", "./wrapper.cjs", "main.mjs"]);
      expect(rest).toEqual({ app: 42, prefixRuns: 2 });
      expect([[], ["app.cjs"]]).toContainEqual(hooked);
    });

    test("bun test --isolate runs a require.extensions hook with an own _compile for every file", async () => {
      using dir = tempDir("module-prototype-compile-isolate-own", {
        ...files,
        "pirates.js": `
          const Module = require("node:module");
          const ext = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            const compile = module._compile;
            module._compile = (content, filename) => compile.call(module, content.replace("= 1;", "= 100;"), filename);
            return ext.call(this, module, filename);
          };
        `,
        "a.test.js": `require("./pirates.js"); test("a", () => expect(require("./target.js")()).toBe(101));`,
        "b.test.js": `require("./pirates.js"); test("b", () => expect(require("./target.js")()).toBe(101));`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "a.test.js", "b.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 2 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });

    test("an overridden Module.wrapper runs once around the body the hook hands back", async () => {
      using dir = tempDir("module-prototype-compile-wrapper", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const { compiled } = require("./hook.js");
          const [start, end] = Module.wrapper;
          Module.wrapper = [start + "globalThis.prefixRuns = (globalThis.prefixRuns ?? 0) + 1;", end];
          const result = require("./target.js")();
          console.log(JSON.stringify({ compiled: compiled.map(c => c.file), result, prefixRuns: globalThis.prefixRuns }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ compiled: ["target.js", "nested.js"], result: 101, prefixRuns: 2 });
    });

    test("a require() cycle through a self-evaluating hook sees the partial exports", async () => {
      using dir = tempDir("module-prototype-compile-cycle", {
        "self.cjs": "exports.a = 1; require('./esm.mjs'); exports.b = 2;",
        "esm.mjs": "import s from './self.cjs'; globalThis.partial = JSON.stringify(s);",
        "main.js": `
          const Module = require("node:module");
          const vm = require("node:vm");
          Module.prototype._compile = function (content, filename) {
            const fn = vm.runInThisContext(Module.wrap(content), { filename });
            fn.call(this.exports, this.exports, this.require.bind(this), this, filename, require("path").dirname(filename));
          };
          const final = require("./self.cjs");
          console.log(JSON.stringify({ partial: JSON.parse(globalThis.partial), final }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ partial: { a: 1 }, final: { a: 1, b: 2 } });
    });

    test("Object.defineProperty and delete on Module.prototype._compile are honored", async () => {
      using dir = tempDir("module-prototype-compile-define", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const orig = Module.prototype._compile;
          let defined = 0;
          Object.defineProperty(Module.prototype, "_compile", {
            value(content, filename) { defined++; return orig.call(this, content, filename); },
            writable: true,
            configurable: true,
          });
          const first = require("./nested.js");
          delete Module.prototype._compile;
          delete require.cache[require.resolve("./nested.js")];
          let deletedError;
          try { require("./nested.js"); } catch (e) { deletedError = e.message; }
          Module.prototype._compile = orig;
          delete require.cache[require.resolve("./nested.js")];
          const restored = require("./nested.js");
          console.log(JSON.stringify({ defined, first, deletedError, restored }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({
        defined: 1,
        first: 1,
        deletedError: "module._compile is not a function",
        restored: 1,
      });
    });

    test("Module.prototype survives a copied accessor, an index property, a freeze and an unwrap", async () => {
      using dir = tempDir("module-prototype-compile-shape", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const orig = Module.prototype._compile;
          const fresh = () => { delete require.cache[require.resolve("./nested.js")]; return require("./nested.js"); };
          Object.defineProperty(Module.prototype, "_compile", Object.getOwnPropertyDescriptor(Module.prototype, "_compile"));
          const copiedAccessor = fresh();
          Object.defineProperty(Module.prototype, "0", { value: 1 });
          const indexed = fresh();
          const [start, end] = Module.wrapper;
          Module.wrapper = [start + "globalThis.prefixRuns = (globalThis.prefixRuns ?? 0) + 1;", end];
          Module.prototype._compile = function (c, f) { return orig.call(this, c, f); };
          Object.defineProperty(Module.prototype, "_compile", { value: orig, writable: true, configurable: true });
          const unwrapped = fresh();
          const fake = Object.create(Module.prototype);
          fake.filename = "/x.js";
          Object.freeze(Module.prototype);
          const frozen = fresh();
          console.log(JSON.stringify({ copiedAccessor, indexed, unwrapped, prefixRuns: globalThis.prefixRuns, fakeFilename: fake.filename, frozen }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({
        copiedAccessor: 1,
        indexed: 1,
        unwrapped: 1,
        prefixRuns: 2,
        fakeFilename: "/x.js",
        frozen: 1,
      });
    });

    test("module.require assigned on one module does not replace require() elsewhere", async () => {
      using dir = tempDir("module-prototype-compile-require", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const protoRequire = Module.prototype.require;
          const m = new Module("x");
          m.require = () => "own";
          console.log(JSON.stringify({
            own: m.require("anything"),
            ownProperty: Object.hasOwn(m, "require"),
            protoUnchanged: Module.prototype.require === protoRequire,
            nested: require("./nested.js"),
          }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ own: "own", ownProperty: true, protoUnchanged: true, nested: 1 });
    });

    test("installing a hook is refused when code generation from strings is disallowed", async () => {
      using dir = tempDir("module-prototype-compile-nocodegen", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const orig = Module.prototype._compile;
          let message;
          try { Module.prototype._compile = function (c, f) { return orig.call(this, c, f); }; } catch (e) { message = e.message; }
          Module.prototype._compile = orig;
          console.log(JSON.stringify({ message, nested: require("./nested.js") }));
        `,
      });
      expect(await run(dir, ["--disallow-code-generation-from-strings=strict", "main.js"])).toEqual({
        message: "Code generation from strings disallowed for this context",
        nested: 1,
      });
    });

    test("a module with no filename handed to Module._extensions gives its hook the file's name", async () => {
      using dir = tempDir("module-prototype-compile-extension-filename", {
        ...files,
        "main.js": `
          const Module = require("node:module");
          const path = require("path");
          const m = new Module("x");
          let seen;
          m._compile = function (content, filename) { seen = filename; return Module.prototype._compile.call(this, content, filename); };
          Module._extensions[".js"](m, path.join(__dirname, "nested.js"));
          console.log(JSON.stringify({ seen: path.basename(seen), exports: m.exports }));
        `,
      });
      expect(await run(dir, ["main.js"])).toEqual({ seen: "nested.js", exports: 1 });
    });

    test("Module.prototype is the prototype of module objects", () => {
      const id = require.resolve("./extensions-fixture/d.js");
      const wasCached = id in require.cache;
      require(id);
      const entry = require.cache[id];
      if (!wasCached) delete require.cache[id];
      expect(Object.getPrototypeOf(entry)).toBe(Module.prototype);
      expect(entry instanceof Module).toBe(true);
      expect(new Module("x") instanceof Module).toBe(true);
      expect(Module.prototype.constructor).toBe(Module);
      expect(Object.getOwnPropertyDescriptor(Module.prototype, "constructor").enumerable).toBe(false);
      expect(typeof Module.prototype._compile).toBe("function");
      expect(typeof Module.prototype.require).toBe("function");
      expect(new Module("x")._compile).toBe(Module.prototype._compile);
    });
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
