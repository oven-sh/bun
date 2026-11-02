import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// Each case is a project that runs under plain `bun test`, compiled as one program, and compiled over two layers. The cases are dealt out over four files, by the time that they take.
// As one program a case has a folder of its own: what a build finds in one program holds for all of it, and beside the other cases a case is compiled to other code.
// Over layers nearly all of a build is the lowest layer, which holds Bun's own code and is the same under every case that does not let every file load again. Those cases
// are the folders of one project there: one run builds that layer for all of them, and `TestRunPartFiles:1` keeps each test file a program of its own.
const test = oneAtATime.concurrent;

type Case = {
  name: string;
  files: Record<string, string>;
  /** The lines that its test files print. */
  prints: string[];
  /** What a run says of its test files, without the times. */
  reports: string[];
  /**
   * Why every file of a run that holds the case may load again, as the stage log of a build says it. Such a run has another lowest layer, and each of its test files
   * is another program: the case has a run in layers to itself.
   */
  everyFileMayLoadAgain?: string[];
};
const cases: Case[] = [];

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

cases.push({
  name: "a CommonJS file finds its own module in require.cache while it runs, whoever has begun it",
  files: {
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
  },
  prints: [
    "in-function.cjs true,true exports [early] true true true",
    "in-function.cjs true,true exports [early+seen+later] true true",
    "at-top.cjs true,true exports [early] true true true",
    "imported.cjs true,true exports [early] true true true",
    "imported.cjs true,true exports [early+seen+later] true true",
    "imported-below.cjs true,true exports [early] true true true",
    "imported-late.cjs true,true exports [early] true true true",
    "under-module.cjs true,true exports [early] true true true",
  ],
  reports: ["one.test.ts:", "(pass) each way to begin it"],
});

cases.push({
  name: "an ES module is listed while it runs if a require() has begun it, and not if an import has",
  files: {
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
  },
  prints: [
    "in-function.ts true,true exports [] true",
    "in-function.ts true,true exports [early+later+seen] true true",
    "at-top.ts true,true exports [] true",
    "at-top.ts true,true exports [early+later+seen] true true",
    "imported.ts false,false ",
    "imported.ts true,true exports [early+later+seen] true true",
    "imported-late.ts false,false ",
    "under-file.ts true,true exports [] true",
    "under-module.ts true,true exports [] true",
  ],
  reports: ["one.test.ts:", "(pass) each way to begin it"],
});

cases.push({
  name: "what a required ES module imports sees that module listed, and not itself",
  files: {
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
  },
  prints: [
    "below-root.ts false,false  | root.ts true,true exports [] true",
    "root-with-nothing-to-run.ts true,true exports [] true",
  ],
  reports: ["one.test.ts:", "(pass) below a require()"],
});

cases.push({
  name: "files that require each other are all listed while the innermost runs",
  files: {
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
  },
  prints: [
    "outer.ts true,true exports [] true | inner.ts true,true exports [] true",
    "outer.cjs true,true exports [before] true | inner.cjs true,true exports [] true",
    " true ring-first.ts true,true exports [] true",
    "first true ring-first.cjs true,true exports [first] true",
  ],
  reports: ["one.test.ts:", "(pass) one below the other", "(pass) in a ring"],
});

cases.push({
  name: "an ES module that an import has begun is listed from the first require() of it",
  files: {
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
  },
  prints: [
    "importer.ts false,false  | importer.ts true,true exports [ReferenceError] true | importer.ts true,true exports [ReferenceError] true",
    "importer.ts false,false  | importer.ts true,true exports [ReferenceError] true | importer.ts true,true exports [ReferenceError] true",
  ],
  reports: ["call.test.ts:", "(pass) import()", "statement.test.ts:", "(pass) an import statement"],
});

cases.push({
  name: "a file that throws while it is required was listed until then, and is not afterwards",
  files: {
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
  },
  prints: [
    "from the file | throws.cjs true,true exports [] true | throws.cjs false,false ",
    "1 from the module | throws.ts true,true exports [] true | throws.ts false,false ",
    "2 from the module | throws.ts true,true exports [] true | throws.ts false,false ",
  ],
  reports: ["one.test.ts:", "(pass) a CommonJS file", "(pass) an ES module"],
});

