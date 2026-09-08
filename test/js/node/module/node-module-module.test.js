import "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, ospath, tempDir } from "harness";
import Module, { _nodeModulePaths, builtinModules, createRequire, findPackageJSON, isBuiltin, wrap } from "module";
import path from "path";
import { pathToFileURL } from "url";
// The fixtures Node.js uses for findPackageJSON in test/parallel/test-find-package-json.js:
// each sub-package's index exports findPackageJSON("..", <its own location>).
import nestedCjsPackageJSON from "../test/fixtures/packages/nested/sub-pkg-cjs/index.js";
import nestedEsmPackageJSON from "../test/fixtures/packages/nested/sub-pkg-esm/index.js";

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

  test("findPackageJSON resolves an ESM package import", async () => {
    using dir = tempDir("find-package-json", {
      "entry.mjs": `import { findPackageJSON } from "node:module";
console.log(findPackageJSON("pkg", import.meta.url));
console.log(findPackageJSON(import.meta.resolve("pkg")));`,
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./index.js" }),
      "node_modules/pkg/index.js": "export {};",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
      "<dir>/node_modules/pkg/package.json
      <dir>/node_modules/pkg/package.json"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  describe("findPackageJSON", () => {
    // <root>/package.json
    // <root>/node_modules/{dep (shadowed), hoisted}
    // <root>/app/package.json            (has "exports", so it can self-reference)
    // <root>/app/src/index.js            (the `base` used by most cases)
    // <root>/app/nested/package.json     (a nested scope without a "name")
    // <root>/app/node_modules/...        (the packages under test)
    function fixture() {
      const dir = tempDir("find-package-json", {
        "package.json": JSON.stringify({ name: "root" }),
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", shadowed: true }),
        "node_modules/hoisted/package.json": JSON.stringify({ name: "hoisted" }),
        "app/package.json": JSON.stringify({ name: "app", exports: "./src/index.js" }),
        "app/src/index.js": "",
        "app/src/lib/util.js": "",
        "app/nested/package.json": JSON.stringify({ type: "module" }),
        "app/nested/mod.js": "",
        "app/node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./lib/entry.js" }),
        "app/node_modules/dep/lib/package.json": JSON.stringify({ type: "commonjs" }),
        "app/node_modules/dep/lib/entry.js": "",
        "app/node_modules/@scope/types-only/package.json": JSON.stringify({
          name: "@scope/types-only",
          types: "./index.d.ts",
        }),
        "app/node_modules/@scope/types-only/index.d.ts": "",
        "app/node_modules/exports-only/package.json": JSON.stringify({
          name: "exports-only",
          exports: { "./sub": "./sub.js" },
        }),
        "app/node_modules/exports-only/sub.js": "",
        "app/node_modules/no-manifest/index.js": "",
        "app/node_modules/broken/package.json": '{"name":',
        "app/node_modules/broken/lib/index.js": "",
        "app/node_modules/loose.js": "",
        // Directories that exist but are not valid package names.
        "app/node_modules/.hidden/package.json": JSON.stringify({ name: ".hidden" }),
        "app/node_modules/%41/package.json": JSON.stringify({ name: "%41" }),
        // A scope whose "exports" has the wrong type cannot self-reference.
        "app/exports-invalid/package.json": JSON.stringify({ name: "exports-invalid", exports: true }),
        "app/exports-invalid/index.js": "",
      });
      const p = (...segments) => path.join(String(dir), ...segments);
      return { p, base: p("app", "src", "index.js"), [Symbol.dispose]: () => dir[Symbol.dispose]() };
    }

    test("bare specifier returns the package's root package.json without resolving its entry point", () => {
      using fx = fixture();
      const { p, base } = fx;
      const dep = p("app", "node_modules", "dep", "package.json");
      expect({
        nearest: findPackageJSON("dep", base),
        subpath: findPackageJSON("dep/lib/entry.js", base),
        typesOnly: findPackageJSON("@scope/types-only", base),
        exportsOnly: findPackageJSON("exports-only", base),
        exportsOnlySubpath: findPackageJSON("exports-only/sub", base),
        hoisted: findPackageJSON("hoisted", base),
        selfReference: findPackageJSON("app", base),
        packageWithoutManifest: findPackageJSON("no-manifest", base),
        // Like import(), a query string is not part of the name.
        withQuery: findPackageJSON("dep?v=1", base),
      }).toEqual({
        nearest: dep,
        subpath: dep,
        typesOnly: p("app", "node_modules", "@scope", "types-only", "package.json"),
        exportsOnly: p("app", "node_modules", "exports-only", "package.json"),
        exportsOnlySubpath: p("app", "node_modules", "exports-only", "package.json"),
        hoisted: p("node_modules", "hoisted", "package.json"),
        selfReference: p("app", "package.json"),
        packageWithoutManifest: undefined,
        withQuery: dep,
      });
    });

    test("a self-reference needs the nearest scope to have the name and a usable exports field", () => {
      using fx = fixture();
      const { p } = fx;
      const notFound = expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" });
      // The nearest scope of app/nested/mod.js is the nameless app/nested/package.json.
      expect(() => findPackageJSON("app", p("app", "nested", "mod.js"))).toThrow(notFound);
      // root/package.json has no "exports".
      expect(() => findPackageJSON("root", p("index.js"))).toThrow(notFound);
      // "exports": true is not an exports map.
      expect(() => findPackageJSON("exports-invalid", p("app", "exports-invalid", "index.js"))).toThrow(notFound);
    });

    test("invalid package names throw even when a directory of that name exists", () => {
      using fx = fixture();
      const { base } = fx;
      const notFound = expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" });
      expect(() => findPackageJSON(".hidden", base)).toThrow(notFound);
      expect(() => findPackageJSON("%41", base)).toThrow(notFound);
      // Not a subpath separator: it would otherwise name dep/lib/package.json.
      expect(() => findPackageJSON("dep\\lib", base)).toThrow(notFound);
      expect(() => findPackageJSON("dep\0", base)).toThrow(notFound);
    });

    test("a path or file URL returns the closest package.json", () => {
      using fx = fixture();
      const { p, base } = fx;
      // dep's entry point lives in a nested scope, so unlike the bare specifier
      // form (which returns dep's root package.json) the resolved entry point,
      // e.g. from import.meta.resolve("dep"), belongs to dep/lib/package.json.
      const entry = p("app", "node_modules", "dep", "lib", "entry.js");
      const scopeOfEntry = p("app", "node_modules", "dep", "lib", "package.json");
      expect({
        relativeFile: findPackageJSON("./lib/util.js", base),
        relativeFileWithQuery: findPackageJSON("./lib/util.js?v=1", base),
        relativeFileInNestedScope: findPackageJSON("../nested/mod.js", base),
        absolutePath: findPackageJSON(entry),
        absolutePathIgnoresBase: findPackageJSON(entry, base),
        fileURLString: findPackageJSON(pathToFileURL(entry).href),
        fileURLObject: findPackageJSON(pathToFileURL(entry)),
        packageJSONItself: findPackageJSON(p("app", "package.json")),
      }).toEqual({
        relativeFile: p("app", "package.json"),
        relativeFileWithQuery: p("app", "package.json"),
        relativeFileInNestedScope: p("app", "nested", "package.json"),
        absolutePath: scopeOfEntry,
        absolutePathIgnoresBase: scopeOfEntry,
        fileURLString: scopeOfEntry,
        fileURLObject: scopeOfEntry,
        packageJSONItself: p("app", "package.json"),
      });
    });

    test("a directory returns its own package.json, or the closest one above it", () => {
      using fx = fixture();
      const { p, base } = fx;
      expect({
        parent: findPackageJSON("..", base),
        parentWithSlash: findPackageJSON("../", base),
        currentDirectoryWithoutPackageJSON: findPackageJSON(".", base),
        currentDirectoryWithPackageJSON: findPackageJSON(".", p("app", "nested", "mod.js")),
        absoluteDirectory: findPackageJSON(p("app")),
        absoluteDirectoryWithSlash: findPackageJSON(p("app", "nested") + path.sep),
      }).toEqual({
        parent: p("app", "package.json"),
        parentWithSlash: p("app", "package.json"),
        currentDirectoryWithoutPackageJSON: p("app", "package.json"),
        currentDirectoryWithPackageJSON: p("app", "nested", "package.json"),
        absoluteDirectory: p("app", "package.json"),
        absoluteDirectoryWithSlash: p("app", "nested", "package.json"),
      });
    });

    // Like Node, this only locates the file; whether it parses is the caller's problem.
    test("a package.json that does not parse is still found", () => {
      using fx = fixture();
      const { p, base } = fx;
      const broken = p("app", "node_modules", "broken", "package.json");
      expect({
        bare: findPackageJSON("broken", base),
        fileInsideIt: findPackageJSON(p("app", "node_modules", "broken", "lib", "index.js")),
        directory: findPackageJSON(p("app", "node_modules", "broken")),
      }).toEqual({ bare: broken, fileInsideIt: broken, directory: broken });
    });

    test("the search never crosses a node_modules directory", () => {
      using fx = fixture();
      const { p } = fx;
      expect({
        fileDirectlyInNodeModules: findPackageJSON(p("app", "node_modules", "loose.js")),
        fileInPackageWithoutManifest: findPackageJSON(p("app", "node_modules", "no-manifest", "index.js")),
      }).toEqual({
        fileDirectlyInNodeModules: undefined,
        fileInPackageWithoutManifest: undefined,
      });
    });

    test("base may be a path, a file URL string or a URL object; only its directory matters", () => {
      using fx = fixture();
      const { p, base } = fx;
      const expected = p("app", "node_modules", "dep", "package.json");
      expect({
        path: findPackageJSON("dep", base),
        fileURLString: findPackageJSON("dep", pathToFileURL(base).href),
        fileURLObject: findPackageJSON("dep", pathToFileURL(base)),
        upperCaseFileURLString: findPackageJSON("dep", pathToFileURL(base).href.replace("file:", "FILE:")),
        // `import.meta.url` of a module that was never written to disk.
        nonExistentSibling: findPackageJSON("dep", p("app", "src", "whatever.ext")),
        relativeToNonExistentSibling: findPackageJSON("./lib/util.js", p("app", "src", "whatever.ext")),
      }).toEqual({
        path: expected,
        fileURLString: expected,
        fileURLObject: expected,
        upperCaseFileURLString: expected,
        nonExistentSibling: expected,
        relativeToNonExistentSibling: p("app", "package.json"),
      });
    });

    test("a base with a trailing separator is the directory itself", () => {
      using fx = fixture();
      const { p } = fx;
      const src = p("app", "src") + path.sep;
      const nested = p("app", "nested") + path.sep;
      expect({
        relativeFromDirectory: findPackageJSON("./lib/util.js", src),
        bareFromDirectory: findPackageJSON("dep", src),
        directoryItself: findPackageJSON(".", nested),
        // A forward slash is a separator on Windows too.
        directoryItselfForwardSlash: findPackageJSON(".", p("app", "nested") + "/"),
        directoryItselfFromFileURLString: findPackageJSON(".", pathToFileURL(nested).href),
        directoryItselfFromFileURLObject: findPackageJSON(".", pathToFileURL(nested)),
        parentOfDirectory: findPackageJSON("..", nested),
      }).toEqual({
        relativeFromDirectory: p("app", "package.json"),
        bareFromDirectory: p("app", "node_modules", "dep", "package.json"),
        directoryItself: p("app", "nested", "package.json"),
        directoryItselfForwardSlash: p("app", "nested", "package.json"),
        directoryItselfFromFileURLString: p("app", "nested", "package.json"),
        directoryItselfFromFileURLObject: p("app", "nested", "package.json"),
        parentOfDirectory: p("app", "package.json"),
      });
    });

    test("a base must be an absolute path or a file URL, like Node.js", () => {
      const invalidURL = input => expect.objectContaining({ code: "ERR_INVALID_URL", message: "Invalid URL", input });
      for (const base of ["", ".", "./", "..", "src/index.js", "./src/index.js", "index.js"]) {
        expect(() => findPackageJSON("dep", base)).toThrow(invalidURL(base));
      }
    });

    test("without a base, specifiers are resolved from the current working directory", async () => {
      using fx = fixture();
      const { p } = fx;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { findPackageJSON } = require("node:module");
           console.log(JSON.stringify([findPackageJSON("dep"), findPackageJSON("./lib/util.js"), findPackageJSON("..")]));`,
        ],
        cwd: p("app", "src"),
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        p("app", "node_modules", "dep", "package.json"),
        p("app", "package.json"),
        p("app", "package.json"),
      ]);
      expect(exitCode).toBe(0);
    });

    test("throws ERR_MODULE_NOT_FOUND when the specifier does not resolve", () => {
      using fx = fixture();
      const { p, base } = fx;
      const notFound = message => expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND", message });
      expect(() => findPackageJSON("missing", base)).toThrow(
        notFound(`Cannot find package 'missing' imported from ${base}`),
      );
      expect(() => findPackageJSON("@scope/missing/sub.js", base)).toThrow(
        notFound(`Cannot find package '@scope/missing' imported from ${base}`),
      );
      // Like Node, the message names the path that was looked for.
      expect(() => findPackageJSON("./missing.js", base)).toThrow(
        notFound(`Cannot find module '${p("app", "src", "missing.js")}' imported from ${base}`),
      );
      // The trailing separator survives the join on POSIX only.
      expect(() => findPackageJSON("../missing/", base)).toThrow(
        notFound(expect.stringContaining(`Cannot find module '${p("app", "missing")}`)),
      );
      expect(() => findPackageJSON(p("missing", "index.js"))).toThrow(
        notFound(expect.stringContaining(`Cannot find module '${p("missing", "index.js")}'`)),
      );
      expect(() => findPackageJSON("./index\0.js", base)).toThrow(
        notFound(expect.stringContaining("Cannot find module")),
      );
      expect(() => findPackageJSON("dep", p("x\0y", "index.js"))).toThrow(
        notFound(expect.stringContaining("Cannot find package 'dep'")),
      );
      expect(() => findPackageJSON("root", base)).toThrow(notFound(`Cannot find package 'root' imported from ${base}`));
    });

    test("crawls up from a module's own location (Node.js fixtures)", () => {
      const nested = path.join(import.meta.dir, "..", "test", "fixtures", "packages", "nested", "package.json");
      expect({ cjs: nestedCjsPackageJSON, esm: nestedEsmPackageJSON }).toEqual({ cjs: nested, esm: nested });
    });

    test("validates its arguments", () => {
      expect(findPackageJSON).toHaveLength(1);
      expect(() => findPackageJSON()).toThrow(expect.objectContaining({ code: "ERR_MISSING_ARGS" }));
      for (const invalid of [null, {}, [], Symbol(), () => {}, true, false, 1, 0]) {
        expect(() => findPackageJSON("", invalid)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
      }
      // Node stringifies the specifier, so a number is looked up as a package
      // name; only a symbol, which cannot be stringified, is rejected up front.
      expect(() => findPackageJSON(123, import.meta.path)).toThrow(
        expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND", message: expect.stringContaining("'123'") }),
      );
      expect(() => findPackageJSON(Symbol("pkg"), import.meta.path)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: 'The "specifier" argument must be of type string. Received type symbol (Symbol(pkg))',
        }),
      );
      const unstringifiable = {
        toString() {
          throw new Error("not this one");
        },
      };
      expect(() => findPackageJSON(unstringifiable, import.meta.path)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      // URLs go through the same checks as fileURLToPath(), in either position,
      // instead of being treated as a path or a package name. Node's codes
      // differ for some of these malformed inputs.
      const invalidURL = expect.objectContaining({
        code: "ERR_INVALID_URL",
        message: "Invalid URL",
        input: "file://[",
      });
      expect(() => findPackageJSON("file://[", import.meta.path)).toThrow(invalidURL);
      expect(() => findPackageJSON("dep", "file://[")).toThrow(invalidURL);
      const notFile = expect.objectContaining({
        code: "ERR_INVALID_URL_SCHEME",
        message: "The URL must be of scheme file",
      });
      expect(() => findPackageJSON("dep", new URL("https://example.com/app.js"))).toThrow(notFile);
      expect(() => findPackageJSON("dep", "https://example.com/app.js")).toThrow(notFile);
      expect(() => findPackageJSON("node:fs", import.meta.path)).toThrow(notFile);
      expect(() => findPackageJSON("data:text/javascript,export{}")).toThrow(notFile);
      // A URL object is a URL even when, as a string, "x:" would be read as a
      // (Windows drive letter style) path.
      expect(() => findPackageJSON("dep", new URL("x:y"))).toThrow(notFile);
      expect(() => findPackageJSON(new URL("x:y"), import.meta.path)).toThrow(notFile);
      const encodedSeparator = pathToFileURL(import.meta.path).href.replace(/\/([^/]+)$/, "%2F$1");
      expect(() => findPackageJSON(encodedSeparator)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_FILE_URL_PATH" }),
      );
      expect(() => findPackageJSON("dep", encodedSeparator)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_FILE_URL_PATH" }),
      );
      if (!isWindows) {
        // On Windows a host makes a UNC path; elsewhere only "localhost" is allowed.
        const withHost = pathToFileURL(import.meta.path).href.replace("file://", "file://somehost");
        expect(() => findPackageJSON("dep", withHost)).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_FILE_URL_HOST" }),
        );
        expect(() => findPackageJSON(withHost)).toThrow(expect.objectContaining({ code: "ERR_INVALID_FILE_URL_HOST" }));
        const withLocalhost = pathToFileURL(import.meta.path).href.replace("file://", "file://localhost");
        expect(findPackageJSON(withLocalhost)).toBe(path.resolve(import.meta.dir, "..", "..", "..", "package.json"));
      }
      // Longer than any path the OS accepts (including Windows' ~96 KiB limit).
      const tooLong = path.join(import.meta.dir, Buffer.alloc(100_000, "a").toString());
      expect(() => findPackageJSON("dep", tooLong)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
      expect(() => findPackageJSON("./x.js", tooLong)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    });

    // Compiled executables do not load package.json files for resolution, but
    // findPackageJSON() is about the files on disk and must still find them.
    test("works in a compiled executable", async () => {
      using dir = tempDir("find-package-json-compiled", {
        "entry.js": `
            import { findPackageJSON } from "node:module";
            import path from "node:path";
            const app = path.join(process.cwd(), "src", "app.js");
            console.log(JSON.stringify([findPackageJSON("dep", app), findPackageJSON(app)]));
          `,
        "package.json": JSON.stringify({ name: "app" }),
        "src/app.js": "",
        "node_modules/dep/package.json": JSON.stringify({ name: "dep" }),
      });
      const exe = path.join(String(dir), isWindows ? "app.exe" : "app");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.js"), "--outfile", exe],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect({ buildStdout, buildStderr, buildExitCode }).toEqual({
        buildStdout: expect.stringContaining("compile"),
        buildStderr: expect.not.stringContaining("error:"),
        buildExitCode: 0,
      });

      await using proc = Bun.spawn({ cmd: [exe], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        path.join(String(dir), "node_modules", "dep", "package.json"),
        path.join(String(dir), "package.json"),
      ]);
      expect(exitCode).toBe(0);
    }, 60_000); // Compiling copies the whole runtime, which takes a while in debug builds.

    test("oversized specifiers throw ERR_MODULE_NOT_FOUND", () => {
      const notFound = expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" });
      const tooLong = Buffer.alloc(100_000, "a").toString();
      expect(() => findPackageJSON(tooLong, import.meta.path)).toThrow(notFound);
      expect(() => findPackageJSON("./" + tooLong, import.meta.path)).toThrow(notFound);
      expect(() => findPackageJSON(path.join(import.meta.dir, tooLong))).toThrow(notFound);
    });
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
