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

// As in Node.js, a data file has one value in a loader: what an import of it gives as the default export is what
// require() of it returns, whichever comes first.
describe.concurrent("a data file that is imported and required", () => {
  const data = {
    "obj.json": `{"a":1,"b":{"c":[1,2]}}`,
    "arr.json": `[1,2,3]`,
    "null.json": `null`,
    "str.json": `"str"`,
    "default-key.json": `{"default":"d","x":1}`,
    "obj.jsonc": `{\n  // a comment\n  "a": 1,\n}\n`,
    "obj.toml": `a = 1\n[b]\nc = [1, 2]\n`,
    "obj.yaml": `a: 1\nb:\n  c: [1, 2]\n`,
    "obj.json5": `{a: 1, b: {c: [1, 2]},}\n`,
    "obj.xml": `<a><b>1</b></a>\n`,
  };
  const names = Object.keys(data);
  const parsed: Record<string, unknown> = {
    "obj.json": { a: 1, b: { c: [1, 2] } },
    "arr.json": [1, 2, 3],
    "null.json": null,
    "str.json": "str",
    "default-key.json": { default: "d", x: 1 },
    "obj.jsonc": { a: 1 },
    "obj.toml": { a: 1, b: { c: [1, 2] } },
    "obj.yaml": { a: 1, b: { c: [1, 2] } },
    "obj.json5": { a: 1, b: { c: [1, 2] } },
    "obj.xml": { a: { b: "1" } },
  };

  /** Runs `entry` in a directory of `files`. The script prints one JSON value. */
  async function run(files: Record<string, string>, entry: string) {
    using dir = tempDir("bun-test-require-data", files);
    const { stdout, stderr, exitCode } = await bunRun(path.join(String(dir), entry));
    let printed: unknown = stdout;
    try {
      printed = JSON.parse(stdout);
    } catch {}
    return { printed, stderr, exitCode };
  }

  it("import, then require(): every form of require() returns the imported value", async () => {
    const result = await run(
      {
        ...data,
        "sib.cjs": `module.exports = name => require("./" + name);`,
        "index.mjs": `
          import { createRequire } from "node:module";
          import sib from "./sib.cjs";
          ${names.map((name, i) => `import v${i} from "./${name}";`).join("\n")}
          import * as namespace from "./obj.json";
          const created = createRequire(import.meta.url);
          const imported = { ${names.map((name, i) => `"${name}": v${i}`).join(", ")} };
          const out = {};
          for (const [name, value] of Object.entries(imported)) {
            const required = [created("./" + name), import.meta.require("./" + name), require("./" + name), sib(name)];
            out[name] = [required.every(r => r === value), required[0]];
          }
          const entry = require.cache[created.resolve("./obj.json")];
          out.entry = [Object.keys(entry).sort(), entry.exports === imported["obj.json"], entry.loaded];
          out.namespace = Object.keys(namespace).sort();
          console.log(JSON.stringify(out));
        `,
      },
      "index.mjs",
    );
    expect(result).toEqual({
      printed: {
        ...Object.fromEntries(names.map(name => [name, [true, parsed[name]]])),
        // The entry in require.cache is what Node.js puts there.
        entry: [["exports", "loaded"], true, true],
        // The import's own exports are as before.
        namespace: ["a", "b", "default"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("require(), then import: the import gives the required value", async () => {
    const result = await run(
      {
        ...data,
        "index.cjs": `
          const names = ${JSON.stringify(names)};
          const required = names.map(name => require("./" + name));
          required[0].mutated = true;
          (async () => {
            const out = {};
            for (const [i, name] of names.entries()) out[name] = (await import("./" + name)).default === required[i];
            out.typed = (await import("./obj.json", { with: { type: "json" } })).default === required[0];
            out.mutated = (await import("./obj.json")).default.mutated;
            console.log(JSON.stringify(out));
          })();
        `,
      },
      "index.cjs",
    );
    expect(result).toEqual({
      printed: { ...Object.fromEntries(names.map(name => [name, true])), typed: true, mutated: true },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a type attribute that names the path's own loader shares the value; another type does not", async () => {
    const files = {
      "obj.json": data["obj.json"],
      "obj.toml": data["obj.toml"],
      "package.json": `{"name":"pkg","version":"1.0.0"}`,
      "raw.json": `{"r":1}`,
      "data.txt": `{"t":2}`,
      "import-first.mjs": `
        import { createRequire } from "node:module";
        import obj from "./obj.json";
        import objTyped from "./obj.json" with { type: "json" };
        import toml from "./obj.toml" with { type: "toml" };
        import pkg from "./package.json" with { type: "json" };
        import rawText from "./raw.json" with { type: "text" };
        import txtAsJson from "./data.txt" with { type: "json" };
        const require = createRequire(import.meta.url);
        console.log(JSON.stringify({
          plainIsTyped: obj === objTyped,
          json: require("./obj.json") === objTyped,
          toml: require("./obj.toml") === toml,
          packageJson: require("./package.json") === pkg,
          // Imported as text only: require() loads the file as JSON, which is what its path says.
          rawText,
          requireAfterText: require("./raw.json"),
          txtAsJson,
        }));
      `,
      // A text file that was required is still parsed when it is imported as JSON.
      "require-first.cjs": `
        const text = require("./data.txt").default;
        import("./data.txt", { with: { type: "json" } }).then(ns => console.log(JSON.stringify([text, ns.default])));
      `,
    };
    expect([await run(files, "import-first.mjs"), await run(files, "require-first.cjs")]).toEqual([
      {
        printed: {
          plainIsTyped: true,
          json: true,
          toml: true,
          packageJson: true,
          rawText: `{"r":1}`,
          requireAfterText: { r: 1 },
          txtAsJson: { t: 2 },
        },
        stderr: "",
        exitCode: 0,
      },
      { printed: [`{"t":2}`, { t: 2 }], stderr: "", exitCode: 0 },
    ]);
  });

  it("an entry user code put in require.cache, or a require.extensions handler filled, is the import's value once it is loaded", async () => {
    const result = await run(
      {
        "obj.json": data["obj.json"],
        "arr.json": data["arr.json"],
        "obj.toml": data["obj.toml"],
        "index.cjs": `
          const key = name => require.resolve("./" + name);
          require.cache[key("obj.json")] = { exports: { stub: "not loaded" } };
          require.cache[key("arr.json")] = { exports: { stub: "loaded" }, loaded: true };
          require.extensions[".toml"] = (module, filename) => { module.exports = { handler: filename.endsWith("obj.toml") }; };
          const toml = require("./obj.toml");
          (async () => {
            const obj = (await import("./obj.json")).default;
            const arr = (await import("./arr.json")).default;
            const tomlImported = (await import("./obj.toml")).default;
            console.log(JSON.stringify({
              notLoaded: [obj, require("./obj.json")],
              loaded: [arr, arr === require("./arr.json")],
              handler: [toml, tomlImported === toml, require.cache[key("obj.toml")].loaded],
            }));
          })();
        `,
      },
      "index.cjs",
    );
    expect(result).toEqual({
      printed: {
        // Not loaded: the import reads the file, and the entry stays what require() returns.
        notLoaded: [parsed["obj.json"], { stub: "not loaded" }],
        loaded: [{ stub: "loaded" }, true],
        handler: [{ handler: true }, true, true],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("delete require.cache[key] makes the next load read the file again; import() and require() in one tick share a value", async () => {
    const result = await run(
      {
        "obj.json": data["obj.json"],
        "arr.json": data["arr.json"],
        "index.mjs": `
          import { createRequire } from "node:module";
          import { writeFileSync } from "node:fs";
          import before from "./obj.json";
          const require = createRequire(import.meta.url);
          const key = require.resolve("./obj.json");
          const [viaImport, viaRequire] = [import("./arr.json"), require("./arr.json")];
          delete require.cache[key];
          writeFileSync(key, JSON.stringify({ a: 2 }));
          const after = require("./obj.json");
          const reimported = (await import("./obj.json")).default;
          console.log(JSON.stringify({
            sameTick: (await viaImport).default === viaRequire,
            after: [after, after === before, reimported === after],
          }));
        `,
      },
      "index.mjs",
    );
    expect(result).toEqual({
      printed: { sameTick: true, after: [{ a: 2 }, false, true] },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a CSS or HTML file: require() and require.cache give the default export of the import", async () => {
    const files = {
      "page.html": `<!doctype html><title>t</title>`,
      "style.css": `body { color: red }`,
      "index.mjs": `
        import { createRequire } from "node:module";
        import page from "./page.html";
        import style from "./style.css";
        const require = createRequire(import.meta.url);
        const first = process.argv[2];
        const viaCache = () => require.cache[require.resolve("./page.html")].exports === page;
        const viaRequire = () => require("./page.html") === page;
        const html = first === "cache" ? [viaCache(), viaRequire()] : [viaRequire(), viaCache()];
        console.log(JSON.stringify({ html, css: require("./style.css") === style }));
      `,
    };
    using dir = tempDir("bun-test-require-data", files);
    const index = path.join(String(dir), "index.mjs");
    const results = [await bunRun([index, "cache"]), await bunRun([index, "require"])];
    expect(results).toEqual(
      [0, 1].map(() => ({
        stdout: JSON.stringify({ html: [true, true], css: true }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      })),
    );
  });
});
