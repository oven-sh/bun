import { it, expect } from "bun:test";
import { ospath } from "harness";
import { join, resolve } from "path";

function resolveFrom(from) {
  return specifier => import.meta.resolveSync(specifier, from);
}

it("#imports", async () => {
  const baz = await import.meta.resolve("#foo", join(await import.meta.resolve("package-json-imports/baz"), "../"));
  expect(baz).toBe(resolve(import.meta.dir, "node_modules/package-json-imports/foo/private-foo.js"));

  const subpath = await import.meta.resolve(
    "#foo/bar",
    join(await import.meta.resolve("package-json-imports/baz"), "../"),
  );
  expect(subpath).toBe(resolve(import.meta.dir, "node_modules/package-json-imports/foo/private-foo.js"));

  const react = await import.meta.resolve(
    "#internal-react",
    join(await import.meta.resolve("package-json-imports/baz"), "../"),
  );
  expect(react).toBe(resolve(import.meta.dir, "../../../../node_modules/react/index.js"));

  // Check that #foo is not resolved to the package.json file.
  try {
    await import.meta.resolve("#foo");
    throw new Error("Test failed");
  } catch (exception) {
    expect(exception instanceof ResolveMessage).toBe(true);
    expect(exception.referrer).toBe(import.meta.path);
    expect(exception.name).toBe("ResolveMessage");
  }

  // Chcek that package-json-imports/#foo doesn't work
  try {
    await import.meta.resolve("package-json-imports/#foo");
    throw new Error("Test failed");
  } catch (exception) {
    expect(exception instanceof ResolveMessage).toBe(true);
    expect(exception.referrer).toBe(import.meta.path);
    expect(exception.name).toBe("ResolveMessage");
  }
});

it("#imports with wildcard", async () => {
  const run = resolveFrom(resolve(import.meta.dir + "/node_modules/package-json-imports/package.json"));

  const wildcard = resolve(import.meta.dir + "/node_modules/package-json-imports/foo/wildcard.js");
  expect(run("#foo/wildcard.js")).toBe(wildcard);
  expect(run("#foo/extensionless/wildcard")).toBe(wildcard);
});

it("import.meta.resolve", async () => {
  expect(await import.meta.resolve("./resolve-test.js")).toBe(import.meta.path);

  expect(await import.meta.resolve("./resolve-test.js", import.meta.path)).toBe(import.meta.path);

  expect(
    // optional second param can be any path, including a dir
    await import.meta.resolve("./resolve/resolve-test.js", join(import.meta.path, "../")),
  ).toBe(import.meta.path);

  // can be a package path
  expect((await import.meta.resolve("react", import.meta.path)).length > 0).toBe(true);

  // file extensions are optional
  expect(await import.meta.resolve("./resolve-test")).toBe(import.meta.path);

  // works with tsconfig.json "paths"
  expect(await import.meta.resolve("foo/bar")).toBe(join(import.meta.path, "../baz.js"));
  expect(await import.meta.resolve("@faasjs/baz")).toBe(join(import.meta.path, "../baz.js"));
  expect(await import.meta.resolve("@faasjs/bar")).toBe(join(import.meta.path, "../bar/src/index.js"));

  // works with package.json "exports"
  expect(await import.meta.resolve("package-json-exports/baz")).toBe(
    join(import.meta.path, "../node_modules/package-json-exports/foo/bar.js"),
  );

  // if they never exported /package.json, allow reading from it too
  expect(await import.meta.resolve("package-json-exports/package.json")).toBe(
    join(import.meta.path, "../node_modules/package-json-exports/package.json"),
  );

  // if an unnecessary ".js" extension was added, try against /baz
  expect(await import.meta.resolve("package-json-exports/baz.js")).toBe(
    join(import.meta.path, "../node_modules/package-json-exports/foo/bar.js"),
  );

  // works with TypeScript compiler edgecases like:
  // - If the file ends with .js and it doesn't exist, try again with .ts and .tsx
  expect(await import.meta.resolve("./resolve-typescript-file.js")).toBe(
    join(import.meta.path, "../resolve-typescript-file.tsx"),
  );
  expect(await import.meta.resolve("./resolve-typescript-file.tsx")).toBe(
    join(import.meta.path, "../resolve-typescript-file.tsx"),
  );

  // throws a ResolveMessage on failure
  try {
    await import.meta.resolve("THIS FILE DOESNT EXIST");
    throw new Error("Test failed");
  } catch (exception) {
    expect(exception instanceof ResolveMessage).toBe(true);
    expect(exception.referrer).toBe(import.meta.path);
    expect(exception.name).toBe("ResolveMessage");
  }
});

// the slightly lower level API, which doesn't prefill the second param
// and expects a directory instead of a filepath
it("Bun.resolve", async () => {
  expect(await Bun.resolve("./resolve-test.js", import.meta.dir)).toBe(import.meta.path);
});

// synchronous
it("Bun.resolveSync", () => {
  expect(Bun.resolveSync("./resolve-test.js", import.meta.dir)).toBe(import.meta.path);
});

it("self-referencing imports works", async () => {
  const baz = await import.meta.resolve("package-json-exports/baz");
  const namespace = await import.meta.resolve("package-json-exports/references-baz");
  Loader.registry.delete(baz);
  Loader.registry.delete(namespace);
  var a = await import(baz);
  var b = await import(namespace);
  expect(a.bar).toBe(1);
  expect(b.bar).toBe(1);

  Loader.registry.delete(baz);
  Loader.registry.delete(namespace);
  var a = await import("package-json-exports/baz");
  var b = await import("package-json-exports/references-baz");
  expect(a.bar).toBe(1);
  expect(b.bar).toBe(1);

  Loader.registry.delete(baz);
  Loader.registry.delete(namespace);
  var a = import.meta.require("package-json-exports/baz");
  var b = import.meta.require("package-json-exports/references-baz");
  expect(a.bar).toBe(1);
  expect(b.bar).toBe(1);

  Loader.registry.delete(baz);
  Loader.registry.delete(namespace);
  var a = import.meta.require(baz);
  var b = import.meta.require(namespace);
  expect(a.bar).toBe(1);
  expect(b.bar).toBe(1);

  // test that file:// works
  Loader.registry.delete(baz);
  Loader.registry.delete(namespace);
  var a = import.meta.require("file://" + baz);
  var b = import.meta.require("file://" + namespace);
  expect(a.bar).toBe(1);
  expect(b.bar).toBe(1);
});
