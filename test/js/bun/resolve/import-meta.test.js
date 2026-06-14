import { spawnSync } from "bun";
import { isModuleResolveFilenameSlowPathEnabled } from "bun:internal-for-testing";
import { expect, it, mock } from "bun:test";
import { bunEnv, bunExe, ospath, tempDir } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import sync from "./require-json.json";

const { path, dir, dirname, filename } = import.meta;

const tmpbase = tmpdir() + sep;

it("import.meta.require is settable", () => {
  const old = import.meta.require;
  const fn = mock(() => "hello");
  import.meta.require = fn;
  expect(import.meta.require("hello")).toBe("hello");
  import.meta.require = old;
  expect(fn).toHaveBeenCalledTimes(1);
});

it("import.meta.main", () => {
  const { exitCode } = spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "./main-test-script.js")],
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
    stdin: null,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.resolveSync", () => {
  expect(import.meta.resolveSync("./" + import.meta.file, import.meta.path)).toBe(path);
});

it("Module.createRequire", () => {
  const require = Module.createRequire(import.meta.path);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);

  // check it works with URL objects
  expect(Module.createRequire(new URL(import.meta.url)).resolve(import.meta.path)).toBe(import.meta.path);
});

it("Module.createRequire works with a file url", () => {
  const require = Module.createRequire(import.meta.url);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);
});

it("Module.createRequire works with a file url with a space", () => {
  const path = join(import.meta.dir, "with space/hello.js");
  const require = Module.createRequire(new URL("./with space/nonexist.js", import.meta.url).toString());
  expect(require.resolve(import.meta.path)).toBe(import.meta.path);
  expect(require.resolve("./hello")).toBe(path);
  const { resolve } = require;
  expect(resolve("./hello")).toBe(path);
});

it("Module.createRequire does not use file url as the referrer (err message check)", () => {
  const require = Module.createRequire(import.meta.url);
  try {
    require("whaaat");
    expect.unreachable();
  } catch (e) {
    expect(e.name).not.toBe("UnreachableError");
    expect(e.message).not.toInclude("file:///");
    expect(e.message).toInclude(`'whaaat'`);
    expect(e.message).toInclude(`'` + import.meta.path + `'`);
  }
});

it("require with a query string works on dynamically created content", () => {
  rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
    recursive: true,
    force: true,
  });
  try {
    const require = Module.createRequire(tmpbase + "bun-test-import-meta-dynamic-dir/foo.js");
    try {
      require("./bar.js?query=123.js");
    } catch (e) {
      expect(e.name).toBe("ResolveMessage");
    }

    mkdirSync(tmpbase + "bun-test-import-meta-dynamic-dir", { recursive: true });

    writeFileSync(tmpbase + "bun-test-import-meta-dynamic-dir/bar.js", "export default 'hello';", "utf8");

    expect(require("./bar.js?query=123.js").default).toBe("hello");
  } catch (e) {
    throw e;
  } finally {
    rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
      recursive: true,
      force: true,
    });
  }
});

it("import.meta.require (json)", () => {
  expect(import.meta.require("./require-json.json").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-json").hello).toBe(sync.hello);
});

it("const f = require;require(json)", () => {
  function capture(f) {
    return f.length;
  }
  const f = require;
  capture(f);
  expect(f("./require-json.json").hello).toBe(sync.hello);
});

it("Module.createRequire().resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.path);
  const result = createdRequire.resolve("./require-json.json");

  expect(result).toBe(expected);
});

// this isn't used in bun but exists anyway
// we just want it to not be undefined
it("Module._cache", () => {
  const expected = typeof Module._cache === "object" && Module._cache;
  expect(!!expected).toBe(true);
});

it("Module._resolveFilename()", () => {
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
  const original = Module._resolveFilename;
  Module._resolveFilename = () => {};
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(true);
  Module._resolveFilename = original;
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
});

it("Module.createRequire(file://url).resolve(file://url)", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.url);
  const result1 = createdRequire.resolve("./require-json.json");
  const result2 = createdRequire.resolve(`file://${expected}`);
  expect(result1).toBe(expected);
  expect(result2).toBe(expected);
});

it("import.meta.require.resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);
  var { resolve } = import.meta.require;
  const result = resolve("./require-json.json");
  expect(result).toBe(expected);
});

