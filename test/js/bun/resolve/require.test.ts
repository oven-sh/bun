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
  describe("when an imported module throws after module.filename was assigned", () => {
    const files = {
      // Takes the name of another cached module, then throws.
      "thrower.cjs": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        if (process.argv.at(-1) !== "renamed-by-another-module") module.filename = require.resolve("./other.cjs");
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
      // require() of an ES module fetches all of its imports before it runs the first one,
      // so thrower.cjs is in require.cache, and has not run, when renamer.cjs runs.
      "require-renamed.cjs": `
        const thrower = require.resolve("./thrower.cjs");
        const other = require.resolve("./other.cjs");
        for (const id of ["./renamed-graph.mjs", thrower]) {
          try {
            require(id);
            console.log("no error");
          } catch (e) {
            console.log(e.message, thrower in require.cache, other in require.cache);
          }
        }
      `,
      "renamed-graph.mjs": `
        import "./renamer.cjs";
        import "./thrower.cjs";
      `,
      "renamer.cjs": `
        const thrower = require.resolve("./thrower.cjs");
        const other = require.resolve("./other.cjs");
        require(other);
        if (require.cache[thrower]?.loaded !== false) console.log("thrower.cjs must be in require.cache here, not loaded");
        require.cache[thrower].filename = other;
      `,
      "in-graph.mjs": `
        import path from "node:path";
        await new Bun.ModuleGraph().import(path.join(import.meta.dirname, process.argv[2]));
      `,
    };
    it.concurrent.each([
      ["import() ran it", ["import.mjs"]],
      ["the loader ran it, another module assigned the filename", ["require-renamed.cjs", "renamed-by-another-module"]],
      // A Bun.ModuleGraph has its own require.cache.
      ["import() ran it, inside a Bun.ModuleGraph", ["in-graph.mjs", "import.mjs"]],
    ])("%s: only the failed module leaves require.cache, and the next require() throws", async (_, args) => {
      using dir = tempDir("bun-test-import-renamed", files);
      const [entry, ...rest] = args;
      expect(await bunRun([path.join(String(dir), entry), ...rest])).toEqual({
        // The second line is the error of the import again: require() does not run the file a second time. Node does.
        stdout: "boom 1 false true\nboom 1 false true",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  // Node's ES module loader runs only the CommonJS modules it put in Module._cache itself.
  describe("import() of a file that require.cache holds as a module with no source", () => {
    it.concurrent("a Module that the program put in require.cache is imported as it is and stays there", async () => {
      using dir = tempDir("bun-test-import-user-module", {
        "real.cjs": `
          globalThis.realRuns = (globalThis.realRuns ?? 0) + 1;
          module.exports = { real: true };
        `,
        "index.mjs": `
          import Module, { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const id = require.resolve("./real.cjs");
          const mock = new Module(id);
          mock.exports = { mocked: true };
          require.cache[id] = mock;
          const imported = (await import("./real.cjs")).default;
          const cached = require.cache[id] === mock;
          console.log(JSON.stringify({ imported, cached, required: require(id), realRuns: globalThis.realRuns ?? 0 }));
        `,
      });
      expect(await bunRun(path.join(String(dir), "index.mjs"))).toEqual({
        stdout: JSON.stringify({ imported: { mocked: true }, cached: true, required: { mocked: true }, realRuns: 0 }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    it.concurrent("a module that a Module._extensions handler filled without module._compile()", async () => {
      using dir = tempDir("bun-test-import-handler-module", {
        "real.js": `
          globalThis.realRuns = (globalThis.realRuns ?? 0) + 1;
          module.exports = { real: true };
        `,
        "index.cjs": `
          const Module = require("module");
          const id = require.resolve("./real.js");
          const original = Module._extensions[".js"];
          Module._extensions[".js"] = function (module, filename) {
            if (filename !== id) return original.apply(this, arguments);
            module.exports = { fromHandler: true };
          };
          const required = require(id);
          import("./real.js").then(ns => {
            const cached = id in require.cache;
            console.log(JSON.stringify({ required, imported: ns.default, cached, again: require(id), realRuns: globalThis.realRuns ?? 0 }));
          });
        `,
      });
      expect(await bunRun(path.join(String(dir), "index.cjs"))).toEqual({
        stdout: JSON.stringify({
          required: { fromHandler: true },
          imported: { fromHandler: true },
          cached: true,
          again: { fromHandler: true },
          realRuns: 0,
        }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    it.concurrent("the module that a Module._extensions handler is still loading", async () => {
      using dir = tempDir("bun-test-import-loading-module", {
        "real.cjs": `
          globalThis.realRuns = (globalThis.realRuns ?? 0) + 1;
          exports.runs = globalThis.realRuns;
        `,
        "importer.mjs": `
          import real from "./real.cjs";
          export const seen = JSON.stringify(real);
        `,
        "index.cjs": `
          const Module = require("module");
          const fs = require("fs");
          const id = require.resolve("./real.cjs");
          let seen;
          Module._extensions[".cjs"] = function (module, filename) {
            // The handler has not called module._compile() yet, so the module has no source.
            if (filename === id) seen = require("./importer.mjs").seen;
            module._compile(fs.readFileSync(filename, "utf8"), filename);
          };
          const first = require(id);
          console.log(JSON.stringify({ seen, first, cached: id in require.cache, same: require(id) === first }));
        `,
      });
      expect(await bunRun(path.join(String(dir), "index.cjs"))).toEqual({
        stdout: JSON.stringify({ seen: "{}", first: { runs: 1 }, cached: true, same: true }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    // The require() puts its own module in require.cache before the loader of the graph gets to the file.
    it.concurrent("a module that a require() in the same graph removed and loads again runs once", async () => {
      using dir = tempDir("bun-test-import-reloaded-module", {
        "real.cjs": `
          globalThis.realRuns = (globalThis.realRuns ?? 0) + 1;
          module.exports = { runs: globalThis.realRuns };
        `,
        "reloader.cjs": `
          const id = require.resolve("./real.cjs");
          if (require.cache[id]?.loaded !== false) console.log("real.cjs must be in require.cache here, not loaded");
          delete require.cache[id];
          globalThis.required = require(id);
        `,
        "graph.mjs": `
          import "./reloader.cjs";
          import real from "./real.cjs";
          export const imported = real;
        `,
        "index.cjs": `
          const { imported } = require("./graph.mjs");
          console.log(JSON.stringify({ required: globalThis.required, imported, realRuns: globalThis.realRuns }));
        `,
      });
      expect(await bunRun(path.join(String(dir), "index.cjs"))).toEqual({
        stdout: JSON.stringify({ required: { runs: 1 }, imported: { runs: 1 }, realRuns: 1 }),
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
