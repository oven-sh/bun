import { it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

it("import.meta.resolve", async () => {
  expect(await import.meta.resolve("./resolve.test.js")).toBe(import.meta.path);

  expect(await import.meta.resolve("./resolve.test.js", import.meta.path)).toBe(
    import.meta.path
  );

  expect(
    // optional second param can be any path, including a dir
    await import.meta.resolve(
      "./bun.js/resolve.test.js",
      join(import.meta.path, "../")
    )
  ).toBe(import.meta.path);

  // can be a package path
  expect(
    (await import.meta.resolve("react", import.meta.path)).length > 0
  ).toBe(true);

  // file extensions are optional
  expect(await import.meta.resolve("./resolve.test")).toBe(import.meta.path);

  // works with tsconfig.json "paths"
  expect(await import.meta.resolve("foo/bar")).toBe(
    join(import.meta.path, "../baz.js")
  );

  // works with package.json "exports"
  writePackageJSONExportsFixture();
  expect(await import.meta.resolve("package-json-exports/baz")).toBe(
    join(import.meta.path, "../node_modules/package-json-exports/foo/bar.js")
  );

  // works with TypeScript compiler edgecases like:
  // - If the file ends with .js and it doesn't exist, try again with .ts and .tsx
  expect(await import.meta.resolve("./resolve-typescript-file.js")).toBe(
    join(import.meta.path, "../resolve-typescript-file.tsx")
  );
  expect(await import.meta.resolve("./resolve-typescript-file.tsx")).toBe(
    join(import.meta.path, "../resolve-typescript-file.tsx")
  );

  // throws a ResolveError on failure
  try {
    await import.meta.resolve("THIS FILE DOESNT EXIST");
    throw new Error("Test failed");
  } catch (exception) {
    expect(exception instanceof ResolveError).toBe(true);
    expect(exception.referrer).toBe(import.meta.path);
    expect(exception.name).toBe("ResolveError");
  }
});

// the slightly lower level API, which doesn't prefill the second param
// and expects a directory instead of a filepath
it("Bun.resolve", async () => {
  expect(await Bun.resolve("./resolve.test.js", import.meta.dir)).toBe(
    import.meta.path
  );
});

// synchronous
it("Bun.resolveSync", () => {
  expect(Bun.resolveSync("./resolve.test.js", import.meta.dir)).toBe(
    import.meta.path
  );
});

it("self-referencing imports works", async () => {
  await writePackageJSONExportsFixture();

  const baz = await import.meta.resolve("package-json-exports/baz");
  const namespace = await import.meta.resolve(
    "package-json-exports/references-baz"
  );
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

function writePackageJSONExportsFixture() {
  try {
    mkdirSync(
      join(import.meta.dir, "./node_modules/package-json-exports/foo"),
      {
        recursive: true,
      }
    );
  } catch (exception) {}
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/foo/bar.js"),
    "export const bar = 1;"
  );
  writeFileSync(
    join(
      import.meta.dir,
      "./node_modules/package-json-exports/foo/references-baz.js"
    ),
    "export {bar} from 'package-json-exports/baz';"
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/package.json"),
    JSON.stringify(
      {
        name: "package-json-exports",
        exports: {
          "./baz": "./foo/bar.js",
          "./references-baz": "./foo/references-baz.js",
        },
      },
      null,
      2
    )
  );
}
