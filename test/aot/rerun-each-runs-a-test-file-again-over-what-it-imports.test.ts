// `bun test --rerun-each=N` loads a test file N times in one realm. Each load is a new module of the file, and what the file imports
// is loaded once. Each project runs under plain `bun test` and compiled, and both must print and pass alike.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const projects: Record<string, Record<string, string>> = {
  "a module that the test file imports keeps its state": {
    "counter.ts": `export let loads = 0; loads++;\nexport const state = { calls: 0 };`,
    "rerun.test.ts": `
      import { afterAll, beforeAll, test } from "bun:test";
      import { loads, state } from "./counter.ts";
      let here = 0;
      beforeAll(() => console.log("beforeAll"));
      afterAll(() => console.log("afterAll", here, state.calls, loads));
      test("counts", () => { here++; state.calls++; console.log("run", here, state.calls); });`,
  },
  "a module that only a module of the test file imports keeps its state": {
    "deep.ts": `export const state = { calls: 0 };\nconsole.log("deep loads");`,
    "names.ts": `export * from "./deep.ts";`,
    "middle.ts": `import { state } from "./names.ts";\nconsole.log("middle loads");\nexport const bump = () => ++state.calls;`,
    "rerun.test.ts": `
      import { test } from "bun:test";
      import { bump } from "./middle.ts";
      test("counts", () => { console.log("run", bump()); });`,
  },
  "what an earlier run left behind goes on with the variables of that run": {
    "kept.ts": `export const kept: (() => string)[] = [];`,
    "closures.test.ts": `
      import { test } from "bun:test";
      import { kept } from "./kept.ts";
      let here = kept.length * 10;
      var plain; plain = (plain ?? 0) + 1;
      function bump() { return ++here; }
      class Box { static made = 0; id = ++Box.made; }
      (bump as any).calls = ((bump as any).calls ?? 0) + 1;
      const table = { hits: 0 };
      kept.push(() => [here, plain, Box.made, (bump as any).calls, ++table.hits].join(" "));
      test("reads", () => { bump(); new Box(); console.log("run", kept.map(read => read()).join(" | ")); });`,
  },
  "a class and a function of each run are new ones": {
    "kept.ts": `export const classes: any[] = [], functions: any[] = [], objects: any[] = [];`,
    "identity.test.ts": `
      import { test } from "bun:test";
      import { classes, functions, objects } from "./kept.ts";
      class Point { constructor(public x = 1) {} get double() { return this.x * 2; } }
      function make() { return new Point(functions.length); }
      classes.push(Point); functions.push(make); objects.push(make());
      test("compares", () => {
        console.log("run", new Set(classes).size, new Set(functions).size, objects.map(object => object instanceof Point).join(), objects.map(object => object.double).join());
      });`,
  },
  "test files share a realm, and each runs again over what the others left": {
    "shared.ts": `export const state = { calls: 0 };`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { state } from "./shared.ts";
      (globalThis as any).seen = ((globalThis as any).seen ?? 0) + 1;
      test("one", () => { state.calls++; console.log("run one", state.calls, (globalThis as any).seen); });`,
    "two.test.ts": `
      import { test } from "bun:test";
      import { state } from "./shared.ts";
      (globalThis as any).seen = ((globalThis as any).seen ?? 0) + 1;
      test("two", () => { state.calls++; console.log("run two", state.calls, (globalThis as any).seen); });`,
  },
  "a timer of an earlier run fires while the file waits at its top level": {
    "log.ts": `export const log: string[] = [];`,
    "waits.test.ts": `
      import { test } from "bun:test";
      import { log } from "./log.ts";
      const run = log.filter(line => line.startsWith("start")).length + 1;
      log.push("start" + run);
      const timer = setInterval(() => { try { log.push("tick of " + run + " sees " + label); } catch (error: any) { log.push("tick of " + run + " throws " + error.name); } }, 1);
      await new Promise(resolve => setTimeout(resolve, 20));
      const label = "label" + run;
      await new Promise(resolve => setTimeout(resolve, 20));
      if (run > 1) clearInterval(timer);
      test("waits", () => { console.log("run", run, [...new Set(log)].sort().join()); });`,
  },
  "a CommonJS test file is found in require.cache and does not run again": {
    "counter.cjs": `exports.state = { calls: 0 };`,
    "file.test.cjs": `
      const { test } = require("bun:test");
      const { state } = require("./counter.cjs");
      console.log("the file runs");
      test("counts", () => { state.calls++; console.log("run", state.calls, require.cache[__filename] === module); });`,
  },
  "a mock of an earlier run stays, and import.meta is a new object": {
    "real.ts": `export function value() { return "real"; }\nexport const templates = new Set<unknown>(), metas = new Set<unknown>();`,
    "mock.test.ts": `
      import { mock, test } from "bun:test";
      import { metas, templates, value } from "./real.ts";
      const tag = (strings: TemplateStringsArray) => strings;
      templates.add(tag\`x\`);
      metas.add(import.meta);
      const before = value();
      test("mock", () => {
        console.log("run", before, value(), templates.size, metas.size);
        mock.module("./real.ts", () => ({ value: () => "mocked", templates, metas }));
        console.log("after", value());
      });`,
  },
  "a file that imports the test file back reads what the run that it was linked to exports": {
    "helper.ts": `
      import { count, hoisted, name } from "./cycle.test.ts";
      export const early = hoisted();
      export function read() { return name + " " + count; }
      export const state = { loads: 0 };`,
    "cycle.test.ts": `
      import { test } from "bun:test";
      import { early, read, state } from "./helper.ts";
      export function hoisted() { return "hoisted"; }
      export let count = 0;
      export const name = "run " + ++state.loads;
      test("cycle", () => { count++; console.log(early, "|", read(), "|", name, count); });`,
  },
  "a file that throws at its top level in a later run": {
    "runs.ts": `export const runs = { count: 0 };`,
    "throws.test.ts": `
      import { test } from "bun:test";
      import { runs } from "./runs.ts";
      if (++runs.count === 2) throw new Error("the second run throws");
      test("runs", () => { console.log("run", runs.count); });`,
  },
  "a file that a run takes out of require.cache and loads again is what the next run imports": {
    "state.js": `export let count = 0;\nexport function bump() { return ++count; }`,
    "evicts.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("counts", () => {
        const path = require.resolve("./state.js");
        console.log("run", bump(), require(path).count);
        delete require.cache[path];
        console.log("behind the delete", bump(), require(path).count);
      });`,
  },
  "a file that a run takes out of require.cache and leaves out is loaded for the next run": {
    "state.js": `export let count = 0;\nexport function bump() { return ++count; }\nconsole.log("state loads");`,
    "evicts.test.js": `
      import { test } from "bun:test";
      import { bump } from "./state.js";
      test("counts", () => {
        console.log("run", bump());
        delete require.cache[require.resolve("./state.js")];
        console.log("behind the delete", bump());
      });`,
  },
};

const preloaded = {
  "preload.ts": `
    import { afterAll, beforeAll, beforeEach } from "bun:test";
    (globalThis as any).preloads = ((globalThis as any).preloads ?? 0) + 1;
    beforeAll(() => console.log("preload beforeAll", (globalThis as any).preloads));
    afterAll(() => console.log("preload afterAll"));
    beforeEach(() => console.log("preload beforeEach"));`,
  "hooks.test.ts": `
    import { afterAll, beforeAll, test } from "bun:test";
    beforeAll(() => console.log("file beforeAll"));
    afterAll(() => console.log("file afterAll"));
    test("hooks", () => { console.log("run"); });`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return {
    printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    summary: stderr.match(/^ \d+ (pass|fail)$/gm),
    exitCode,
  };
}

// A run of few test files is one program. The words ask for what a large run gets: what the test files share in images of its own, and each test file in one above them.
const ways: [string, string[], string?][] = [
  ["in one realm", ["--rerun-each=3"]],
  ["each file in its own realm", ["--rerun-each=3", "--isolate"]],
  ["over two layers", ["--rerun-each=3", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
];

// TODO: what happens today.
const differs = [
  // What a file exports is a variable of the program, which is there once: the helper reads what the newest run has stored.
  "a file that imports the test file back reads what the run that it was linked to exports",
];

for (const [way, flags, words] of ways) {
  for (const [name, files] of Object.entries(projects)) {
    const declare = differs.includes(name) ? test.todo : test.concurrent;
    declare(`${name}: ${way}`, async () => {
      using dir = tempDir("rerun-each", {
        "package.json": `{ "type": "module" }`,
        // No run of one test file has layers.
        "zz-one-more.test.ts": `import { test } from "bun:test";\ntest("one more file", () => { console.log("one more file runs"); });`,
        ...files,
      });
      const plain = await runTests(String(dir), undefined, ...flags);
      expect(plain.results).not.toEqual([]);
      expect(await runTests(String(dir), words, "--aot", ...flags)).toEqual(plain);
    });
  }
  test.concurrent(`the hooks of a preload stay, and the preload does not run again: ${way}`, async () => {
    using dir = tempDir("rerun-each", { "package.json": `{ "type": "module" }`, ...preloaded });
    const plain = await runTests(String(dir), undefined, "--preload", "./preload.ts", ...flags);
    expect(plain.results).not.toEqual([]);
    expect(await runTests(String(dir), undefined, "--aot", "--preload", "./preload.ts", ...flags)).toEqual(plain);
  });
}
