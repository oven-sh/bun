// The builds of the layers above the packages each began by reading every file of the project: to find what imports with computed names
// stand for, and how the files name one another. The process that runs the tests reads the same files while the packages are built, when it
// has nothing else to do, and hands on what it finds. A build that is handed it makes the same program, byte for byte, as one that reads
// the files itself.
//
// That first reading also left notes behind: which files the texts of the project name behind `require`. They are meant for the files above a
// build, which it does not see. Of its own files it took a comment for a `require`: a script that imports alone load ran sloppy, as CommonJS.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "timings.json": JSON.stringify({ version: 1, files: { "a.test.ts": 10, "b.test.ts": 500 } }),
  "node_modules/tools/package.json": `{ "name": "tools", "main": "index.js" }`,
  "node_modules/tools/index.js": `exports.name = "tools";\n`,
  "node_modules/tools/parts/one.js": `exports.name = "one";\n`,
  "node_modules/tools/parts/two.js": `exports.name = "two";\n`,
  "src/load.ts": `export const part = async (name: string) => (await import(\`tools/parts/\${name}.js\`)).name;\n`,
  // How a file is named decides what it is: these two are named behind require by a file of the project, not by a test file.
  "src/required.cjs": `exports.name = "required.cjs";\n`,
  "src/module.mjs": `export const name = "module.mjs";\n`,
  "src/only-imported.mjs": `export const name = "only-imported.mjs";\n`,
  // Its text does not say what it is, so who loads it decides: imports alone, whatever the comment in names.ts reads like.
  "src/undecided.cjs": `globalThis.undecided = (function () { return this === undefined ? "strict" : "sloppy"; })();\n`,
  "src/names.ts": `// require("./undecided.cjs")\nimport tools from "tools";\nexport const names = () => [tools.name, require("./required.cjs").name, require("./module.mjs").name].join();\n`,
  // A `require` behind what only looks like the start of a comment is one.
  "src/required-script.cjs": `globalThis.requiredScript = (function () { return this === undefined ? "strict" : "sloppy"; })();\n`,
  "src/behind.ts": `export const load = () => { const url = "http://host/*"; const slashes = /[/*"'\`]/; const part = \`//\${url}/*\`; require("./required-script.cjs"); return [url, slashes, part].length; };\n`,
  "a.test.ts": `import { test } from "bun:test";\nimport { part } from "./src/load";\nimport { names } from "./src/names";\nimport { name } from "./src/only-imported.mjs";\nimport { load } from "./src/behind";\nimport "./src/undecided.cjs";\ntest("a", async () => { load(); console.error("OUT a", await part("one"), names(), name, globalThis.undecided, globalThis.requiredScript); });\n`,
  "b.test.ts": `/* require("./src/undecided.cjs") */\nimport { test } from "bun:test";\nimport { part } from "./src/load";\nimport required from "./src/required.cjs";\nimport { name } from "./src/module.mjs";\ntest("b", async () => { console.error("OUT b", await part("two"), required.name, name); });\n`,
};

async function run(dir: string, words: string, flags: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.split("\n");
  return {
    printed: lines.filter(line => line.startsWith("OUT")).sort(),
    // Of every layer and every part.
    programs: lines.filter(line => line.startsWith("AOT part build | the program |")).sort(),
    found: [
      ...new Set(
        lines
          .filter(line => line.includes("what computed imports reach is found"))
          .map(line => line.replace(/ \| at \d+ ms$/, "")),
      ),
    ],
    readsItself: lines.filter(line => line.includes(": the files are read |")).length,
    exitCode,
  };
}

// Two builds by one Bun of the same files under the same flags write the same bytes. The folder is part of every path, so both runs have one.
test.concurrent.each([
  ["two layers", "TestRunLayers:2", ["--isolate"], "strict"],
  ["three layers", "TestRunLayers:3", ["--isolate"], "strict"],
  ["as the run plans them", "", ["--parallel=2", "--aot-memory-limit=1KB"], "strict"],
  // The run then takes its test files the slowest first: another order than the one in which it noted them for the plan.
  ["with timings", "", ["--parallel=2", "--aot-memory-limit=1KB", "--timings=timings.json"], "strict"],
])(
  "%s",
  async (_, words, flags, undecided) => {
    using folder = tempDir("aot-run-hands-on-what-it-read", files);
    const dir = String(folder);
    const handed = await run(dir, words, flags);
    const read = await run(dir, [words, "TestRunBuildsReadTheProject"].filter(Boolean).join(","), flags);
    expect(handed.exitCode).toBe(0);
    expect(handed.printed.map(line => line.split(" "))).toEqual([
      ["OUT", "a", "one", "tools,required.cjs,module.mjs", "only-imported.mjs", undecided, "sloppy"],
      ["OUT", "b", "two", "required.cjs", "module.mjs"],
    ]);
    expect(handed.found).toHaveLength(1);
    expect(handed.readsItself).toBe(0);
    expect(read.readsItself).toBeGreaterThan(0);
    expect(handed.programs.length).toBeGreaterThan(3);
    expect({ ...read, readsItself: 0 }).toEqual(handed);
  },
  240_000,
);
