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

it("import.meta.main follows a Bun.main override but not an own path property, is readable from a vm context, and is false in workers", async () => {
  using dir = tempDir("import-meta-main", {
    "entry.mjs": `
      import { runInNewContext } from "node:vm";
      import { Worker, isMainThread, parentPort } from "node:worker_threads";
      if (isMainThread) {
        const worker = new Worker(new URL(import.meta.url));
        const fromWorker = new Promise((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        const other = await import("./other.mjs");
        const entryPath = import.meta.path;
        const before = [import.meta.main, other.main()];
        const vmContext = [import.meta, other.meta].map(meta => runInNewContext("meta.main", { meta }));
        Bun.main = other.path;
        const after = [import.meta.main, other.main()];
        // main is computed from the module's own path, so swapping the visible path properties changes nothing.
        Object.defineProperty(import.meta, "path", { value: other.path });
        Object.defineProperty(other.meta, "path", { value: entryPath });
        const ownPath = [import.meta.main, other.main()];
        console.log(JSON.stringify({ before, vmContext, after, ownPath, worker: await fromWorker }));
        await worker.terminate();
      } else {
        parentPort.postMessage(import.meta.main);
      }
    `,
    "other.mjs": `
      export const meta = import.meta;
      export const path = import.meta.path;
      export const main = () => import.meta.main;
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({
    before: [true, false],
    vmContext: [true, false],
    after: [false, true],
    ownPath: [false, true],
    worker: false,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.resolveSync", () => {
  expect(import.meta.resolveSync("./" + import.meta.file, import.meta.path)).toBe(path);
});

// https://github.com/oven-sh/bun/issues/41318
it("import.meta.resolve accepts a URL parent and rejects other non-string parents", () => {
  const parent = new URL("./sub/mod.mjs", import.meta.url);
  const underSub = new URL("./sub/sibling.mjs", import.meta.url).href;
  const underHere = new URL("./sibling.mjs", import.meta.url).href;

  expect(import.meta.resolve("./sibling.mjs", parent.href)).toBe(underSub);
  expect(import.meta.resolve("./sibling.mjs", parent)).toBe(underSub);
  expect(import.meta.resolve("./sibling.mjs", { paths: [parent.pathname] })).toBe(underSub);
  expect(import.meta.resolve("./sibling.mjs", undefined)).toBe(underHere);
  expect(import.meta.resolve("./sibling.mjs", null)).toBe(underHere);

  for (const bad of [42, {}, true, Symbol("x")]) {
    expect(() => import.meta.resolve("./sibling.mjs", bad)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "parentURL" argument must be of type string or an instance of URL.'),
      }),
    );
  }
});

it("import.meta.resolveSync accepts a URL parent", () => {
  expect(import.meta.resolveSync("./" + import.meta.file, new URL(import.meta.url))).toBe(path);
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
    expect(e.message).toInclude(import.meta.path);
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
