import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case builds and runs in a folder of its own. One after the other they take longer than CI gives a file on the lane with assertions,
// and at once they still take about that long there: so they are dealt out over four files, by the time that they take.
const test = oneAtATime.concurrent;

test("code at the top level of a test file takes a file out of require.cache", async () => {
  const born = (name: string) =>
    `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;
  const head = `
      import { test } from "bun:test";
      import * as user from "./user.js";
      import * as lazy from "./lazy.js";
      const isListed = () => require.resolve("./state.js") in require.cache;`;
  await expectCompiledToRunAsPlain(
    {
      "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
      "user.js": `import { bump } from "./state.js";\n${born("user")}export function viaUser() { return me + " > " + bump(); }`,
      "lazy.js": `${born("lazy")}export async function viaLazy() { return me + " > " + (await import("./state.js")).bump(); }`,
      "behind-an-await.test.js": `${head}
      console.log(isListed(), user.viaUser(), await lazy.viaLazy());
      delete require.cache[require.resolve("./state.js")];
      console.log(isListed(), user.viaUser(), await lazy.viaLazy(), isListed());
      test("behind the top level", async () => console.log(user.viaUser(), await lazy.viaLazy()));`,
      "before-the-first-await.test.js": `${head}
      delete require.cache[require.resolve("./state.js")];
      console.log(isListed(), user.viaUser(), await lazy.viaLazy(), isListed());
      test("behind the top level", async () => console.log(user.viaUser(), await lazy.viaLazy()));`,
      "a-copy-under-a-query.test.js": `${head}
      delete require.cache[require.resolve("./state.js")];
      const copy = await import("./user.js?0");
      console.log(user.viaUser(), copy.viaUser(), await lazy.viaLazy());
      test("behind the top level", async () => console.log(user.viaUser(), copy.viaUser(), await lazy.viaLazy()));`,
    },
    "--isolate",
  );
});

test("require.cache lists files alone, and a loop over it takes all of them out", async () => {
  const born = (name: string) =>
    `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;
  const head = `
      import { test } from "bun:test";
      const keys = () => Object.keys(require.cache).map(key => key.replace(/.*\\//, "")).sort().join(" ");
      const clear = () => { for (const key in require.cache) delete require.cache[key]; };`;
  await expectCompiledToRunAsPlain(
    {
      "state.js": `${born("state")}export function bump() { return me + ":" + ++calls; }`,
      "statec.cjs": `${born("statec")}exports.bump = function () { return me + ":" + ++calls; };`,
      "user.js": `import { bump } from "./state.js";\n${born("user")}export function viaUser() { return me + " > " + bump(); }`,
      "mixed.js": `import { bump } from "./statec.cjs";\n${born("mixed")}export function viaMixed() { return me + " > " + bump(); }`,
      "barrel.js": `export * from "./state.js";\nexport { bump as bumpC } from "./statec.cjs";\nexport { viaUser } from "./user.js";`,
      "an-importer-of-a-commonjs-file.test.js": `${head}
      import * as mixed from "./mixed.js";
      test("cleared twice", () => {
        console.log(keys());
        clear();
        console.log(keys(), mixed.viaMixed(), require("./mixed.js").viaMixed());
        console.log(keys());
        clear();
        console.log(keys());
      });`,
      "a-barrel-over-both-kinds.test.js": `${head}
      import * as barrel from "./barrel.js";
      test("cleared by its keys", () => {
        console.log(keys());
        Object.keys(require.cache).forEach(key => { delete require.cache[key]; });
        const again = require("./barrel.js");
        console.log(keys(), barrel.bumpC(), again.bumpC(), barrel.viaUser(), again.viaUser());
      });`,
    },
    "--isolate",
  );
});

