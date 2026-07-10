import { bunEnv, bunExe, bunRun, tempDir, tempDirWithFiles } from "harness";
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

  describe("when specifier is an ES module whose graph uses top-level await", () => {
    // Node's require(esm) refuses any graph that contains top-level await with
    // ERR_REQUIRE_ASYNC_MODULE, regardless of whether the awaited value would
    // settle on microtasks alone. Loaders catch this code to fall back to
    // import(). https://nodejs.org/api/errors.html#err_require_async_module
    const tlaShapes = {
      "await that needs the event loop": `await new Promise(resolve => setTimeout(resolve, 1));`,
      "await of an already-settled promise": `await Promise.resolve(0);`,
      "await of a non-thenable": `await 0;`,
    };

    it.each(Object.entries(tlaShapes))("throws ERR_REQUIRE_ASYNC_MODULE for %s", (_, awaitExpr) => {
      using dir = tempDir("require-tla", {
        "tla.mjs": `${awaitExpr}\nexport const value = 1;\n`,
      });
      const specifier = path.join(String(dir), "tla.mjs");

      let error: any;
      try {
        require(specifier);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error.name).toBe("Error");
      expect(error.code).toBe("ERR_REQUIRE_ASYNC_MODULE");
      expect(error.message).toContain(require.resolve(specifier));
    });

    it.each(Object.entries(tlaShapes))(
      "throws ERR_REQUIRE_ASYNC_MODULE when a transitive dependency has %s",
      (_, awaitExpr) => {
        using dir = tempDir("require-transitive-tla", {
          "leaf.mjs": `${awaitExpr}\nexport const value = 1;\n`,
          "middle.mjs": `export { value } from "./leaf.mjs";\n`,
        });
        const specifier = path.join(String(dir), "middle.mjs");

        let error: any;
        try {
          require(specifier);
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe("ERR_REQUIRE_ASYNC_MODULE");
      },
    );

    it("throws ERR_REQUIRE_ASYNC_MODULE even when the module was already evaluated via import()", async () => {
      using dir = tempDir("require-tla-after-import", {
        "tla.mjs": `await Promise.resolve(0);\nexport const value = 7;\n`,
        "entry.cjs": `(async () => {
          const ns = await import("./tla.mjs");
          if (ns.value !== 7) throw new Error("import failed");
          try {
            require("./tla.mjs");
            console.log("returned");
          } catch (e) {
            console.log("threw", e.code ?? e.name);
          }
        })();`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("threw ERR_REQUIRE_ASYNC_MODULE");
      expect(exitCode).toBe(0);
    });

    it("throws ERR_REQUIRE_ASYNC_MODULE for an intermediate module whose TLA dependency was pre-imported", async () => {
      // An Evaluated parent whose TLA leaf completed in an earlier pass has
      // [[AsyncEvaluationOrder]] Unset (the leaf's order is DONE, not an
      // integer, so PendingAsyncDependencies stays 0); the graph walk must
      // still reach the leaf's [[HasTLA]].
      using dir = tempDir("require-tla-preimported-leaf", {
        "leaf.mjs": `await Promise.resolve(0);\nexport const v = 1;\n`,
        "middle.mjs": `export { v } from "./leaf.mjs";\n`,
        "entry.cjs": `(async () => {
          await import("./leaf.mjs");
          try {
            require("./middle.mjs");
            console.log("returned");
          } catch (e) {
            console.log("threw", e.code ?? e.name);
          }
        })();`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("threw ERR_REQUIRE_ASYNC_MODULE");
      expect(exitCode).toBe(0);
    });

    it("evaluates the graph exactly once across a rejected require() and a subsequent import()", async () => {
      using dir = tempDir("require-tla-eval-once", {
        "leaf.mjs": `globalThis.__ticks.push("leaf");\nawait Promise.resolve(0);\nexport const y = 1;\n`,
        "root.mjs": `import { y } from "./leaf.mjs";\nglobalThis.__ticks.push("root");\nexport const x = y + 6;\n`,
        "entry.cjs": `globalThis.__ticks = [];
          let code = "no-throw";
          try { require("./root.mjs"); } catch (e) { code = e.code ?? e.name; }
          (async () => {
            const ns = await import("./root.mjs");
            console.log(JSON.stringify({ code, ticks: globalThis.__ticks, x: ns.x }));
          })();`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        code: "ERR_REQUIRE_ASYNC_MODULE",
        ticks: ["leaf", "root"],
        x: 7,
      });
      expect(exitCode).toBe(0);
    });

    it("still loads an ES module whose graph is entirely synchronous", () => {
      using dir = tempDir("require-esm-sync", {
        "sync.mjs": `export const value = 42;\n`,
      });
      const ns = require(path.join(String(dir), "sync.mjs"));
      expect(ns.value).toBe(42);
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
