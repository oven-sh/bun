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

  it("a load that fails leaves the require.cache that require() looked the module up in", async () => {
    using dir = tempDir("bun-test-require-inherited-cache", {
      "once.cjs": `
        globalThis.runs = (globalThis.runs ?? 0) + 1;
        if (globalThis.runs > 1) throw new Error("boom " + globalThis.runs);
      `,
      "in-graph.cjs": `
        exports.module = module;
        exports.isCached = id => id in require.cache;
      `,
      "index.cjs": `
        const Module = require("node:module");
        (async () => {
          const inGraph = await new Bun.ModuleGraph().import("./in-graph.cjs");
          const id = require.resolve("./once.cjs");
          require(id);
          // This receiver is no module. It inherits the require.cache of a module of the graph.
          try {
            Module.prototype.require.call(Object.create(inGraph.module), id);
          } catch (e) {
            console.log(e.message, inGraph.isCached(id), id in require.cache);
          }
        })();
      `,
    });
    expect(await bunRun(path.join(String(dir), "index.cjs"))).toEqual({
      stdout: "boom 2 false true",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // A node:vm run with `timeout` or `breakOnSigint` ends with a termination. No `catch` sees it, and the
  // program goes on after the run.
  describe("when a node:vm run ends in the middle of the load", () => {
    // The loads below wait in spin() until the run ends. `spinsWhile(isLoading)` is an `Error` whose `prototype`
    // getter spins while `isLoading()`. The body of bun:sqlite reads that getter (`class SQLiteError extends Error`),
    // and while the body runs, bun:sqlite has an entry in the require.cache of the module that requires it.
    const cutInBody = `
      const vm = require("node:vm");
      const RealError = globalThis.Error;
      let inBody = false;
      // It gives up after 10 s, so that a child that nothing ends does not stay.
      function spin() {
        inBody = true;
        for (const end = Date.now() + 10_000; Date.now() < end; );
      }
      const spinsWhile = (isLoading, reached = () => {}) =>
        new Proxy(RealError, {
          get(target, key, receiver) {
            if (key === "prototype" && isLoading()) {
              reached();
              spin();
            }
            return Reflect.get(target, key, receiver);
          },
        });
      // The timeout doubles until it ends the run in the body. A run that ends before the body can leave a
      // file in require.cache, and reset() takes it out before the next attempt.
      let timeout = 50;
      function cutInBody(run, reset = () => {}) {
        for (; timeout < 10_000; timeout *= 2) {
          inBody = false;
          reset();
          try {
            run(timeout);
            return "returned";
          } catch (e) {
            if (inBody) return e.code;
          }
        }
        return "never in the body";
      }
    `;

    it.concurrent("of a built-in module, the next require() loads the module again", async () => {
      using dir = tempDir("bun-test-require-cut-builtin", {
        "index.cjs": `${cutInBody}
          const Module = require("node:module");
          const name = "bun:sqlite";
          const SpinsInBody = spinsWhile(() => name in require.cache);
          function cutFirstLoad(load, run = timeout => vm.runInThisContext("load()", { timeout })) {
            globalThis.load = load;
            globalThis.Error = SpinsInBody;
            const code = cutInBody(run);
            globalThis.Error = RealError;
            return code + ", cached: " + (name in require.cache);
          }
          const created = Module.createRequire(__filename);
          console.log("require:", cutFirstLoad(() => require(name)));
          console.log("Module.prototype.require:", cutFirstLoad(() => Module.prototype.require.call(null, name)));
          console.log("createRequire:", cutFirstLoad(() => created(name)));
          // The deadline of the outer run passes while the inner run is in the body.
          globalThis.vm = vm;
          const nested = timeout => vm.runInThisContext("vm.runInThisContext('load()', { timeout: 60_000 })", { timeout });
          console.log("outer run:", cutFirstLoad(() => require(name), nested));
          // The outer run gets the error of the inner run and requires the module again.
          globalThis.cutFirstLoad = cutFirstLoad;
          globalThis.loadAgain = () => typeof require(name).Database;
          const inner = vm.runInThisContext("cutFirstLoad(loadAgain) + ', then ' + loadAgain()", { timeout: 60_000 });
          console.log("inner run:", inner);
          const sqlite = require(name);
          console.log("same module as process.getBuiltinModule():", sqlite === process.getBuiltinModule(name));
          console.log("a query gives:", new sqlite.Database(":memory:").query("select 1 + 1 as two").get().two);
        `,
      });
      const { stdout, ...rest } = await bunRun(path.join(String(dir), "index.cjs"));
      expect({ stdout: stdout.split("\n"), ...rest }).toEqual({
        stdout: [
          "require: ERR_SCRIPT_EXECUTION_TIMEOUT, cached: false",
          "Module.prototype.require: ERR_SCRIPT_EXECUTION_TIMEOUT, cached: false",
          "createRequire: ERR_SCRIPT_EXECUTION_TIMEOUT, cached: false",
          "outer run: ERR_SCRIPT_EXECUTION_TIMEOUT, cached: false",
          "inner run: ERR_SCRIPT_EXECUTION_TIMEOUT, cached: false, then function",
          "same module as process.getBuiltinModule(): true",
          "a query gives: 2",
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    it.concurrent("in a Bun.ModuleGraph or in a plugin's callback, the next require() loads the module", async () => {
      using dir = tempDir("bun-test-require-cut", {
        "in-graph.cjs": `
          exports.load = () => require("bun:sqlite");
          exports.isCached = () => "bun:sqlite" in require.cache;
        `,
        "on-disk.spins": "",
        "index.cjs": `${cutInBody}
          const run = timeout => vm.runInThisContext("load()", { timeout });
          (async () => {
            // A Bun.ModuleGraph has its own require.cache.
            const graph = new Bun.ModuleGraph();
            const inGraph = await graph.import("./in-graph.cjs");
            globalThis.load = inGraph.load;
            globalThis.Error = spinsWhile(inGraph.isCached);
            const inGraphCode = cutInBody(run);
            globalThis.Error = RealError;
            console.log("Bun.ModuleGraph:", inGraphCode, inGraph.isCached(), typeof inGraph.load().Database);

            // The run ends in the callback of the plugin. The next require() calls the callback again.
            let spins;
            const calls = { module: 0, onLoad: 0 };
            const callback = kind => () => {
              calls[kind]++;
              if (spins) spin();
              return { exports: { calls: calls[kind] }, loader: "object" };
            };
            Bun.plugin({
              name: "spins",
              setup(build) {
                build.module("virtual:spins", callback("module"));
                build.onLoad({ filter: /\\.spins$/ }, callback("onLoad"));
              },
            });
            for (const [kind, id] of [["module", "virtual:spins"], ["onLoad", require.resolve("./on-disk.spins")]]) {
              globalThis.load = () => require(id);
              spins = true;
              const code = cutInBody(run);
              spins = false;
              console.log("build." + kind + ":", code, id in require.cache, JSON.stringify(require(id)));
            }
          })();
        `,
      });
      const { stdout, ...rest } = await bunRun(path.join(String(dir), "index.cjs"));
      expect({ stdout: stdout.split("\n"), ...rest }).toEqual({
        stdout: [
          "Bun.ModuleGraph: ERR_SCRIPT_EXECUTION_TIMEOUT false function",
          'build.module: ERR_SCRIPT_EXECUTION_TIMEOUT false {"calls":2}',
          'build.onLoad: ERR_SCRIPT_EXECUTION_TIMEOUT false {"calls":2}',
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    // POSIX-only: the test sends a real SIGINT once the child says that the run is in the body of the module.
    it.skipIf(isWindows).concurrent("by a SIGINT, the next require() loads the built-in module again", async () => {
      const code = `${cutInBody}
        const { writeSync } = require("node:fs");
        const name = "bun:sqlite";
        globalThis.load = () => require(name);
        globalThis.Error = spinsWhile(
          () => name in require.cache,
          () => writeSync(1, "in the body\\n"),
        );
        let code;
        try {
          vm.runInThisContext("load()", { breakOnSigint: true });
        } catch (e) {
          code = e.code;
        }
        globalThis.Error = RealError;
        console.log(code, name in require.cache, typeof require(name).Database);
      `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const stderr = proc.stderr.text();
      const decoder = new TextDecoder();
      let stdout = "";
      let interrupted = false;
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (!interrupted && stdout.includes("in the body\n")) {
          interrupted = true;
          proc.kill("SIGINT");
        }
      }
      expect({ stdout, stderr: await stderr, exitCode: await proc.exited }).toEqual({
        stdout: "in the body\nERR_SCRIPT_EXECUTION_INTERRUPTED false function\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // Node keeps the same entries, with the same exports.
    it.concurrent("of a file, the file keeps its require.cache entry and its exports so far", async () => {
      using dir = tempDir("bun-test-require-cut-file", {
        "half.cjs": `
          exports.before = true;
          spin();
          exports.after = true;
        `,
        "uses-sqlite.cjs": `
          exports.before = true;
          exports.Database = require("bun:sqlite").Database;
          exports.after = true;
        `,
        "handled.spins": "",
        "index.cjs": `${cutInBody}
          function cutLoadOf(file) {
            globalThis.load = () => require(file);
            return cutInBody(
              timeout => vm.runInThisContext("load()", { timeout }),
              () => delete require.cache[file],
            );
          }
          const kept = file => (file in require.cache) + " " + JSON.stringify(Object.keys(require(file)));

          const half = require.resolve("./half.cjs");
          globalThis.spin = spin;
          const halfCode = cutLoadOf(half);
          globalThis.spin = () => {};
          console.log("file:", halfCode, kept(half));

          // The built-in is loaded again for the next module that requires it. The file is not run again.
          const usesSqlite = require.resolve("./uses-sqlite.cjs");
          globalThis.Error = spinsWhile(() => "bun:sqlite" in require.cache);
          const usesSqliteCode = cutLoadOf(usesSqlite);
          globalThis.Error = RealError;
          const sqlite = ("bun:sqlite" in require.cache) + " " + typeof require("bun:sqlite").Database;
          console.log("file that requires a built-in:", usesSqliteCode, kept(usesSqlite), sqlite);

          // The run ends in a handler of Module._extensions, before the handler gives the module its exports.
          const handled = require.resolve("./handled.spins");
          let spins = true;
          let calls = 0;
          require("node:module")._extensions[".spins"] = module => {
            calls++;
            if (spins) spin();
            module.exports = { handled: true };
          };
          const handledCode = cutLoadOf(handled);
          spins = false;
          console.log("Module._extensions handler:", handledCode, kept(handled), calls);
        `,
      });
      const { stdout, ...rest } = await bunRun(path.join(String(dir), "index.cjs"));
      expect({ stdout: stdout.split("\n"), ...rest }).toEqual({
        stdout: [
          'file: ERR_SCRIPT_EXECUTION_TIMEOUT true ["before"]',
          'file that requires a built-in: ERR_SCRIPT_EXECUTION_TIMEOUT true ["before"] false function',
          "Module._extensions handler: ERR_SCRIPT_EXECUTION_TIMEOUT true [] 1",
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    // The parser does not look at the deadline, so the load fails with the error of the parser first.
    it.concurrent("while a file with a syntax error is parsed, the next require() throws the error again", async () => {
      using dir = tempDir("bun-test-require-cut-parse", {
        "bad.cjs": Buffer.alloc(1024 * 1024, "exports.property = 1;\n").toString() + ")(",
        "index.cjs": `
          const vm = require("node:vm");
          const bad = require.resolve("./bad.cjs");
          globalThis.load = () => require(bad);
          const failure = run => {
            try {
              run();
              return "loaded";
            } catch (e) {
              return e.code ?? e.name;
            }
          };
          // How long the load takes until the parser reports the error.
          const start = performance.now();
          failure(load);
          const took = performance.now() - start;
          // A deadline in the middle of that time passes while the file is parsed. A run that the deadline
          // did not end gets a shorter one. A run that left the file in require.cache is made again.
          let ended, leftBehind;
          for (let timeout = took / 2, attempt = 0; attempt < 8; attempt++) {
            delete require.cache[bad];
            ended = failure(() => vm.runInThisContext("load()", { timeout: Math.max(1, Math.round(timeout)) }));
            leftBehind = bad in require.cache;
            if (ended !== "ERR_SCRIPT_EXECUTION_TIMEOUT") timeout /= 2;
            else if (!leftBehind) break;
          }
          console.log(ended, leftBehind, failure(load) !== "loaded");
        `,
      });
      expect(await bunRun(path.join(String(dir), "index.cjs"))).toEqual({
        stdout: "ERR_SCRIPT_EXECUTION_TIMEOUT false true",
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
