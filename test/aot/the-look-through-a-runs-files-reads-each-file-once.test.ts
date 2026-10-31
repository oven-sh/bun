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
  "src/a.ts": `import { b } from "./b";\nimport { c } from "./c.js";\nimport { d } from "./d";\nexport const a = () => [b(), c(), d()].join();\n`,
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
    exitCode,
  };
}

test("in the build of the packages' layer", async () => {
  const plain = await run(["--isolate"]);
  expect(plain).toEqual({ printed: ["OUT number,c,d true 7"], looks: [], exitCode: 0 });
  const layers = await run(["--aot", "--isolate"], "TestRunLayers:2");
  expect({ ...layers, looks: [] }).toEqual(plain);
  // The test file and the five files of the project, once each. Bun's own library is looked at apart.
  expect(layers.looks[0]).toBe(
    "AOT test run | the scan looked at 6 texts | 5 names led to a file that it had looked at under another",
  );
}, 240_000);
