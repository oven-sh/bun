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

  // A user-wrapped require.extensions loader goes through the builtin
  // Module._extensions loader, which assigns module.exports itself.
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
          first: { x: first.x, evaluation: first.evaluation, __esModule: first.__esModule },
          cachedAfterFirst,
          second: { x: second.x, evaluation: second.evaluation },
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      wrapperCalls: 2,
      first: { x: 1, evaluation: 1, __esModule: true },
      cachedAfterFirst: false,
      second: { x: 1, evaluation: 2 },
    });
    expect(exitCode).toBe(0);
  });

  // Here the registry entry exists before require() is called but has no
  // module record yet: an import() graph asked a plugin for the file and the
  // plugin has not answered. require() has to finish that entry (record created
  // during the load) and still return it after the module removes the entry.
  it("returns the namespace when the entry was still being fetched by an import() graph", async () => {
    using dir = tempDir("require-esm-self-evict-while-fetching", {
      "side.mjs": selfEvicting,
      "outer.mjs": /* js */ `
        export { x as sideX } from "./side.mjs";
      `,
      "entry.cjs": /* js */ `
        const { readFileSync } = require("node:fs");
        const importAskedForSide = Promise.withResolvers();
        let releaseImportFetch;
        Bun.plugin({
          name: "hold the import() graph's fetch of side.mjs",
          setup(build) {
            build.onLoad({ filter: /side\\.mjs$/ }, args => {
              const source = { contents: readFileSync(args.path, "utf8"), loader: "js" };
              // Only the first load (the import() graph) is held back; require() gets its source synchronously.
              if (releaseImportFetch) return source;
              const { promise, resolve } = Promise.withResolvers();
              releaseImportFetch = () => resolve(source);
              importAskedForSide.resolve();
              return promise;
            });
          },
        });

        (async () => {
          const outerImport = import("./outer.mjs");
          await importAskedForSide.promise;
          releaseImportFetch();
          // The loader turns the released source into a module record a few
          // microtasks later; require() on every hop until then covers the hop
          // on which require() itself has to finish the entry.
          let required;
          const errors = [];
          while (required === undefined && errors.length < 32) {
            await null;
            try {
              required = require("./side.mjs");
            } catch (error) {
              errors.push(error.message);
              if (!error.message.includes("async module")) break;
            }
          }
          const outer = await outerImport;
          console.log(JSON.stringify({
            required: required && { x: required.x },
            outerSideX: outer.sideX,
            unexpectedErrors: errors.filter(message => !message.includes("async module")),
          }));
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      required: { x: 1 },
      outerSideX: 1,
      unexpectedErrors: [],
    });
    expect(exitCode).toBe(0);
  });
});

// `import "./dep.js" with { type: "js" }` registers dep.js under a separate,
// attribute-typed registry entry. require() of the same file loads and
// evaluates the plain entry, and must report that one: not the attribute-typed
// instance, whose evaluation failed here.
describe.concurrent("require(esm) of a file that an import with a type attribute already registered", () => {
  it("returns the instance require() evaluated", async () => {
    using dir = tempDir("require-esm-attribute-typed-entry", {
      "dep.js": /* js */ `
        if (!globalThis.depThrewOnce) {
          globalThis.depThrewOnce = true;
          throw new Error("dep.js failed on purpose");
        }
        export const v = "second evaluation";
      `,
      "graph.mjs": /* js */ `
        import { v } from "./dep.js" with { type: "js" };
        export { v };
      `,
      "entry.cjs": /* js */ `
        import("./graph.mjs").then(
          () => {
            throw new Error("graph.mjs was expected to fail");
          },
          importError => {
            const required = require("./dep.js");
            console.log(JSON.stringify({ importError: importError.message, required: required.v }));
          },
        );
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(path.join(dir, "entry.cjs"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      importError: "dep.js failed on purpose",
      required: "second evaluation",
    });
    expect(exitCode).toBe(0);
  });
});
