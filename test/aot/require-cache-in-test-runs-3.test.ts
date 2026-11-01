import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case builds and runs in a folder of its own. One after the other they take longer than CI gives a file on the lane with assertions,
// and at once they still take about that long there: so they are dealt out over four files, by the time that they take.
const test = oneAtATime.concurrent;

const looksAtFiles = {
  "src/look.cjs": `
    exports.look = function look(path) {
      const name = path.replace(/.*[\\\\/]/, "");
      const entry = require.cache[path];
      const listed = [Object.keys(require.cache).includes(path), path in require.cache].join();
      if (!entry) return [name, listed, entry].join(" ");
      let names;
      try { names = Object.keys(entry.exports).join("+"); } catch (error) { names = error.name; }
      return [name, listed, "exports", "[" + names + "]", require.cache[path] === entry].join(" ");
    };`,
};
const commonJSFileThatLooksAtItself = `
  const { look } = require("./look.cjs");
  exports.early = 1;
  exports.seen = [look(__filename), require.cache[__filename] === module, require.cache[__filename]?.exports === exports].join(" ");
  exports.later = () => [look(__filename), require.cache[__filename] === module].join(" ");`;
const moduleThatLooksAtItself = (name: string) => `
  import { look } from "./look.cjs";
  export const early = 1;
  const whileItRan = require.cache[require.resolve("./${name}")];
  export const seen = look(require.resolve("./${name}"));
  export const later = () => [look(require.resolve("./${name}")), whileItRan === undefined || whileItRan === require.cache[require.resolve("./${name}")]].join(" ");`;

async function expectCompiledToRunAsPlainInLayersToo(files: Record<string, string>) {
  using dir = tempDir("require-cache-in-test-runs", files);
  const seen = async (words?: string, ...flags: string[]) => {
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    return { stdout, exitCode };
  };
  const plain = await seen();
  expect(plain.exitCode).toBe(0);
  for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])
    expect(await seen(words, "--aot")).toEqual(plain);
}

test("a CommonJS file finds its own module in require.cache while it runs, whoever has begun it", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/in-function.cjs": commonJSFileThatLooksAtItself,
    "src/at-top.cjs": commonJSFileThatLooksAtItself,
    "src/imported.cjs": commonJSFileThatLooksAtItself,
    "src/imported-below.cjs": commonJSFileThatLooksAtItself,
    "src/imported-late.cjs": commonJSFileThatLooksAtItself,
    "src/under-module.cjs": commonJSFileThatLooksAtItself,
    "src/imports-file.ts": `import file from "./imported-below.cjs";\nexport const seen = file.seen;`,
    "src/requires-file.ts": `export const seen = require("./under-module.cjs").seen;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import imported from "./src/imported.cjs";
      import { seen as below } from "./src/imports-file";
      const atTop = require("./src/at-top.cjs");
      test("each way to begin it", async () => {
        const inFunction = require("./src/in-function.cjs");
        console.log(inFunction.seen);
        console.log(inFunction.later());
        console.log(atTop.seen);
        console.log(imported.seen);
        console.log(imported.later());
        console.log(below);
        console.log((await import("./src/imported-late.cjs")).default.seen);
        console.log(require("./src/requires-file").seen);
      });`,
  });
});

test("an ES module is listed while it runs if a require() has begun it, and not if an import has", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/in-function.ts": moduleThatLooksAtItself("in-function.ts"),
    "src/at-top.ts": moduleThatLooksAtItself("at-top.ts"),
    "src/imported.ts": moduleThatLooksAtItself("imported.ts"),
    "src/imported-late.ts": moduleThatLooksAtItself("imported-late.ts"),
    "src/under-file.ts": moduleThatLooksAtItself("under-file.ts"),
    "src/under-module.ts": moduleThatLooksAtItself("under-module.ts"),
    "src/file-requires.cjs": `exports.seen = require("./under-file.ts").seen;`,
    "src/module-requires.ts": `const inner = require("./under-module.ts");\nexport const seen = inner.seen;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { seen as imported, later as importedLater } from "./src/imported";
      const atTop = require("./src/at-top");
      test("each way to begin it", async () => {
        const inFunction = require("./src/in-function");
        console.log(inFunction.seen);
        console.log(inFunction.later());
        console.log(atTop.seen);
        console.log(atTop.later());
        console.log(imported);
        console.log(importedLater());
        console.log((await import("./src/imported-late")).seen);
        console.log(require("./src/file-requires.cjs").seen);
        console.log(require("./src/module-requires").seen);
      });`,
  });
});

test("what a required ES module imports sees that module listed, and not itself", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/root.ts": `import { seen as below } from "./below-root";\nexport const seen = below;`,
    "src/below-root.ts": `import { look } from "./look.cjs";\nexport const seen = [look(require.resolve("./below-root")), look(require.resolve("./root"))].join(" | ");`,
    "src/root-with-nothing-to-run.ts": `export { seen } from "./below-nothing";\nexport const constant = 1;`,
    "src/below-nothing.ts": `import { look } from "./look.cjs";\nexport const seen = look(require.resolve("./root-with-nothing-to-run"));`,
    "one.test.ts": `
      import { test } from "bun:test";
      test("below a require()", () => {
        console.log(require("./src/root").seen);
        console.log(require("./src/root-with-nothing-to-run").seen);
      });`,
  });
});