it("import.meta.require (javascript)", () => {
  expect(import.meta.require("./require-js.js").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-js.js").hello).toBe(sync.hello);
});

it("import() require + TLA", async () => {
  expect((await import("./import-require-tla.js")).foo).toBe("bar");
});

it("import.meta.require (javascript, live bindings)", () => {
  var Source = import.meta.require("./import.live.decl.js");

  // require transpiles to import.meta.require
  var ReExport = require("./import.live.rexport.js");

  // dynamic require (string interpolation that way forces it to be dynamic)
  var ReExportDynamic = require(`./import.live.${"rexport".split("").join("")}.js`);

  expect(Source.foo).toBe(1);
  Source.setFoo(Source.foo + 1);

  expect(ReExport.foo).toBe(2);
  expect(Source.foo).toBe(2);
  expect(ReExportDynamic.foo).toBe(2);

  Source.setFoo(Source.foo + 1);

  var { Namespace } = require("./import.live.rexport-require.js");

  expect(Namespace).toBe(Source);
  expect(ReExport.foo).toBe(3);
  expect(Source.foo).toBe(3);
  expect(Namespace.foo).toBe(3);

  ReExport.setFoo(ReExport.foo + 1);

  expect(ReExport.foo).toBe(4);
  expect(Source.foo).toBe(4);
  expect(Namespace.foo).toBe(4);
});

it("import.meta.dir", () => {
  expect(dir).toEndWith(ospath("/test/js/bun/resolve"));
});

it("import.meta.dirname", () => {
  expect(dirname).toBe(dir);
});

it("import.meta.filename", () => {
  expect(filename).toBe(import.meta.path);
});

it("import.meta.path", () => {
  expect(path).toEndWith(ospath("/test/js/bun/resolve/import-meta.test.js"));
});

// https://github.com/oven-sh/bun/issues/32246
it("import.meta members are own, discoverable properties", () => {
  const names = Object.getOwnPropertyNames(import.meta);

  // Node exposes url/dirname/filename/resolve/main as own properties; Bun adds
  // dir/file/path/require/resolveSync/env. Before the fix these lived on a hidden
  // prototype, so getOwnPropertyNames / ownKeys / getOwnPropertyDescriptor missed them.
  for (const key of ["url", "dirname", "filename", "resolve", "main", "dir", "file", "path", "require"]) {
    expect(names).toContain(key);
    expect(key in import.meta).toBe(true);
    expect(Object.getOwnPropertyDescriptor(import.meta, key)).not.toBeUndefined();
  }

  // Reflect.ownKeys agrees with getOwnPropertyNames (no hidden/symbol-only members).
  expect(Reflect.ownKeys(import.meta)).toEqual(names);

  // The Node-compatible members are enumerable (matching Node's Object.keys);
  // the Bun-only extras are discoverable but not enumerable, so they stay out of
  // Object.keys / spread / console.log (e.g. import.meta.env would dump process.env).
  const enumerable = Object.keys(import.meta).sort();
  expect(enumerable).toEqual(["dirname", "filename", "main", "resolve", "url"]);
  for (const extra of ["dir", "file", "path", "require", "resolveSync", "env"]) {
    expect(names).toContain(extra);
    expect(enumerable).not.toContain(extra);
  }

  // The discoverable url resolves to the actual module url.
  expect(import.meta.url).toBe(Object.getOwnPropertyDescriptor(import.meta, "url").get.call(import.meta));
  expect(import.meta.url).toStartWith("file://");

  // import.meta keeps a null prototype, matching Node.
  expect(Object.getPrototypeOf(import.meta)).toBe(null);
});

// https://github.com/oven-sh/bun/issues/32246
it("import.meta is discoverable in a standalone module", async () => {
  using dir = tempDir("import-meta-32246", {
    "mod.mjs": `console.log(
      JSON.stringify({
        names: Object.getOwnPropertyNames(import.meta).sort(),
        ownKeys: Reflect.ownKeys(import.meta).sort(),
        urlDescriptorDefined: Object.getOwnPropertyDescriptor(import.meta, "url") !== undefined,
        prototypeIsNull: Object.getPrototypeOf(import.meta) === null,
      }),
    );`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "mod.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = JSON.parse(stdout);
  expect({ stderr, result }).toEqual({
    stderr: expect.any(String),
    result: {
      names: ["dir", "dirname", "env", "file", "filename", "main", "path", "require", "resolve", "resolveSync", "url"],
      ownKeys: ["dir", "dirname", "env", "file", "filename", "main", "path", "require", "resolve", "resolveSync", "url"],
      urlDescriptorDefined: true,
      prototypeIsNull: true,
    },
  });
  expect(exitCode).toBe(0);
});

it('require("bun") works', () => {
  expect(require("bun")).toBe(Bun);
});

it('import("bun") works', async () => {
  expect(await import("bun")).toBe(Bun);
});

it("require.resolve with empty options object", () => {
  expect(require.resolve(import.meta.path + String(""), {})).toBe(import.meta.path);
});

it("dynamically import bun", async () => {
  expect((await import(eval("'bun'"))).default).toBe(Bun);
});

it("require.resolve error code", () => {
  try {
    require.resolve("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("MODULE_NOT_FOUND");
  }
});

it("import non exist error code", async () => {
  try {
    await import("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
  }
});

it("import non exist error code", async () => {
  try {
    await import("./idontexist");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
  }
});

it("import.meta paths have the correct slash", () => {
  const correct_sep = sep;
  const wrong_sep = correct_sep === "/" ? "\\" : "/";

  expect(import.meta.path).toInclude(correct_sep);
  expect(import.meta.path).not.toInclude(wrong_sep);
  expect(import.meta.dir).toInclude(correct_sep);
  expect(import.meta.dir).not.toInclude(wrong_sep);

  expect(import.meta.file).not.toInclude(sep);
  expect(import.meta.file).not.toInclude(sep);

  expect(import.meta.url).toStartWith("file:///");
  expect(import.meta.url).not.toInclude("\\");
});

it("import.meta is correct in a module that was imported with a query param", async () => {
  const esm = (await import("./other.js?foo=bar")).default;

  expect(esm.url).toBe(new URL("./other.js?foo=bar", import.meta.url).toString());
  expect(esm.path).toBe(join(import.meta.dir, "./other.js"));
  expect(esm.dir).toBe(import.meta.dir);
  expect(esm.file).toBe("other.js");
});

it("import.meta is correct in a module that was required with a query param", async () => {
  const cjs = require("./other-cjs.js?foo=bar").meta;
  expect(cjs.url).toBe(new URL("./other-cjs.js?foo=bar", import.meta.url).toString());
  expect(cjs.path).toBe(join(import.meta.dir, "./other-cjs.js"));
  expect(cjs.dir).toBe(import.meta.dir);
  expect(cjs.file).toBe("other-cjs.js");
});
