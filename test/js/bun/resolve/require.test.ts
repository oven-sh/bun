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

  // Like Node, a module that throws while it is being evaluated is dropped from
  // the cache, and the next require() of it runs the file again. The fixtures
  // below have no CommonJS or ES module syntax on purpose: Bun loads such files
  // through the ES module registry, which also holds CommonJS files that were
  // first reached via import() and modules provided by plugins. A failed entry
  // in that registry used to make every later require() rethrow the stored
  // error without running the module again.
  describe.concurrent("when the module throws while being evaluated", () => {
    // Throws the first `failures` times it is evaluated and succeeds afterwards.
    const flakyModule = (failures: number) => /* js */ `
      globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
      if (globalThis.evaluations <= ${failures}) throw new Error("fail " + globalThis.evaluations);
    `;

    async function runEntry(files: Record<string, string>) {
      using dir = tempDir("require-throwing-module", files);
      const { stdout, stderr, exitCode } = await bunRun(path.join(String(dir), "entry.js"));
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    it("the next require() evaluates it again until it succeeds", async () => {
      const result = await runEntry({
        "flaky.js": flakyModule(2),
        "entry.js": /* js */ `
          const id = require.resolve("./flaky.js");
          const attempts = [];
          for (let i = 0; i < 4; i++) {
            let outcome;
            try {
              require("./flaky.js");
              outcome = "ok";
            } catch (e) {
              outcome = e.message;
            }
            attempts.push({ outcome, cached: id in require.cache });
          }
          console.log(JSON.stringify({ attempts, evaluations: globalThis.evaluations }));
        `,
      });
      expect(result).toEqual({
        attempts: [
          { outcome: "fail 1", cached: false },
          { outcome: "fail 2", cached: false },
          { outcome: "ok", cached: true },
          { outcome: "ok", cached: true },
        ],
        evaluations: 3,
      });
    });

    it("require() evaluates a CommonJS module again after import() of it failed", async () => {
      const result = await runEntry({
        "flaky.js": flakyModule(1) + `module.exports = { attempt: globalThis.evaluations };`,
        "entry.js": /* js */ `
          (async () => {
            let importOutcome, requireOutcome;
            try {
              await import("./flaky.js");
              importOutcome = "ok";
            } catch (e) {
              importOutcome = e.message;
            }
            try {
              requireOutcome = require("./flaky.js");
            } catch (e) {
              requireOutcome = e.message;
            }
            console.log(JSON.stringify({ importOutcome, requireOutcome, evaluations: globalThis.evaluations }));
          })();
        `,
      });
      expect(result).toEqual({ importOutcome: "fail 1", requireOutcome: { attempt: 2 }, evaluations: 2 });
    });

    it("require() evaluates it again after it threw as a dependency of an imported module", async () => {
      const result = await runEntry({
        "flaky.js": flakyModule(1),
        "parent.mjs": `import "./flaky.js";`,
        "entry.js": /* js */ `
          (async () => {
            let importOutcome, requireOutcome;
            try {
              await import("./parent.mjs");
              importOutcome = "ok";
            } catch (e) {
              importOutcome = e.message;
            }
            try {
              require("./flaky.js");
              requireOutcome = "ok";
            } catch (e) {
              requireOutcome = e.message;
            }
            console.log(JSON.stringify({ importOutcome, requireOutcome, evaluations: globalThis.evaluations }));
          })();
        `,
      });
      expect(result).toEqual({ importOutcome: "fail 1", requireOutcome: "ok", evaluations: 2 });
    });

    it("a module provided by a plugin is evaluated again by the next require()", async () => {
      const result = await runEntry({
        "entry.js": /* js */ `
          Bun.plugin({
            name: "flaky virtual module",
            setup(build) {
              build.module("virtual:flaky", () => ({
                loader: "js",
                contents: ${JSON.stringify(flakyModule(1) + `export const attempt = globalThis.evaluations;`)},
              }));
            },
          });
          const attempts = [];
          for (let i = 0; i < 2; i++) {
            try {
              attempts.push(require("virtual:flaky").attempt);
            } catch (e) {
              attempts.push(e.message);
            }
          }
          console.log(JSON.stringify({ attempts, evaluations: globalThis.evaluations }));
        `,
      });
      expect(result).toEqual({ attempts: ["fail 1", 2], evaluations: 2 });
    });

    it("calling require.extensions['.js'] directly evaluates it again", async () => {
      const result = await runEntry({
        "flaky.js": flakyModule(1),
        "entry.js": /* js */ `
          const Module = require("node:module");
          const filename = require.resolve("./flaky.js");
          const attempts = [];
          for (let i = 0; i < 2; i++) {
            const mod = new Module(filename);
            mod.filename = filename;
            try {
              require.extensions[".js"](mod, filename);
              attempts.push("ok");
            } catch (e) {
              attempts.push(e.message);
            }
          }
          console.log(JSON.stringify({ attempts, evaluations: globalThis.evaluations }));
        `,
      });
      expect(result).toEqual({ attempts: ["fail 1", "ok"], evaluations: 2 });
    });

    // Only require() retries. An ES module that failed stays failed for
    // import(), which rejects with the error the module threw, as in Node.
    it("import() of an ES module that failed under require() still rejects with the original error", async () => {
      const result = await runEntry({
        "bad.mjs": flakyModule(Infinity),
        "entry.js": /* js */ `
          (async () => {
            let requireError, importError;
            try {
              require("./bad.mjs");
            } catch (e) {
              requireError = e;
            }
            try {
              await import("./bad.mjs");
            } catch (e) {
              importError = e;
            }
            console.log(JSON.stringify({
              requireError: requireError.message,
              importRejectsWithSameError: importError === requireError,
              evaluations: globalThis.evaluations,
            }));
          })();
        `,
      });
      expect(result).toEqual({ requireError: "fail 1", importRejectsWithSameError: true, evaluations: 1 });
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
