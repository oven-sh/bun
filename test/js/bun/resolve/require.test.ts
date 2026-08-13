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
    it.each(["obj.toml", "obj.json", "obj.jsonc", "obj.xml"])(
      "require('%s') synchronously produces an object",
      file => {
        const result = require(fixture(file));
        expect(result).toEqual({
          foo: {
            bar: "baz",
          },
        });
      },
    );

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

    it.failing("is a Module object when a file is run directly", async () => {
      const file = path.join(dir, "index.js");
      const { stdout, stderr, exitCode } = await bunRun(file);
      expect(stderr).toBeEmpty();
      expect(exitCode).toBe(0);

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

// The ESM registry entry is removed while the module's own top level is still
// running. require() must still return the namespace of the instance it just
// evaluated; the eviction applies to the next require(), which evaluates the
// file again.
describe.concurrent("require(esm) of a module evicted from require.cache during its own evaluation", () => {
  const selfEvicting = /* js */ `
    globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
    delete require.cache[import.meta.path];
    export const x = 1;
    export const evaluation = globalThis.evaluations;
  `;

  it("returns the namespace when the module deletes itself from require.cache", async () => {
    using dir = tempDir("require-esm-self-evict", {
      "self-evict.mjs": selfEvicting,
      "entry.cjs": /* js */ `
        const first = require("./self-evict.mjs");
        const cachedAfterFirst = require.resolve("./self-evict.mjs") in require.cache;
        const second = require("./self-evict.mjs");
        console.log(JSON.stringify({
          first: { x: first.x, evaluation: first.evaluation },
          cachedAfterFirst,
          second: { x: second.x, evaluation: second.evaluation },
          sameNamespace: first === second,
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      first: { x: 1, evaluation: 1 },
      cachedAfterFirst: false,
      second: { x: 1, evaluation: 2 },
      sameNamespace: false,
    });
    expect(exitCode).toBe(0);
  });

  it("returns the namespace when a dependency clears require.cache", async () => {
    using dir = tempDir("require-esm-dep-clears-cache", {
      "clear-cache.mjs": /* js */ `
        for (const key of Object.keys(require.cache)) delete require.cache[key];
        export const cleared = true;
      `,
      "leaf.mjs": /* js */ `
        export const leaf = "leaf";
      `,
      "root.mjs": /* js */ `
        import { cleared } from "./clear-cache.mjs";
        export * from "./leaf.mjs";
        export { cleared };
        globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
        export const evaluation = globalThis.evaluations;
      `,
      "entry.cjs": /* js */ `
        const first = require("./root.mjs");
        const cachedAfterFirst = require.resolve("./root.mjs") in require.cache;
        const second = require("./root.mjs");
        console.log(JSON.stringify({
          first: { cleared: first.cleared, leaf: first.leaf, evaluation: first.evaluation },
          cachedAfterFirst,
          second: { cleared: second.cleared, leaf: second.leaf, evaluation: second.evaluation },
          sameNamespace: first === second,
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      first: { cleared: true, leaf: "leaf", evaluation: 1 },
      cachedAfterFirst: false,
      second: { cleared: true, leaf: "leaf", evaluation: 2 },
      sameNamespace: false,
    });
    expect(exitCode).toBe(0);
  });

  // A user-wrapped require.extensions loader reaches the ESM namespace through
  // Module._extensions (requireESMFromHijackedExtension) rather than require().
  it("sets module.exports when loaded through a wrapped require.extensions loader", async () => {
    using dir = tempDir("require-esm-self-evict-extensions", {
      "self-evict.mjs": selfEvicting,
      "entry.cjs": /* js */ `
        const builtinLoader = require.extensions[".mjs"];
        let wrapperCalls = 0;
        require.extensions[".mjs"] = function (module, filename) {
          wrapperCalls++;
          builtinLoader(module, filename);
        };
        const first = require("./self-evict.mjs");
        const cachedAfterFirst = require.resolve("./self-evict.mjs") in require.cache;
        const second = require("./self-evict.mjs");
        console.log(JSON.stringify({
          wrapperCalls,
          first: { x: first.x, evaluation: first.evaluation },
          cachedAfterFirst,
          second: { x: second.x, evaluation: second.evaluation },
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      wrapperCalls: 2,
      first: { x: 1, evaluation: 1 },
      cachedAfterFirst: false,
      second: { x: 1, evaluation: 2 },
    });
    expect(exitCode).toBe(0);
  });
});
