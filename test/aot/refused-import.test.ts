import { expect } from "bun:test";
import { tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { fromDisk, runTests, standInOf } from "./harness/test-files-from-disk-reach-what-they-name";
import { test } from "./supported";

const project = (bad: string) => ({
  "package.json": `{ "name": "suite", "type": "module" }`,
  "src/bad.ts": bad,
  "src/good.ts": `export const good = () => 1;`,
  "src/fine.ts": `export const fine = () => 3;`,
  "tests/a.test.ts": `import { expect, test } from "bun:test";
import { bad } from "../src/bad";
test("a", () => { expect(bad()).toBe(2); });
`,
  "tests/b.test.ts": `import { expect, test } from "bun:test";
import { good } from "../src/good";
test("b", () => { expect(good()).toBe(1); });
`,
  "tests/c.test.ts": `import { expect, test } from "bun:test";
import { fine } from "../src/fine";
test("c", () => { expect(fine()).toBe(3); });
`,
});

const shown = { BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1" };

// The build refuses one file that a test file imports. The other files are compiled without it, whichever other stand-ins the run has.
function expectOthersCompiled(stderr: string) {
  expect(stderr).toContain("AOT files are loaded again | without 1 test files that reach an error");
  expect(stderr).toMatch(/^AOT test run \| refused \| .*bad\.ts$/m);
  expect(stderr).toMatch(
    /^AOT test run \| the program \| files below the test files compiled 2 \| refused 1 \| \d+ bytes \| hash [0-9a-f]{16}$/m,
  );
  const named = standInOf(stderr);
  expect(named).not.toMatch(/bad\.ts"/);
  expect(named).toMatch(/good\.ts"/);
  expect(named).toMatch(/fine\.ts"/);
}

test.each([
  ["a syntax error", `export const bad = () => { return 2 +* ; };`],
  ["a name that the other module does not export", `import { nope } from "./good"; export const bad = () => nope;`],
])(
  "--globals=vitest: %s",
  async (_, bad) => {
    using dir = tempDir("aot-refused-import", project(bad));
    const plain = await runTests(String(dir), {}, "--globals=vitest");
    expect(plain.results).toEqual(["pass b", "pass c"]);
    const compiled = await runTests(String(dir), { ...fromDisk, ...shown }, "--aot", "--globals=vitest");
    expect(compiled.results).toEqual(["pass b", "pass c"]);
    expectOthersCompiled(compiled.stderr);
    expect(standInOf(compiled.stderr, "bun-test-globals-of-vitest.ts")).toContain("(globalThis as any).");
  },
  120_000,
);

test("layers and a DOM environment", async () => {
  using dir = tempDir("aot-refused-import-dom", {
    ...project(`export const bad = () => { return 2 +* ; };`),
    "node_modules/happy-dom/package.json": `{ "name": "happy-dom", "version": "1.0.0", "main": "index.cjs" }`,
    "node_modules/happy-dom/index.cjs": `exports.Window = class Window {
  constructor() {
    this.document = {};
    this.window = this;
    this.happyDOM = { abort() {}, cancelAsync() {} };
  }
  close() {}
};`,
  });
  const plain = await runTests(String(dir), {}, "--environment=happy-dom");
  expect(plain.results).toEqual(["pass b", "pass c"]);
  const words = `TestRunLayers:2,${shown.BUN_DEBUG_TEST_AOT_WORDS}`;
  const env = { ...shown, BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const compiled = await runTests(String(dir), env, "--aot", "--environment=happy-dom");
  expect(compiled.results).toEqual(["pass b", "pass c"]);
  if (compiled.stderr.includes("this Bun loads one program a realm")) return;
  expectLayers(compiled.stderr);
  expectOthersCompiled(compiled.stderr);
  expect(standInOf(compiled.stderr, "bun-test-window.ts")).toContain("require(name)");
}, 180_000);

test("a run that is asked for its form says what its build hands over", async () => {
  const handedOver = (stderr: string) =>
    [...stderr.matchAll(/^AOT test run \| ((?:the program|no program|refused) \| .*)$/gm)]
      .map(match => match[1].replace(/^(refused \| ).*[\\/]/, "$1").replace(/\d+ bytes \| hash [0-9a-f]{16}$/, "bytes"))
      .sort();
  const asked = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
  const sound = project(`export const bad = () => 2;`);
  const broken = `const x = 2 +* ;\n`;

  using one = tempDir("aot-refused-test-file", { ...sound, "tests/a.test.ts": sound["tests/a.test.ts"] + broken });
  const silent = await runTests(String(one), {}, "--aot");
  expect(silent.results).toEqual(["pass b", "pass c"]);
  expect(silent.stderr).not.toContain("AOT test run |");
  const others = await runTests(String(one), asked, "--aot");
  expect(others.results).toEqual(["pass b", "pass c"]);
  expect(handedOver(others.stderr)).toEqual([
    "refused | a.test.ts",
    "the program | test files compiled 2 | refused 1 | bytes",
  ]);

  using all = tempDir("aot-refused-test-files", {
    ...sound,
    "tests/a.test.ts": broken,
    "tests/b.test.ts": broken,
    "tests/c.test.ts": broken,
  });
  const none = await runTests(String(all), asked, "--aot");
  expect(none.results).toEqual([]);
  expect(handedOver(none.stderr)).toEqual([
    "no program | test files refused 3",
    "refused | a.test.ts",
    "refused | b.test.ts",
    "refused | c.test.ts",
  ]);
}, 120_000);