// Code that imports a file is compiled for a file that loads once, unless the build sees the file taken out. What the build cannot see fails, and says so.
test("a file that only code from disk takes out stays, and the delete throws", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "state.ts": `export let count = 0;\nexport function bump() { return ++count; }`,
    "never-loaded.ts": `export const unused = 1;`,
    "one.test.ts": `
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { bump } from "./state";
      test("refused", async () => {
        const written = join(import.meta.dir, "written-" + process.pid + ".cjs");
        writeFileSync(written, "module.exports = path => delete require.cache[path];");
        const takeOut = require(written);
        bump();
        let message = "";
        try { takeOut(require.resolve("./state")); } catch (error) { message = (error as Error).message; }
        console.log(message.replaceAll(import.meta.dir, "").replaceAll("\\\\", "/"));
        console.log(bump(), (await import("./state")).count);
        console.log(takeOut(require.resolve("./never-loaded")), takeOut(written), takeOut("/nowhere.js"));
      });`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect({ stdout: stdout.split("\n").slice(1), stderr: exitCode ? stderr : "", exitCode }).toEqual({
    stdout: [
      `Cannot take '/state.ts' out of require.cache: the build found nothing that does, so the code that imports it was compiled for a module that loads once. Spell the path where it is deleted, in a file that the tests import: delete require.cache[require.resolve("./module")]`,
      "2 2",
      "true true true",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

test("the key of a delete may come by a name, a helper or a path that is put together", async () => {
  await expectCompiledToRunAsPlain({
    "a.cjs": `globalThis.a = (globalThis.a ?? 0) + 1;\nmodule.exports = globalThis.a;`,
    "b.cjs": `globalThis.b = (globalThis.b ?? 0) + 1;\nmodule.exports = globalThis.b;`,
    "c.cjs": `globalThis.c = (globalThis.c ?? 0) + 1;\nmodule.exports = globalThis.c;`,
    "kept.cjs": `globalThis.kept = (globalThis.kept ?? 0) + 1;\nmodule.exports = globalThis.kept;`,
    "fresh.ts": `export function fresh(name: string) { delete require.cache[require.resolve(name)]; return require(name); }`,
    "named.test.ts": `
      import { test } from "bun:test";
      test("a name", () => {
        const first = require.resolve("./a.cjs");
        const key = first;
        console.log(require("./a.cjs"), require("./kept.cjs"));
        delete require.cache[key as string];
        console.log(require("./a.cjs"), require("./kept.cjs"));
      });`,
    "helper.test.ts": `
      import { test } from "bun:test";
      import { join } from "node:path";
      import { fresh } from "./fresh";
      test("a helper", () => { console.log(require("./b.cjs"), fresh(join(import.meta.dir, "b.cjs")), fresh(join(import.meta.dir, "b.cjs"))); });
      test("a path", () => {
        console.log(require("./c.cjs"));
        delete require.cache[join(import.meta.dir, "c" + ".cjs")];
        console.log(require("./c.cjs"));
      });`,
  });
});

// The image of a test file and the layer that it shares with the others may both hold a file. The copy that has run is the one to take out.
test("a file that a layer below holds too is taken out of require.cache", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "helpers/evicted.js": `export let count = 0;\nexport const bump = () => ++count;`,
    "helpers/imports-evicted.js": `import { bump, count } from "./evicted.js";\nexport const seenWhenLoaded = count;\nexport const next = () => bump();`,
    "evicts.test.js": `
      import { test } from "bun:test";
      test("evicts", async () => {
        const path = require.resolve("./helpers/evicted.js");
        const first = require(path); first.bump(); first.bump();
        delete require.cache[path];
        const second = require(path);
        console.log(first.count, second.count, first === second);
        const late = await import("./helpers/imports-evicted.js");
        console.log(late.seenWhenLoaded, late.next(), first.count, second.count);
      });`,
    // Puts helpers/evicted.js into the layer that the test files share.
    "imports.test.js": `import { test } from "bun:test";\nimport "./helpers/imports-evicted.js";\ntest("imports", () => {});`,
    "third.test.js": `import { test } from "bun:test";\ntest("third", () => {});`,
  });
  const seen = async (words?: string, ...flags: string[]) => {
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    return { stdout, exitCode };
  };
  const plain = await seen();
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("2 0 false");
  for (const words of [undefined, "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:1,TestRunPartFiles:1"])
    expect(await seen(words, "--aot")).toEqual(plain);
});

// The stage log says why every file of a run may load again, so that nobody has to guess what keeps a large run open.
test("a file that is loaded under a query: every file may load again, and only that file where the host runs the test files", async () => {
  using dir = tempDir("require-cache-in-test-runs", {
    "src/base.js": `export const base = "base";`,
    "src/state.js": `import { base } from "./base.js";\nexport let count = 0;\nexport function bump() { return ++count; }\nexport const from = base;`,
    "src/other.js": `export function other(n) { return n * 2; }`,
    "helper.js": "let n = 0;\nexport async function fresh() { return import(`./src/state.js?fresh=${n++}`); }",
    "one.test.js": `
      import { test } from "bun:test";
      import { fresh } from "./helper.js";
      import { other } from "./src/other.js";
      import { bump } from "./src/state.js";
      test("fresh", async () => {
        bump();
        const [first, second] = [await fresh(), await fresh()];
        console.log(bump(), first.bump(), second.bump(), first.from, other(2), first === second);
      });`,
  });
  const test = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    const why = [...stderr.matchAll(/^AOT test run \| every file may load again: (?:.*[\\/])?(.*)$/gm)].map(
      match => match[1],
    );
    return { printed: stdout.split("\n")[1], why: [...new Set(why)].sort(), exitCode };
  };
  const printed = "2 1 1 base 4 false";
  const logs = { BUN_JSC_logAOTPhaseTimes: "1" };
  expect(await test({})).toEqual({ printed, why: [], exitCode: 0 });
  expect(await test(logs, "--aot")).toEqual({
    printed,
    why: ["helper.js loads a file under a query", "the scan of the test files says so"],
    exitCode: 0,
  });
  const hostRunsTestFiles = { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };
  expect(await test({ ...logs, ...hostRunsTestFiles }, "--aot")).toEqual({ printed, why: [], exitCode: 0 });
});
