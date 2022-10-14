import { it, expect } from "bun:test";
import * as Module from "node:module";
import sync from "./require-json.json";

const { path, dir } = import.meta;

it("import.meta.resolveSync", () => {
  expect(
    import.meta.resolveSync("./" + import.meta.file, import.meta.path)
  ).toBe(path);
  const require = Module.createRequire(import.meta.path);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);

  // check it works with URL objects
  expect(
    Module.createRequire(new URL(import.meta.url)).resolve(import.meta.path)
  ).toBe(import.meta.path);
});

it("import.meta.require (json)", () => {
  expect(import.meta.require("./require-json.json").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-json.json").hello).toBe(sync.hello);
});

it("Module.createRequire().resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.path);
  const result = createdRequire.resolve("./require-json.json");

  expect(result).toBe(expected);
});

// this is stubbed out
it("Module._nodeModulePaths()", () => {
  const expected = Module._nodeModulePaths();
  expect(!!expected).toBe(true);
});

// this isn't used in bun but exists anyway
// we just want it to not be undefined
it("Module._cache", () => {
  const expected = typeof Module._cache === "object" && Module._cache;
  expect(!!expected).toBe(true);
});

it("Module._resolveFileName()", () => {
  const expected = Bun.resolveSync(import.meta.path, "/");
  const result = Module._resolveFileName(import.meta.path, "/", true);
  expect(result).toBe(expected);
});

it("Module.createRequire(file://url).resolve(file://url)", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.url);
  const result1 = createdRequire.resolve("./require-json.json");
  const result2 = createdRequire.resolve("file://./require-json.json");

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
  var ReExportDynamic = require(`./import.live.${"rexport"
    .split("")
    .join("")}.js`);

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
  expect(dir.endsWith("/bun/test/bun.js")).toBe(true);
});

it("import.meta.path", () => {
  expect(path.endsWith("/bun/test/bun.js/import-meta.test.js")).toBe(true);
});

it('require("bun") works', () => {
  expect(require("bun")).toBe(Bun);
});

it('import("bun") works', async () => {
  expect(await import("bun")).toBe(Bun);
});