cases.push({
  name: "a file that takes itself out of require.cache while it runs: a CommonJS file runs again, an ES module does not",
  files: {
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
  },
  prints: [
    "1 1 | file.cjs true,true exports [] true | file.cjs false,false  | file.cjs false,false ",
    "2 2 | file.cjs true,true exports [] true | file.cjs false,false  | file.cjs false,false ",
    "1 1 | module.ts true,true exports [] true | module.ts false,false  | module.ts true,true exports [seen] true",
    "2 1 | module.ts true,true exports [] true | module.ts false,false  | module.ts true,true exports [seen] true",
  ],
  reports: ["one.test.ts:", "(pass) a CommonJS file", "(pass) an ES module"],
  everyFileMayLoadAgain: [
    "file.cjs takes a key out of require.cache that it does not spell",
    "the scan of the test files says so",
  ],
});

cases.push({
  name: "an ES module whose import fails behind a require() of it that has returned stays listed, and require() answers",
  files: {
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
  },
  prints: [
    "fails | fails.ts true,true exports [ReferenceError] true",
    "no error | fails.ts true,true exports [ReferenceError] true",
  ],
  reports: ["one.test.ts:", "(pass) import(), then require()"],
});

const ways = {
  "plain bun test": { flags: [], env: {} },
  "one program": { flags: ["--aot"], env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" } },
  // With the stage log a build says why every file of its run may load again. The log changes no byte of a program.
  "two layers": {
    flags: ["--aot"],
    env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1", BUN_JSC_logAOTPhaseTimes: "1" },
  },
} satisfies Record<string, { flags: string[]; env: Record<string, string> }>;

/** What a run tells of one case. */
type Told = { printed: string[]; reported: string[]; exitCode: number };
type Ran = { of: (it: Case) => Told; form: string | undefined; everyFileMayLoadAgain: string[] };

const folderOf = (it: Case) => `c${cases.indexOf(it) + 1}`;
const folders = new Map<string, ReturnType<typeof tempDir>>();
const runs = new Map<string, Promise<Ran>>();
// A run that no test waits for any longer still reads its folder.
afterAll(async () => {
  await Promise.allSettled(runs.values());
  folders.forEach(folder => folder[Symbol.dispose]());
});

/** Of the stage log only what it says of the run as a whole, and not the warnings that come with it: one for each `console` and `require` of a test file. */
const withoutStageLog = (stderr: string) =>
  stderr
    .replace(/^(?:AOT (?!test run \|)|  \w+: wall ).*\n/gm, "")
    .replace(/^ *\d+ \| .*\n *\^\nwarn: TS25(?:84|91): .*\n +at .*\n\n?/gm, "");

/**
 * `bun test --isolate` in one project, once for each way. One case is the project as it is written. Several are the folders c1, c2 .. of one project:
 * `--isolate` gives each test file a realm of its own, and the test files print to one stdout, so there a line says first which test file it is of.
 */
function ran(together: Case[], way: keyof typeof ways) {
  const project = together.map(folderOf).join();
  return runs.getOrInsertComputed(`${project} ${way}`, async () => {
    const inFolders = together.length > 1;
    const folder = folders.getOrInsertComputed(project, () => {
      const files = together.flatMap(it =>
        Object.entries(it.files).map(([path, text]) => {
          const name = inFolders ? `${folderOf(it)}/${path}` : path;
          const saysItsName = inFolders && path.endsWith(".test.ts");
          return [name, saysItsName ? text.replaceAll("console.log(", `console.log("${name}|", `) : text];
        }),
      );
      return tempDir("require-cache-in-test-runs", Object.fromEntries(files));
    });
    const { flags, env } = ways[way];
    const cmd = [bunExe(), "test", "--isolate", ...flags];
    const { stdout, stderr, exitCode } = await run(cmd, String(folder), { ...bunEnv, ...env });
    if (exitCode !== 0) console.error(withoutStageLog(stderr));
    // As harness/layers.ts reads it. run() asks a run in layers for its form.
    const form = stderr.match(/^AOT test run \| ((?:layers|one program|programs without layers)\b.*)$/m)?.[1];
    if (way === "one program") expect(form).toStartWith("one program");

    // By test file. Under "": what names none, which is told of every case.
    const printed = new Map<string, string[]>([["", []]]);
    const lines = stdout.split("\n");
    if (lines[0].startsWith("bun test v")) lines.shift();
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) {
      const named = inFolders ? line.match(/^(c\d+\/\S+\.test\.ts)\| ?(.*)$/) : null;
      printed.getOrInsertComputed(named?.[1] ?? "", () => []).push(named ? named[2] : line);
    }
    const reported = new Map<string, string[]>([["", []]]);
    const failed = new Set<string>();
    let file = "";
    for (const line of stderr.split("\n")) {
      const begun = line.match(/^(\S+\.test\.ts):$/)?.[1].replaceAll("\\", "/");
      if (begun) file = begun;
      const said = begun
        ? `${begun.slice(inFolders ? begun.indexOf("/") + 1 : 0)}:`
        : /^(?:\((?:pass|fail|skip|todo)\) |error)/.test(line) && line.replace(/ \[[\d.]+m?s\]$/, "");
      if (!said) continue;
      // A test file that does not load has an error and no test.
      if (/^(?:\(fail\) |error)/.test(said)) failed.add(file);
      reported.getOrInsertComputed(file, () => []).push(said);
    }
    const why = stderr.matchAll(/^AOT test run \| every file may load again: (?:.*[\\/])?(.*)$/gm);
    return {
      of: (it: Case): Told => {
        // Its test files by name: `bun test` runs the files of a folder under its own in the order in which the file system lists them.
        const isOfCase = (file: string) => file === "" || !inFolders || file.startsWith(`${folderOf(it)}/`);
        const told = (lines: Map<string, string[]>) =>
          [...lines.keys()]
            .filter(isOfCase)
            .sort()
            .flatMap(file => lines.get(file)!);
        return {
          printed: told(printed),
          reported: told(reported),
          // A run ends with 1 where a test has failed or a test file has not loaded: that is held against the case of the file alone.
          exitCode: exitCode === 1 && failed.size > 0 && ![...failed].some(isOfCase) ? 0 : exitCode,
        };
      },
      form,
      everyFileMayLoadAgain: [...new Set(Array.from(why, match => match[1]))].sort(),
    };
  });
}

