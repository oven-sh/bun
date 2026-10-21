import { bunEnv, bunExe, bunRun, isWindows, tempDir, tempDirWithFiles } from "harness";
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

// A data file has one value in a loader, as a JSON file has in Node.js (https://nodejs.org/api/esm.html#json-modules):
// what an import of it gives as the default export is what require() of it returns, whichever comes first.
describe.concurrent("a data file that is imported and required", () => {
  const data = {
    "obj.json": `{"a":1,"b":{"c":[1,2]}}`,
    "arr.json": `[1,2,3]`,
    "null.json": `null`,
    "str.json": `"str"`,
    "default-key.json": `{"default":"d","x":1}`,
    "données.json": `{"a":1}`,
    "obj.jsonc": `{\n  // a comment\n  "a": 1,\n}\n`,
    "obj.toml": `a = 1\n[b]\nc = [1, 2]\n`,
    "obj.yaml": `a: 1\nb:\n  c: [1, 2]\n`,
    "obj.yml": `a: 1\n`,
    "obj.json5": `{a: 1, b: {c: [1, 2]},}\n`,
    "obj.xml": `<a><b>1</b></a>\n`,
    // An extension that bunfig.toml gives a data loader.
    "obj.conf": `a = 1\n`,
    "bunfig.toml": `[loader]\n".conf" = "toml"\n`,
  };
  const parsed: Record<string, unknown> = {
    "obj.json": { a: 1, b: { c: [1, 2] } },
    "arr.json": [1, 2, 3],
    "null.json": null,
    "str.json": "str",
    "default-key.json": { default: "d", x: 1 },
    "données.json": { a: 1 },
    "obj.jsonc": { a: 1 },
    "obj.toml": { a: 1, b: { c: [1, 2] } },
    "obj.yaml": { a: 1, b: { c: [1, 2] } },
    "obj.yml": { a: 1 },
    "obj.json5": { a: 1, b: { c: [1, 2] } },
    "obj.xml": { a: { b: "1" } },
    "obj.conf": { a: 1 },
  };
  const names = Object.keys(parsed);

  /** Runs `entry` in a directory of `files`. The script prints one JSON value. */
  async function run(files: Record<string, string>, entry: string, args: string[] = []) {
    using dir = tempDir("bun-test-require-data", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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
          const key = created.resolve("./obj.json");
          const entry = require.cache[key];
          out.entry = [entry.exports === imported["obj.json"], entry.loaded, entry.id === key, entry.children];
          out.namespace = Object.keys(namespace).sort();
          console.log(JSON.stringify(out));
        `,
      },
      "index.mjs",
    );
    expect(result).toEqual({
      printed: {
        ...Object.fromEntries(names.map(name => [name, [true, parsed[name]]])),
        // The entry in require.cache is a module, like every other entry.
        entry: [true, true, true, []],
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
          (async () => {
            const out = {};
            for (const [i, name] of names.entries()) out[name] = (await import("./" + name)).default === required[i];
            console.log(JSON.stringify(out));
          })();
        `,
      },
      "index.cjs",
    );
    expect(result).toEqual({
      printed: Object.fromEntries(names.map(name => [name, true])),
      stderr: "",
      exitCode: 0,
    });
  });

  it("the named exports of an import are the keys of the file, read from the value that require() returned", async () => {
    const result = await run(
      {
        "obj.json": data["obj.json"],
        "obj.toml": data["obj.toml"],
        "named.mjs": `export { a, b } from "./obj.toml";`,
        "index.cjs": `
          const changed = require("./obj.json");
          changed.a = 2;
          changed.added = true;
          const lost = require("./obj.toml");
          Object.defineProperty(lost, "a", { value: 3, enumerable: false });
          delete lost.b;
          (async () => {
            const json = await import("./obj.json");
            const toml = await import("./obj.toml");
            // An import of a key by name links, whatever CommonJS code did to the value.
            const named = await import("./named.mjs");
            console.log(JSON.stringify({
              changed: [json.default === changed, Object.keys(json), json.a],
              lost: [toml.default === lost, Object.keys(toml), named.a, "b" in named, named.b === undefined],
            }));
          })();
        `,
      },
      "index.cjs",
    );
    expect(result).toEqual({
      printed: {
        changed: [true, ["a", "b", "default"], 2],
        lost: [true, ["a", "b", "default"], 3, true, true],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a type attribute, a ?query: the path's own type shares the value, another type and another key do not", async () => {
    const files = {
      "obj.json": data["obj.json"],
      "obj.toml": data["obj.toml"],
      "package.json": `{"name":"pkg","version":"1.0.0"}`,
      "data.txt": `{"t":2}`,
      "index.mjs": `
        import { createRequire } from "node:module";
        import obj from "./obj.json";
        import objTyped from "./obj.json" with { type: "json" };
        import * as plain from "./obj.json";
        import * as typed from "./obj.json" with { type: "json" };
        import toml from "./obj.toml" with { type: "toml" };
        import pkg from "./package.json" with { type: "json" };
        import txtAsJson from "./data.txt" with { type: "json" };
        import query from "./obj.json?v=1";
        const require = createRequire(import.meta.url);
        console.log(JSON.stringify({
          plainIsTyped: obj === objTyped,
          keys: [Object.keys(plain), Object.keys(typed)],
          json: require("./obj.json") === objTyped,
          toml: require("./obj.toml") === toml,
          packageJson: require("./package.json") === pkg,
          txtAsJson,
          query: [query === obj, require("./obj.json?v=1") === query, query],
        }));
      `,
    };
    expect(await run(files, "index.mjs")).toEqual({
      printed: {
        plainIsTyped: true,
        keys: [
          ["a", "b", "default"],
          ["a", "b", "default"],
        ],
        json: true,
        toml: true,
        packageJson: true,
        txtAsJson: { t: 2 },
        query: [false, true, parsed["obj.json"]],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Each of these is as it is without this rule: the import reads the file itself.
  it("what a load under another type, user code or a require.extensions handler put in require.cache is not the import's value", async () => {
    const result = await run(
      {
        "obj.json": data["obj.json"],
        "arr.json": data["arr.json"],
        "str.json": data["str.json"],
        "obj.toml": data["obj.toml"],
        "data.txt": `{"t":2}`,
        "tsconfig.json": `{\n  // a comment\n  "a": 1\n}\n`,
        "comments.json": `{\n  // a comment\n  "a": 1\n}\n`,
        "index.cjs": `
          const key = name => require.resolve("./" + name);
          const text = require("./data.txt").default;
          const asFile = require("./str.json", { type: "file" });
          const tsconfig = require("./tsconfig.json");
          require.cache[key("obj.json")] = { exports: { planted: "not loaded" } };
          require.cache[key("arr.json")] = { exports: { planted: "loaded" }, loaded: true };
          require.extensions[".toml"] = (module, filename) => { module.exports = { handler: true }; };
          const toml = require("./obj.toml");
          (async () => {
            const value = async (name, type) => (await import("./" + name, type && { with: { type } })).default;
            const lenient = await value("comments.json", "jsonc");
            console.log(JSON.stringify({
              text: [text, await value("data.txt", "json")],
              typedImport: [lenient, require("./comments.json") === lenient],
              typedRequire: [asFile.endsWith("str.json"), await value("str.json"), await value("str.json", "json")],
              // A tsconfig.json may have comments, but not when it is imported as JSON.
              strict: [tsconfig, await value("tsconfig.json", "json").catch(error => error.name)],
              planted: [await value("obj.json"), require("./obj.json"), await value("arr.json"), require("./arr.json")],
              handler: [toml, await value("obj.toml"), require("./obj.toml") === toml],
            }));
          })();
        `,
      },
      "index.cjs",
    );
    expect(result).toEqual({
      printed: {
        text: [`{"t":2}`, { t: 2 }],
        typedImport: [{ a: 1 }, false],
        typedRequire: [true, "str", "str"],
        strict: [{ a: 1 }, "SyntaxError"],
        planted: [parsed["obj.json"], { planted: "not loaded" }, parsed["arr.json"], { planted: "loaded" }],
        handler: [{ handler: true }, parsed["obj.toml"], true],
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

  it("delete require.cache[key] lets the value be collected, also after two loads of the file that overlapped", async () => {
    const count = 10;
    const files: Record<string, string> = {
      "index.mjs": `
        import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        let collected = 0;
        const registry = new FinalizationRegistry(() => collected++);
        // import() of the file is in flight when require() of an ES module that imports the file loads it too.
        async function load(i) {
          const pending = import("./data" + i + ".json");
          const viaModule = require("./wrapper" + i + ".mjs").default;
          const value = (await pending).default;
          registry.register(value, i);
          delete require.cache[require.resolve("./data" + i + ".json")];
          delete require.cache[require.resolve("./wrapper" + i + ".mjs")];
          return value === viaModule;
        }
        const shared = [];
        for (let i = 0; i < ${count}; i++) shared.push(await load(i));
        for (let i = 0; i < 100 && collected < ${count}; i++) {
          Bun.gc(true);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        console.log(JSON.stringify({ shared: shared.every(Boolean), collected }));
      `,
    };
    for (let i = 0; i < count; i++) {
      files[`data${i}.json`] = `{"i":${i}}`;
      files[`wrapper${i}.mjs`] = `export { default } from "./data${i}.json";`;
    }
    expect(await run(files, "index.mjs")).toEqual({
      printed: { shared: true, collected: count },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a file that does not parse is an error for both, in both orders, and leaves no entry", async () => {
    const result = await run(
      {
        "bad.json": `{bad`,
        "bad.toml": `a = = 1\n`,
        "index.mjs": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          const failed = async load => { try { await load(); return "loaded"; } catch (error) { return error.name; } };
          const inCache = name => Object.keys(require.cache).some(key => key.endsWith(name));
          const out = {};
          for (const [name, first, second] of [
            ["bad.json", () => import("./bad.json"), () => require("./bad.json")],
            ["bad.toml", () => require("./bad.toml"), () => import("./bad.toml")],
          ]) {
            out[name] = [await failed(first), inCache(name), await failed(second), inCache(name)];
          }
          console.log(JSON.stringify(out));
        `,
      },
      "index.mjs",
    );
    expect(result).toEqual({
      printed: {
        "bad.json": ["SyntaxError", false, "SyntaxError", false],
        "bad.toml": ["BuildMessage", false, "BuildMessage", false],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("--hot: after an edit, import and require() both give the file's new value", async () => {
    using dir = tempDir("bun-test-require-data-hot", {
      "config.json": `{"v":1}`,
      "main.mjs": `
        import { createRequire } from "node:module";
        import config from "./config.json";
        const required = createRequire(import.meta.url)("./config.json");
        console.log("loaded " + JSON.stringify([config, required === config]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const reader = proc.stdout.getReader();
    let stdout = "";
    const line = async (n: number) => {
      for (;;) {
        const lines = stdout.split("\n").slice(0, -1);
        if (lines.length >= n) return lines[n - 1];
        const { value, done } = await reader.read();
        if (done) return stdout;
        stdout += Buffer.from(value).toString();
      }
    };
    expect(await line(1)).toBe(`loaded [{"v":1},true]`);
    // rename() into place, so that the reload never reads a file that is half written.
    const config = path.join(String(dir), "config.json");
    fs.writeFileSync(config + ".next", `{"v":2}`);
    // rmSync first on Windows, so that renameSync does not EPERM on the existing target.
    if (isWindows) fs.rmSync(config, { force: true });
    fs.renameSync(config + ".next", config);
    expect(await line(2)).toBe(`loaded [{"v":2},true]`);
  });

  // A setup file that imports the project's configuration does not change what require() of that file returns.
  describe("in a preload", () => {
    const suite = {
      "config.json": `{"v":1}`,
      "config.toml": `v = 1\n`,
      "setup.ts": `
        import json from "./config.json";
        import toml from "./config.toml";
        (globalThis as any).__config = { json, toml };
      `,
      "at-load.test.cjs": `
        const { test, expect } = require("bun:test");
        const json = require("./config.json");
        test("a CommonJS test file that requires the file when it loads", () => {
          expect(json).toEqual({ v: 1 });
        });
      `,
      "in-test.test.js": `
        import { test, expect } from "bun:test";
        test("a test that requires the file", () => {
          expect([require("./config.json"), require("./config.toml")]).toEqual([{ v: 1 }, { v: 1 }]);
          expect(require("./config.json")).toBe(globalThis.__config.json);
        });
      `,
      "src/legacy.cjs": `module.exports = require("../config.json");`,
      "code-under-test.test.js": `
        import { test, expect } from "bun:test";
        import legacy from "./src/legacy.cjs";
        test("code under test that requires the file", () => {
          expect(legacy).toEqual({ v: 1 });
        });
      `,
    };

    it.each([
      ["--preload", ["--preload", "./setup.ts"], {}],
      ["--preload --isolate", ["--preload", "./setup.ts", "--isolate"], {}],
      ["a bunfig.toml preload", [], { "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n` }],
    ])("bun test with %s: require() of the file returns its data", async (_, args, bunfig) => {
      using dir = tempDir("bun-test-require-data-preload", { ...suite, ...bunfig });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 3 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });

    it("the entry point gets the imported value, and is still module '.'", async () => {
      const result = await run(
        {
          "config.json": `{"v":1}`,
          "setup.mjs": `import config from "./config.json"; globalThis.__config = config;`,
          "main.cjs": `
            const config = require("./config.json");
            console.log(JSON.stringify({
              config,
              same: config === globalThis.__config,
              id: module.id,
              parent: module.parent,
              isMain: require.main === module,
            }));
          `,
        },
        "main.cjs",
        ["--preload", "./setup.mjs"],
      );
      expect(result).toEqual({
        printed: { config: { v: 1 }, same: true, id: ".", parent: null, isMain: true },
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
