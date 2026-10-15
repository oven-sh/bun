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

  describe("when the module throws after its require.cache entry was deleted", () => {
    const evictsItself = {
      "thrower.cjs": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        delete require.cache[__filename];
        throw new Error("boom " + globalThis.runs);
      `,
    };
    const evictedByChild = {
      "thrower.cjs": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        require("./child.cjs");
        throw new Error("boom " + globalThis.runs);
      `,
      "child.cjs": `delete require.cache[module.parent.filename];`,
    };
    it.concurrent.each([
      ["by the module itself", evictsItself, "index.cjs"],
      ["by a module it required", evictedByChild, "index.cjs"],
      // A Bun.ModuleGraph has its own require.cache.
      ["by the module itself, inside a Bun.ModuleGraph", evictsItself, "in-graph.mjs"],
    ])("%s, the error is catchable and the next require() runs the module again", async (_, files, entry) => {
      using dir = tempDir("bun-test-require-evicted", {
        ...files,
        "index.cjs": `
          const id = require.resolve("./thrower.cjs");
          for (let i = 0; i < 2; i++) {
            try {
              require(id);
              console.log("no error");
            } catch (e) {
              console.log(e.message, id in require.cache, Bun.ModuleGraph.current !== undefined);
            }
          }
        `,
        "in-graph.mjs": `
          import path from "node:path";
          await new Bun.ModuleGraph().import(path.join(import.meta.dirname, "index.cjs"));
        `,
      });
      const inGraph = entry === "in-graph.mjs";
      expect(await bunRun(path.join(String(dir), entry))).toEqual({
        stdout: `boom 1 false ${inGraph}\nboom 2 false ${inGraph}`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  // Node's Module._load deletes Module._cache[filename], the name it resolved before the load.
  describe("when the module throws after module.filename was assigned", () => {
    const files = {
      // Takes the name of another cached module, then throws.
      "thrower.cjs": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        if (process.argv.at(-1) !== "assigned-by-requirer") module.filename = require.resolve("./other.cjs");
        throw new Error("boom " + globalThis.runs);
      `,
      "other.cjs": `module.exports = "other";`,
      "import.mjs": `
        import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        const thrower = require.resolve("./thrower.cjs");
        const other = require.resolve("./other.cjs");
        require(other);
        const report = e => console.log(e.message, thrower in require.cache, other in require.cache);
        await import("./thrower.cjs").then(() => console.log("no error"), report);
        try {
          require(thrower);
          console.log("no error");
        } catch (e) {
          report(e);
        }
      `,
      // require() of an ES module loads all of its imports before it runs the first one,
      // so thrower.cjs is in require.cache, and has not run, when requirer.cjs runs.
      "require-esm.cjs": `
        try {
          require("./graph.mjs");
        } catch {}
      `,
      "graph.mjs": `
        import "./requirer.cjs";
        import "./thrower.cjs";
      `,
      "requirer.cjs": `
        const thrower = require.resolve("./thrower.cjs");
        const other = require.resolve("./other.cjs");
        require(other);
        if (require.cache[thrower]?.loaded !== false) console.log("thrower.cjs must be in require.cache here, not loaded");
        if (process.argv.at(-1) === "assigned-by-requirer") require.cache[thrower].filename = other;
        for (let i = 0; i < 2; i++) {
          try {
            require(thrower);
            console.log("no error");
          } catch (e) {
            console.log(e.message, thrower in require.cache, other in require.cache);
          }
        }
      `,
      // module._compile() stores the code before it rejects a filename that is not a string.
      // require() runs that code after the handler returns.
      "leftover-code.cjs": `
        const Module = require("module");
        const thrower = require.resolve("./thrower.txt");
        const other = require.resolve("./other.cjs");
        require(other);
        Module._extensions[".txt"] = function (module) {
          const code =
            "globalThis.runs = (globalThis.runs ?? 0) + 1;" +
            "module.filename = " + JSON.stringify(other) + ";" +
            "throw new Error('boom ' + globalThis.runs);";
          try {
            module._compile(code, 123);
          } catch (e) {
            if (e.code !== "ERR_INVALID_ARG_TYPE") throw e;
          }
        };
        for (let i = 0; i < 2; i++) {
          try {
            require(thrower);
            console.log("no error");
          } catch (e) {
            console.log(e.message, thrower in require.cache, other in require.cache);
          }
        }
      `,
      "thrower.txt": "",
      "in-graph.mjs": `
        import path from "node:path";
        await new Bun.ModuleGraph().import(path.join(import.meta.dirname, process.argv[2]));
      `,
    };
    it.concurrent.each([
      // require() of a file whose import failed throws the error of the import. Node runs the file again.
      ["import() ran it", ["import.mjs"], "boom 1"],
      ["require() ran it before the import that put it in require.cache", ["require-esm.cjs"], "boom 2"],
      ["require() ran it, its requirer assigned the filename", ["require-esm.cjs", "assigned-by-requirer"], "boom 2"],
      ["require() ran code that a failed module._compile() call left on it", ["leftover-code.cjs"], "boom 2"],
      // A Bun.ModuleGraph has its own require.cache.
      ["import() ran it, inside a Bun.ModuleGraph", ["in-graph.mjs", "import.mjs"], "boom 1"],
      ["require() ran it, inside a Bun.ModuleGraph", ["in-graph.mjs", "require-esm.cjs"], "boom 2"],
    ])("%s: only the failed module leaves require.cache, and the next require() throws", async (_, args, next) => {
      using dir = tempDir("bun-test-require-renamed", files);
      const [entry, ...rest] = args;
      expect(await bunRun([path.join(String(dir), entry), ...rest])).toEqual({
        stdout: `boom 1 false true\n${next} false true`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
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
