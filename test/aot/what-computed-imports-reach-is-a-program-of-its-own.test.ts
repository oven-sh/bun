import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// One `import(`package/build/${name}.js`)` can stand for thousands of files. In a test run over layers they would be compiled with the
// file that has the import, and a build takes memory by the size of its program. So the files of packages that only such imports
// reach are a program of their own, over the packages and under the files of the project. `TestRunComputedLayer:0`: they are not.
// What such an import reaches of the project goes with the files of the project, and counts as imported where those are cut
// (`TestRunLayers:3`).
const spec = (name: string, up: string) =>
  `const { shared } = require("${up}/lib/index.js");\n(globalThis.ran ??= []).push("${name}");\nmodule.exports = { name: "${name}", said: shared("${name}") };`;
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "noImplicitAny": false } }`,
  "node_modules/big/package.json": `{ "name": "big", "version": "1.0.0", "main": "./lib/index.js" }`,
  "node_modules/big/lib/index.js": `exports.shared = name => "shared:" + name;\n(globalThis.ran ??= []).push("lib");`,
  "node_modules/big/build/one.js": spec("one", ".."),
  "node_modules/big/build/two.js": spec("two", ".."),
  "node_modules/big/build/three.js": spec("three", ".."),
  "node_modules/big/build/deep/four.js": spec("four", "../.."),
  "node_modules/big/build/notes.txt": "no code",
  "src/helper.ts": `export const helper = () => "with help";`,
  "src/commands/alpha.ts": `export const run = () => "alpha ran";`,
  "src/commands/beta.ts": `import { helper } from "../helper";\nexport const run = () => "beta ran " + helper();`,
  // A circle that the computed import closes.
  "src/commands/gamma.ts": `import { direct } from "../load";\nexport const run = () => "gamma ran " + direct();`,
  "src/load.ts": `import { shared } from "big";
    export const spec = async (name: string) => (await import(\`big/build/\${name}.js\`)).default;
    export const needed = (name: string) => require(\`big/build/\${name}.js\`);
    export const command = async (name: string) => (await import(\`./commands/\${name}.ts\`)).run();
    export const direct = () => shared("direct");`,
  "a.test.ts": `import { test } from "bun:test";
    import { spec, needed, command, direct } from "./src/load";
    test("computed imports", async () => {
      console.log("seen", direct(), JSON.stringify([await spec("one"), needed("two"), await spec("deep/four")]));
      console.log("commands", await command("alpha"), await command("beta"), await command("gamma"));
      console.log("same", (await spec("two")) === needed("two"), (globalThis as any).ran.join());
      let missing = "";
      try { await spec("none"); } catch (error) { missing = (error as Error).constructor.name; }
      console.log("missing", missing);
    });`,
  "b.test.ts": `import { test } from "bun:test";
    test("a computed import in a test file alone", async () => {
      const name = "three";
      console.log("in a test file", JSON.stringify((await import(\`big/build/\${name}.js\`)).default));
    });`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr.slice(-4000));
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  const found = stderr.match(/stand for (\d+) files of packages, (\d+) of them in no program below/);
  const circle = stderr.match(/the largest circle has (\d+) files/);
  return {
    found: found?.slice(1).map(Number),
    circle: circle ? +circle[1] : undefined,
    seen: { stdout: printed.sort(), results: results.sort(), exitCode },
  };
}

test("a test sees the same wherever the files behind a computed import are built", async () => {
  using dir = tempDir("aot-what-computed-imports-reach", files);
  const plain = await runTests(String(dir), "");
  expect(plain.seen.results.length).toBe(2);
  expect(plain.seen.exitCode).toBe(0);
  expect(plain.seen.stdout).toContain("commands alpha ran beta ran with help gamma ran shared:direct");

  const [two, own, three] = await Promise.all([
    runTests(String(dir), "TestRunLayers:2,TestRunComputedLayer:0", "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
    runTests(String(dir), "TestRunLayers:3", "--aot"),
  ]);
  expect(two).toEqual({ found: undefined, circle: undefined, seen: plain.seen });
  expect(own).toEqual({ found: [4, 4], circle: undefined, seen: plain.seen });
  expect(three).toEqual({ found: [4, 4], circle: 2, seen: plain.seen });
}, 240_000);

test("a run without a computed import has no such program", async () => {
  using dir = tempDir("aot-no-computed-imports", {
    "package.json": `{ "type": "module" }`,
    "src/value.ts": `export const value = 1;`,
    "a.test.ts": `import { test } from "bun:test";\nimport { value } from "./src/value";\ntest("one", () => { console.log("value", value); });`,
  });
  const plain = await runTests(String(dir), "");
  const own = await runTests(String(dir), "TestRunLayers:2", "--aot");
  expect(own).toEqual({ found: [0, 0], circle: undefined, seen: plain.seen });
}, 120_000);
