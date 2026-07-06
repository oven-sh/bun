import { bunRun, tempDir, tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";
const fixture = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "require", ...segs);

describe("require(specifier)", () => {
  it("has a length of 1", () => expect(require).toHaveLength(1));
  it("is a function", () => expect(require).toBeFunction());
  // FIXME: is currently `undefined`
  it.failing("has an empty prototype", () => expect(require.prototype).toEqual({}));

  describe("when specifier is a path to a non js/ts/etc file", () => {
    it.each(["obj.toml", "obj.json", "obj.jsonc"])("require('%s') synchronously produces an object", file => {
      const result = require(fixture(file));
      expect(result).toEqual({
        foo: {
          bar: "baz",
        },
      });
    });

    // note: toml does not support top-level arrays
    it.each(["arr.json", "arr.jsonc"])("require('%s') synchronously produces an array", file => {
      const result = require(fixture(file));
      expect(result).toEqual(["foo", "bar", "baz"]);
    });

    // FIXME: require() on .txt should not have a .default property
    it("require('*.txt') synchronously produces a string", () => {
      const result = require(fixture("foo.txt"));
      // this should probably be expected behavior, but that's not how it works rn
      // expect(result).toMatch(/^According to all known laws of aviation, there is no way a bee should be able to fly\./);
      expect(result).toBeObject();
      expect(result.default).toBeString();
      expect(result.default).toMatch(
        /^According to all known laws of aviation, there is no way a bee should be able to fly\./,
      );
    });

    it.todo("require('*.html') synchronously produces a string");
    it.todo("require('*.wasm') produces a WebAssembly.Module");
    it.todo("require('*.db') wraps a sqlite file in a Database object and exports it");
  });

  describe("when specifier is an ES module whose graph uses top-level await", () => {
    // Loaders detect `err.code === "ERR_REQUIRE_ASYNC_MODULE"` to fall back to import().
    // https://nodejs.org/api/errors.html#err_require_async_module
    it("throws a node-style ERR_REQUIRE_ASYNC_MODULE error", () => {
      using dir = tempDir("require-tla", {
        "tla.mjs": `await new Promise(resolve => setTimeout(resolve, 1));\nexport const value = 1;\n`,
      });
      const specifier = path.join(String(dir), "tla.mjs");

      let error: any;
      try {
        require(specifier);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error.name).toBe("Error");
      expect(error.code).toBe("ERR_REQUIRE_ASYNC_MODULE");
      expect(error.message).toContain(require.resolve(specifier));
    });

    it("throws ERR_REQUIRE_ASYNC_MODULE when only a transitive dependency has top-level await", () => {
      using dir = tempDir("require-transitive-tla", {
        "leaf.mjs": `await new Promise(resolve => setTimeout(resolve, 1));\nexport const value = 1;\n`,
        "middle.mjs": `export { value } from "./leaf.mjs";\n`,
      });
      const specifier = path.join(String(dir), "middle.mjs");

      let error: any;
      try {
        require(specifier);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("ERR_REQUIRE_ASYNC_MODULE");
    });
  });

  describe("require.main", () => {
    let dir: string;

    beforeAll(() => {
      dir = tempDirWithFiles("bun-test-require-main", {
        "index.js": /* js */ `
        const assert = require("node:assert");
        assert(require.main && typeof require.main === "object");
        console.log(JSON.stringify(require.main, null, 2));
        `,
      });
    });

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it.failing("is a Module object when a file is run directly", () => {
      const file = path.join(dir, "index.js");
      const { stdout, stderr } = bunRun(file);
      expect(stderr).toBeEmpty();

      // FIXME: most of these properties exist, but are non-enumerable and are
      // not present as keys when stringified
      const main = JSON.parse(stdout);
      expect(main).toMatchObject({
        id: ".",
        filename: file,
        path: expect.any(String),
        exports: {},
        children: [],
        paths: expect.any(Array),
      });
      expect(main.filename).toContain(main.path);
    });
  });
});
