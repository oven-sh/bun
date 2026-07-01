import { bunRun, tempDirWithFiles } from "harness";
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

describe("require(specifier, { paths })", () => {
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-test-require-paths", {
      "package.json": JSON.stringify({ name: "require-paths-option" }),
      "node_modules/installed-pkg/package.json": JSON.stringify({ name: "installed-pkg", main: "index.js" }),
      "node_modules/installed-pkg/index.js": "module.exports = 'installed';",
      "vendor/node_modules/vendored-pkg/package.json": JSON.stringify({ name: "vendored-pkg", main: "index.js" }),
      "vendor/node_modules/vendored-pkg/index.js": "module.exports = 'from-vendor';",
      "non-absolute.js": /* js */ `
        const assert = require("node:assert");
        const Module = require("node:module");
        const request = "package-that-does-not-exist";
        const pathsValues = [[2.2250738585072014e-308, -1000, Infinity], ["relative"], ["./relative"], [""]];
        for (const paths of pathsValues) {
          assert.throws(() => require.resolve(request, { paths }), { code: "MODULE_NOT_FOUND" });
          assert.throws(() => require(request, { paths }), { code: "MODULE_NOT_FOUND" });
          assert.throws(() => Module._resolveFilename(request, null, false, { paths }), { code: "MODULE_NOT_FOUND" });
        }
        console.log("ok");
      `,
      "relative.js": /* js */ `
        const assert = require("node:assert");
        const path = require("node:path");
        const results = ["vendor", "./vendor", path.join(__dirname, "vendor")].map(entry =>
          require.resolve("vendored-pkg", { paths: [entry] }),
        );
        assert.strictEqual(results[1], results[0]);
        assert.strictEqual(results[2], results[0]);
        assert(results[0].endsWith(path.join("vendor", "node_modules", "vendored-pkg", "index.js")), results[0]);
        assert.strictEqual(require("vendored-pkg", { paths: ["vendor"] }), "from-vendor");
        console.log("ok");
      `,
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws MODULE_NOT_FOUND instead of crashing when paths entries are not absolute", () => {
    const { stdout } = bunRun(path.join(dir, "non-absolute.js"));
    expect(stdout).toBe("ok");
  });

  it("resolves relative paths entries against the current working directory", () => {
    const { stdout } = bunRun(path.join(dir, "relative.js"));
    expect(stdout).toBe("ok");
  });
});