/** Plain `bun test` tells of the case what the case is written to print and to pass, and the compiled run of the same project tells the same. */
async function expectToRunAsPlain(it: Case, together: Case[], way: keyof typeof ways) {
  const plain = (await ran(together, "plain bun test")).of(it);
  expect(plain).toEqual({ printed: it.prints, reported: it.reports, exitCode: 0 });
  const compiled = await ran(together, way);
  expect(compiled.of(it)).toEqual(plain);
  return compiled;
}

for (const it of cases) {
  test(`${it.name}: plain bun test`, async () => {
    const told = (await ran([it], "plain bun test")).of(it);
    expect(told).toEqual({ printed: it.prints, reported: it.reports, exitCode: 0 });
  });
}

const shareLayers = cases.filter(it => !it.everyFileMayLoadAgain);
// The runs in layers take longest, so their tests come first, and first of all that of a case with a run of its own: the builds begin together, and
// where few tests are under way at once no other build runs beside them.
for (const it of [...cases.filter(it => it.everyFileMayLoadAgain), ...shareLayers]) {
  test(`${it.name}: two layers`, async () => {
    const together = it.everyFileMayLoadAgain ? [it] : shareLayers;
    const compiled = await expectToRunAsPlain(it, together, "two layers");
    // A case that lets every file load again and does not say so would change what the others of its run are compiled to.
    // A Bun that loads one program a realm builds no layers, and run() lets its runs pass: there nothing is shared.
    if (compiled.form?.startsWith("layers "))
      expect(compiled.everyFileMayLoadAgain).toEqual(it.everyFileMayLoadAgain ?? []);
  });
}

for (const it of cases) {
  test(`${it.name}: one program`, async () => {
    await expectToRunAsPlain(it, [it], "one program");
  });
}