test("files that require each other are all listed while the innermost runs", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/outer.ts": `const inner = require("./inner");\nexport const seen = inner.seen;`,
    "src/inner.ts": `import { look } from "./look.cjs";\nexport const seen = [look(require.resolve("./outer")), look(require.resolve("./inner"))].join(" | ");`,
    "src/outer.cjs": `exports.before = 1;\nexports.seen = require("./inner.cjs").seen;`,
    "src/inner.cjs": `const { look } = require("./look.cjs");\nexports.seen = [look(require.resolve("./outer.cjs")), look(__filename)].join(" | ");`,
    "src/ring-first.ts": `const second = require("./ring-second");\nexport const first = 1;\nexport const seen = second.seen;`,
    "src/ring-second.ts": `
      import { look } from "./look.cjs";
      const first = require("./ring-first");
      export const seen = [Object.keys(first).join("+"), require.cache[require.resolve("./ring-first")].exports === first, look(require.resolve("./ring-first"))].join(" ");`,
    "src/ring-first.cjs": `exports.first = 1;\nexports.seen = require("./ring-second.cjs").seen;`,
    "src/ring-second.cjs": `
      const { look } = require("./look.cjs");
      const first = require("./ring-first.cjs");
      exports.seen = [Object.keys(first).join("+"), require.cache[require.resolve("./ring-first.cjs")].exports === first, look(require.resolve("./ring-first.cjs"))].join(" ");`,
    "one.test.ts": `
      import { test } from "bun:test";
      test("one below the other", () => {
        console.log(require("./src/outer").seen);
        console.log(require("./src/outer.cjs").seen);
      });
      test("in a ring", () => {
        console.log(require("./src/ring-first").seen);
        console.log(require("./src/ring-first.cjs").seen);
      });`,
  });
});

test("an ES module that an import has begun is listed from the first require() of it", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/importer.ts": `
      import { seen as below } from "./requires-importer";
      import { look } from "./look.cjs";
      export const value = 1;
      export const seen = [below, look(require.resolve("./importer"))].join(" | ");`,
    "src/requires-importer.ts": `
      import { look } from "./look.cjs";
      const before = look(require.resolve("./importer"));
      require("./importer");
      export const seen = [before, look(require.resolve("./importer"))].join(" | ");`,
    "statement.test.ts": `
      import { test } from "bun:test";
      import { seen } from "./src/importer";
      test("an import statement", () => { console.log(seen); });`,
    "call.test.ts": `
      import { test } from "bun:test";
      test("import()", async () => { console.log((await import("./src/importer")).seen); });`,
  });
});

test("a file that throws while it is required was listed until then, and is not afterwards", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/throws.cjs": `globalThis.seenByFile = require("./look.cjs").look(__filename);\nthrow new Error("from the file");`,
    "src/throws.ts": `
      import { look } from "./look.cjs";
      (globalThis as any).seenByModule = look(require.resolve("./throws.ts"));
      throw new Error("from the module");
      export {};`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      const message = (load: () => void) => { try { load(); return "no error"; } catch (error) { return error.message; } };
      test("a CommonJS file", () => {
        console.log(message(() => require("./src/throws.cjs")), "|", (globalThis as any).seenByFile, "|", look(require.resolve("./src/throws.cjs")));
      });
      test("an ES module", () => {
        for (const turn of [1, 2])
          console.log(turn, message(() => require("./src/throws.ts")), "|", (globalThis as any).seenByModule, "|", look(require.resolve("./src/throws.ts")));
      });`,
  });
});

test("a file that takes itself out of require.cache while it runs: a CommonJS file runs again, an ES module does not", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/file.cjs": `
      const { look } = require("./look.cjs");
      globalThis.runsOfFile = (globalThis.runsOfFile ?? 0) + 1;
      const before = look(__filename);
      delete require.cache[__filename];
      exports.seen = [globalThis.runsOfFile, before, look(__filename)].join(" | ");`,
    "src/module.ts": `
      import { look } from "./look.cjs";
      const realm = globalThis as any;
      realm.runsOfModule = (realm.runsOfModule ?? 0) + 1;
      const path = require.resolve("./module.ts");
      const before = look(path);
      delete require.cache[path];
      export const seen = [realm.runsOfModule, before, look(path)].join(" | ");`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      test("a CommonJS file", () => {
        for (const turn of [1, 2]) console.log(turn, require("./src/file.cjs").seen, "|", look(require.resolve("./src/file.cjs")));
      });
      test("an ES module", () => {
        for (const turn of [1, 2]) console.log(turn, require("./src/module.ts").seen, "|", look(require.resolve("./src/module.ts")));
      });`,
  });
});

test("an ES module whose import fails behind a require() of it that has returned stays listed, and require() answers", async () => {
  await expectCompiledToRunAsPlainInLayersToo({
    ...looksAtFiles,
    "src/fails.ts": `import "./requires-what-fails";\nthrow new Error("fails");\nexport const value = 1;`,
    "src/requires-what-fails.ts": `require("./fails");\nexport const below = 1;`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { look } from "./src/look.cjs";
      test("import(), then require()", async () => {
        console.log(await import("./src/fails").then(() => "no error", error => error.message), "|", look(require.resolve("./src/fails")));
        let message = "no error";
        try { require("./src/fails"); } catch (error) { message = error.message; }
        console.log(message, "|", look(require.resolve("./src/fails")));
      });`,
  });
});
