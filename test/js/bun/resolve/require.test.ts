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

    // Node assigns the main module once, when it loads the entry point:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L1359-L1364
    // Where node v26.3.0 prints something else for a program below, a comment says what.
    const run = async (files: Record<string, string>, ...args: string[]) => {
      using dir = tempDir("bun-test-require-main", files);
      return await bunRun(args.map(arg => (arg in files ? path.join(String(dir), arg) : arg)));
    };
    const prints = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signalCode: null });
    const purge = `for (const key of Object.keys(require.cache)) delete require.cache[key];`;

    it.concurrent("is the entry point after every key of require.cache is deleted", async () => {
      const files = {
        "entry.cjs": `
          console.log("first load: " + require("./app.cjs"));
          ${purge}
          console.log("after the purge: " + require("./app.cjs"));
        `,
        "app.cjs": `module.exports = require("node:path").basename(require.main.filename);`,
      };
      expect(await run(files, "entry.cjs")).toEqual(prints("first load: entry.cjs\nafter the purge: entry.cjs"));
    });

    it.concurrent("is not a second load of the entry point", async () => {
      const files = {
        "server.cjs": `
          globalThis.starts = globalThis.starts || 0;
          exports.start = () => ++globalThis.starts;
          if (require.main === module) {
            exports.start();
            if (globalThis.starts === 1) {
              ${purge}
              require("./routes.cjs");
              console.log("start() ran " + globalThis.starts + " times");
            }
          }
        `,
        "routes.cjs": `module.exports = typeof require("./server.cjs").start;`,
        "identity.cjs": `
          globalThis.loads = (globalThis.loads ?? 0) + 1;
          const main = require.main;
          console.log("load " + globalThis.loads, main === module, process.mainModule === module);
          if (globalThis.loads === 1) {
            ${purge}
            require(__filename);
            const afterwards = require.main;
            console.log("afterwards", afterwards === module, process.mainModule === module);
          }
        `,
      };
      expect(await run(files, "server.cjs")).toEqual(prints("start() ran 1 times"));
      expect(await run(files, "identity.cjs")).toEqual(
        prints("load 1 true true\nload 2 false false\nafterwards true true"),
      );
    });

    it.concurrent.each([
      ["every key is deleted", purge],
      ["the key of the entry point is deleted", `delete require.cache[__filename];`],
      [
        "the key of the entry point holds another object",
        `require.cache[__filename] = { filename: "another object" };`,
      ],
      ["node:module's _cache loses the key", `delete require("node:module")._cache[__filename];`],
    ])("is the entry point for every reader after %s", async (_, evict) => {
      // Nothing reads the main module before the eviction, and one reader asks from a timer.
      const files = {
        "entry.cjs": `
          const { createRequire } = require("node:module");
          const child = require("./child.cjs");
          ${evict}
          const readers = {
            "require.main": require.main,
            "module.require.main": module.require.main,
            "createRequire(__filename).main": createRequire(__filename).main,
            "require.main of a child": child.main(),
            "process.mainModule": process.mainModule,
          };
          const wrong = Object.keys(readers).filter(name => readers[name] !== module);
          setTimeout(() => {
            if (child.main() !== module) wrong.push("require.main in a timer");
            console.log(JSON.stringify({ wrong, written: require.main === module }));
          }, 1);
        `,
        "child.cjs": `exports.main = () => require.main;`,
      };
      expect(await run(files, "entry.cjs")).toEqual(prints(JSON.stringify({ wrong: [], written: true })));
    });

    it.concurrent("is the entry point of a Worker after every key of require.cache is deleted", async () => {
      const files = {
        "entry.cjs": `
          const { Worker, isMainThread, parentPort } = require("node:worker_threads");
          if (isMainThread) {
            const worker = new Worker(__filename);
            worker.on("message", message => console.log(message));
            worker.on("error", error => {
              console.error(error);
              process.exitCode = 1;
            });
          } else {
            const before = require.main === module;
            ${purge}
            const main = require.main;
            parentPort.postMessage([before, main === module, process.mainModule === module].join());
          }
        `,
      };
      expect(await run(files, "entry.cjs")).toEqual(prints("true,true,true"));
    });

    it.concurrent("is the entry point in the handlers of what it throws", async () => {
      // The loader takes a module that throws out of require.cache.
      const files = {
        "entry.cjs": `
          const ask = event => {
            const main = require.main;
            console.log(event, main === module, process.mainModule === module);
          };
          process.on("uncaughtException", () => ask("uncaughtException"));
          process.on("exit", () => ask("exit"));
          throw new Error("thrown by the entry point");
        `,
      };
      expect(await run(files, "entry.cjs")).toEqual(prints("uncaughtException true true\nexit true true"));
    });

    // Each row loads the entry point another way. Nothing reads the main module before the entry point changes the cache.
    const preloadWithPlugin = (onLoad: string) => `
      const fs = require("node:fs");
      Bun.plugin({
        name: "serves the entry point",
        setup(build) {
          build.onLoad({ filter: /entry\\.cjs$/ }, ${onLoad});
        },
      });
    `;
    const preloadWithRunMain = (body: string) => `
      const Module = require("node:module");
      const original = Module.runMain;
      Module.runMain = function () { ${body} };
    `;
    // As the packages bytenode and v8-compile-cache do: the wrapper of the module is compiled and called with no Module.prototype._compile.
    const runsTextItself = (where: "handler" | "_compile") => `
      const runText = (module, text, filename) =>
        require("node:vm")
          .runInThisContext(Module.wrap(text), { filename })
          .call(module.exports, module.exports, Module.createRequire(filename), module, filename, require("node:path").dirname(filename));
      const loadJavaScript = Module._extensions[".js"];
      require.extensions[".cjs"] = (module, filename) => {
        if (${JSON.stringify(where)} === "handler") return runText(module, require("node:fs").readFileSync(filename, "utf8"), filename);
        module._compile = (text, filename) => runText(module, text, filename);
        return loadJavaScript(module, filename);
      };
    `;
    it.concurrent.each([
      ["bun entry.cjs", undefined],
      [
        "an onLoad plugin serves the entry point",
        preloadWithPlugin(`args => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "js" })`),
      ],
      [
        "an async onLoad plugin serves the entry point",
        preloadWithPlugin(`async args => (await 0, { contents: fs.readFileSync(args.path, "utf8"), loader: "js" })`),
      ],
      [
        "a Module.runMain of a preload passes its arguments on",
        preloadWithRunMain(`return original.apply(this, arguments);`),
      ],
      [
        "a Module.runMain of a preload calls the original with the path",
        preloadWithRunMain(`return original.call(this, process.argv[1]);`),
      ],
      // Node loads the file that this Module.runMain requires as any other module, and has no main module then.
      // Bun knows the file as the entry point whoever loads it, as before.
      ["a Module.runMain of a preload requires the path", preloadWithRunMain(`require(process.argv[1]);`)],
      // A handler gets a file that require() loads. So these preloads require the entry point too.
      [
        "a handler of require.extensions compiles the entry point",
        preloadWithRunMain(`require(process.argv[1]);`) +
          `require.extensions[".cjs"] = (module, filename) => module._compile(require("node:fs").readFileSync(filename, "utf8"), filename);`,
      ],
      [
        "a handler of require.extensions gives the module another filename and compiles the entry point",
        preloadWithRunMain(`require(process.argv[1]);`) +
          `require.extensions[".cjs"] = (module, filename) => {
            module.filename = filename + ".compiled";
            module._compile(require("node:fs").readFileSync(filename, "utf8"), filename);
          };`,
      ],
      [
        "a handler of require.extensions runs the entry point by itself",
        preloadWithRunMain(`require(process.argv[1]);`) + runsTextItself("handler"),
      ],
      [
        "a module._compile of a handler runs the entry point by itself",
        preloadWithRunMain(`require(process.argv[1]);`) + runsTextItself("_compile"),
      ],
    ])("is the entry point after the cache changes, when %s", async (_, preload) => {
      const files = {
        "preload.cjs": preload ?? "",
        "entry.cjs": `
          const child = require("./child.cjs");
          const ask = () => [require.main === module, child.main() === module, process.mainModule === module].join();
          require.cache[__filename] = { filename: "another object" };
          const replaced = ask();
          ${purge}
          console.log(JSON.stringify({ replaced, purged: ask() }));
        `,
        "child.cjs": `exports.main = () => require.main;`,
      };
      expect(await run(files, ...(preload ? ["-r", "preload.cjs"] : []), "entry.cjs")).toEqual(
        prints(JSON.stringify({ replaced: "true,true,true", purged: "true,true,true" })),
      );
    });

    it.concurrent.each([
      ["requires it", `require("./entry.cjs");`],
      ["requires it in a tick", `process.nextTick(() => require("./entry.cjs"));`],
      ["calls Module.runMain with its path", `require("node:module").runMain(process.argv[1]);`],
    ])("is the entry point that a preload has loaded already: one that %s", async (_, preload) => {
      // The load of the entry point finds the module in the cache and does not run it again. Node prints the same for
      // the last two preloads. For the first it prints "1,false,false 1,false,false": the file is in its cache when it
      // loads the entry point, so it has no main module. Bun knows the file as the entry point whoever loads it, as before.
      const files = {
        "preload.cjs": preload,
        "entry.cjs": `
          globalThis.loads = (globalThis.loads ?? 0) + 1;
          const ask = () => [globalThis.loads, require.main === module, process.mainModule === module].join();
          const atLoad = ask();
          setImmediate(() => {
            ${purge}
            console.log(atLoad, ask());
          });
        `,
      };
      expect(await run(files, "-r", "preload.cjs", "entry.cjs")).toEqual(prints("1,true,true 1,true,true"));
    });

    it.concurrent(
      "is the module that the entry load runs, after a preload required the file and deleted its key",
      async () => {
        // The load of the entry point runs the file again. Node prints "load 1: false,false false,false" for the module
        // that the preload required: it has no main module then. Bun knows the file as the entry point whoever loads it.
        const files = {
          "preload.cjs": `
          require("./entry.cjs");
          delete require.cache[require.resolve("./entry.cjs")];
        `,
          "entry.cjs": `
          globalThis.loads = (globalThis.loads ?? 0) + 1;
          const load = globalThis.loads;
          const ask = () => [require.main === module, process.mainModule === module].join();
          const atLoad = ask();
          setImmediate(() => {
            ${purge}
            console.log("load " + load + ":", atLoad, ask());
          });
        `,
        };
        expect(await run(files, "-r", "preload.cjs", "entry.cjs")).toEqual(
          prints("load 1: true,true false,false\nload 2: true,true true,true"),
        );
      },
    );

    it.concurrent("is the entry point while an onLoad plugin runs it inside its own load", async () => {
      const files = {
        "preload.cjs": `
          const fs = require("node:fs");
          let asked = false;
          Bun.plugin({
            name: "requires what requires the entry point",
            setup(build) {
              build.onLoad({ filter: /entry\\.cjs$/ }, args => {
                if (!asked) {
                  asked = true;
                  require("./importer.cjs");
                }
                return { contents: fs.readFileSync(args.path, "utf8"), loader: "js" };
              });
            },
          });
        `,
        "importer.cjs": `require("./entry.cjs");`,
        "entry.cjs": `console.log(require.main === module, process.mainModule === module);`,
      };
      expect(await run(files, "-r", "preload.cjs", "entry.cjs")).toEqual(prints("true true"));
    });

    it.concurrent.each([
      [
        "another file",
        `build.onResolve({ filter: /entry\\.cjs$/ }, () => ({ path: path.join(__dirname, "other.cjs") }));`,
      ],
      [
        "a namespace",
        `build.onResolve({ filter: /entry\\.cjs$/ }, args => ({ path: args.path, namespace: "virtual" }));
         build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: fs.readFileSync(path.join(__dirname, "other.cjs"), "utf8"), loader: "js" }));`,
      ],
    ])("is the module that runs for the entry point, when a plugin sends the entry point to %s", async (_, hooks) => {
      // Node says the same with module.registerHooks(). `Bun.main` and `import.meta.main` keep the path of the command line.
      const files = {
        "preload.cjs": `
          const fs = require("node:fs");
          const path = require("node:path");
          Bun.plugin({ name: "sends the entry point elsewhere", setup(build) { ${hooks} } });
        `,
        "entry.cjs": `console.log("the entry point of the command line ran");`,
        "other.cjs": `
          const atLoad = [require.main === module, process.mainModule === module].join();
          ${purge}
          console.log(atLoad, require.main === module, process.mainModule === module);
        `,
      };
      expect(await run(files, "-r", "preload.cjs", "entry.cjs")).toEqual(prints("true,true true true"));
    });

    // The `preload` option is how a preload runs in a Worker. Node prints the same with `execArgv: ["-r", preload]`.
    it.concurrent.each(["the program", "a Worker"])(
      "is the entry point of %s although a preload read process.mainModule before",
      async where => {
        const files = {
          "preload.cjs": `globalThis.seenByPreload = [typeof process.mainModule, typeof require.main].join();`,
          "entry.cjs": `
            const atLoad = [process.mainModule === module, require.main === module].join();
            ${purge}
            console.log(globalThis.seenByPreload, atLoad, process.mainModule === module, require.main === module);
          `,
          "starts-worker.cjs": `new Worker(require.resolve("./entry.cjs"), { preload: [require.resolve("./preload.cjs")] });`,
        };
        const args = where === "a Worker" ? ["starts-worker.cjs"] : ["-r", "preload.cjs", "entry.cjs"];
        expect(await run(files, ...args)).toEqual(prints("undefined,undefined true,true true true"));
      },
    );

    it.concurrent.each([
      ["bun test", 1],
      ["bun test --isolate=modules --rerun-each=2", 2],
    ])(
      "is as before in a test file of `%s`, and the entry point in a Worker that the test file starts",
      async (command, runs) => {
        // The main module of a test run is what the cache holds under the path of the test file at every read:
        // test/aot/the-main-module-of-a-test-run.test.ts.
        const files = {
          "evicted.test.cjs": `
          test("leaves the cache", async () => {
            const before = [require.main === module, process.mainModule === module].join();
            delete require.cache[__filename];
            const worker = new Worker(require.resolve("./worker.cjs"));
            const ofWorker = await new Promise((resolve, reject) => {
              worker.onmessage = event => resolve(event.data);
              worker.onerror = reject;
            });
            console.log("test file:", before, typeof require.main, typeof process.mainModule, "worker:", ofWorker);
          });
        `,
          "worker.cjs": `
          ${purge}
          postMessage([require.main === module, process.mainModule === module].join());
        `,
        };
        const { stdout, exitCode } = await run(files, ...command.split(" ").slice(1), "evicted.test.cjs");
        expect(stdout.split("\n").filter(line => line.startsWith("test file:"))).toEqual(
          Array(runs).fill("test file: true,true undefined undefined worker: true,true"),
        );
        expect(exitCode).toBe(0);
      },
    );

    it.concurrent("is what the cache holds for the text of -e, as before", async () => {
      // Node has no main module for -e. Bun has the module of the text, and it goes with its key.
      const text = `const before = typeof require.main; ${purge} console.log(before, typeof require.main, typeof process.mainModule);`;
      expect(await bunRun(["-e", text])).toEqual(prints("object undefined undefined"));
    });

    it.concurrent(
      "follows a path stored into Bun.main, and is the entry point again with its path stored back",
      async () => {
        const files = {
          "entry.cjs": `
          const helper = require("./helper.cjs");
          const name = m => (m ? require("node:path").basename(m.filename) : String(m));
          const ask = () => [name(require.main), name(helper.main()), name(process.mainModule)].join();
          const path = Bun.main;
          Bun.main = require.resolve("./helper.cjs");
          const stored = ask();
          ${purge}
          const purged = ask();
          Bun.main = path;
          console.log(JSON.stringify({ stored, purged, storedBack: ask() }));
        `,
          "helper.cjs": `exports.main = () => require.main;`,
        };
        expect(await run(files, "entry.cjs")).toEqual(
          prints(
            JSON.stringify({
              stored: "helper.cjs,helper.cjs,helper.cjs",
              purged: "undefined,undefined,undefined",
              storedBack: "entry.cjs,entry.cjs,entry.cjs",
            }),
          ),
        );
      },
    );

    it.concurrent("is what the cache holds under the key of an entry point that is an ES module", async () => {
      // No CommonJS module runs for such an entry point, so nothing is stored for it, and a require() of it gives the
      // cache an entry as before. Node has no main module in such a program: it prints `undefined` in all six places.
      const files = {
        "entry.mjs": `
          import "./dep.cjs";
          export const marker = "exported by the entry point";
        `,
        "dep.cjs": `
          const Module = require("node:module");
          const entry = require.resolve("./entry.mjs");
          setImmediate(() => {
            const seen = [typeof require.main];
            // A module of the same name that the cache does not hold, as the package require-from-string makes one.
            const sameName = new Module(entry);
            sameName.filename = entry;
            sameName._compile("module.exports = 1;", entry);
            seen.push(typeof require.main);
            seen.push(require("./entry.mjs").marker, typeof require.main, typeof process.mainModule);
            delete require.cache[entry];
            seen.push(typeof require.main, typeof process.mainModule);
            console.log(seen.join());
          });
        `,
      };
      expect(await run(files, "entry.mjs")).toEqual(
        prints("undefined,undefined,exported by the entry point,object,object,undefined,undefined"),
      );
    });

    it.concurrent("is kept alive by the loader alone", async () => {
      // After the purge nothing else refers to the module of the entry point: a child holds its parent weakly.
      const files = {
        "entry.cjs": `
          exports.marker = "exported by the entry point";
          require("./later.cjs");
        `,
        "later.cjs": `
          const entry = require.resolve("./entry.cjs");
          setImmediate(() => {
            for (let i = 0; i < 3; i++) {
              ${purge}
              require("./filler.cjs");
              Bun.gc(true);
            }
            console.log(require.main.filename === entry, require.main.exports.marker, require.main.loaded);
          });
        `,
        "filler.cjs": `module.exports = Array.from({ length: 1000 }, (_, i) => ({ i }));`,
      };
      expect(await run(files, "entry.cjs")).toEqual(prints("true exported by the entry point true"));
    });
  });
});
