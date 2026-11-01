// The build of the packages' layer sees none of the files above it, so it looks through all of them for what they replace: each is read, parsed
// and analyzed whole. It kept what it had seen by the names as they are spelled: it was handed src/a.ts, found "./a" and "./a.js" in the files
// that import it, took each for a file that it had not seen, and looked at it again: nearly every file of a project twice.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/tools/package.json": `{ "name": "tools", "main": "index.js" }`,
  "node_modules/tools/index.js": `exports.now = () => Date.now();\n`,
  "src/a.ts": `import { b } from "./b";\nimport { c } from "./further";\nimport { d } from "./d";\nexport const a = () => [b(), c(), d()].join();\n`,
  // A file that exports names again is kept under the spelling that it was asked for by. "./again.js" and again.ts differ in the extension alone.
  "src/again.ts": `export * from "./c";\n`,
  "src/further.ts": `export * from "./again.js";\n`,
  "src/b.ts": `import tools from "tools";\nexport const b = () => typeof tools.now();\n`,
  "src/c.ts": `export const c = () => "c";\n`,
  "src/d/index.ts": `export const d = () => "d";\n`,
  // What a file of the project replaces still counts, however it is named.
  "src/replaces.ts": `Date.now = () => 7;\nexport const replaced = true;\n`,
  "a.test.ts": `import { test } from "bun:test";\nimport tools from "tools";\nimport { a } from "./src/a";\nimport { replaced } from "./src/replaces.js";\ntest("a", () => { console.error("OUT", a(), replaced, tools.now()); });\n`,
};

async function run(flags: string[], words = "") {
  using dir = tempDir("aot-look-once", files);
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.split("\n");
  return {
    printed: lines.filter(line => line.startsWith("OUT")),
    looks: lines.filter(line => line.startsWith("AOT test run | the scan looked at ")),
    library: lines.filter(line => line.startsWith("AOT test run | modules of Bun that a scan has looked at: ")),
    exitCode,
  };
}

test("in the build of the packages' layer", async () => {
  const plain = await run(["--isolate"]);
  expect(plain).toEqual({ printed: ["OUT number,c,d true 7"], looks: [], library: [], exitCode: 0 });
  const layers = await run(["--aot", "--isolate"], "TestRunLayers:2");
  expect({ ...layers, looks: [], library: [] }).toEqual(plain);
  // The test file and the seven files of the project, once each, and src/d/index.ts once more as "src/d": what is kept by spelling is looked up
  // without the extension, and that spelling differs in more.
  expect(layers.looks[0]).toBe(
    "AOT test run | the scan looked at 9 texts | 6 names led to a file that it had looked at under another",
  );
  // Of Bun's own library a scan reads what the files name and what that loads. These name none of it: reading all of it was three quarters of a small run.
  expect(layers.library[0]).toMatch(/: 0 of \d+$/);
}, 240_000);
