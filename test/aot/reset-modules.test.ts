import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const count = (name: string) => `globalThis.${name} = (globalThis.${name} ?? 0) + 1;`;

const project = {
  "package.json": `{}`,
  "counter.ts": `${count("timesModule")} export const evaluated: number = (globalThis as any).timesModule;`,
  "counter.cjs": `${count("timesFile")} exports.evaluated = globalThis.timesFile;`,
  "importer.ts": `import { evaluated } from "./counter"; ${count("timesImporter")} export const seen = [evaluated, (globalThis as any).timesImporter].join(" above ");`,
  "helper.ts": `export const reset = (runner: { resetModules(): unknown }) => void runner.resetModules();`,
  "node_modules/package-of-files/package.json": `{ "name": "package-of-files", "main": "index.js" }`,
  "node_modules/package-of-files/index.js": `${count("timesPackageFile")} exports.evaluated = globalThis.timesPackageFile;`,
  "node_modules/package-of-modules/package.json": `{ "name": "package-of-modules", "type": "module", "main": "index.js" }`,
  "node_modules/package-of-modules/index.js": `${count("timesPackageModule")} export const evaluated = globalThis.timesPackageModule;`,
  "1.test.ts": `import { test, vi } from "bun:test";
    test("vi.resetModules()", async () => {
      const first = await import("./counter");
      vi.resetModules();
      const second = await import("./counter");
      console.log("vi, import():", first.evaluated, second.evaluated, first === second);
      console.log("vi, the first goes on:", first.evaluated);
      const required = require("./counter.cjs");
      vi.resetModules();
      console.log("vi, require():", required.evaluated, require("./counter.cjs").evaluated, required === require("./counter.cjs"));
      const above = (await import("./importer")).seen;
      vi.resetModules();
      console.log("vi, an importer:", above, "|", (await import("./importer")).seen);
      const packages = [require("package-of-files").evaluated, (await import("package-of-modules")).evaluated];
      vi.resetModules();
      console.log("vi, packages:", ...packages, require("package-of-files").evaluated, (await import("package-of-modules")).evaluated);
      console.log("vi answers:", vi.resetModules() === vi);
    });`,
  "2.test.ts": `import { jest, test } from "bun:test";
    import { evaluated } from "./counter";
    test("jest.resetModules()", async () => {
      console.log("jest, an import statement of a later test file:", evaluated);
      jest.resetModules();
      console.log("jest, import():", evaluated, (await import("./counter")).evaluated);
      const required = require("./counter.cjs").evaluated;
      jest.resetModules();
      console.log("jest, require():", required, require("./counter.cjs").evaluated);
      const packages = [require("package-of-files").evaluated, (await import("package-of-modules")).evaluated];
      jest.resetModules();
      console.log("jest, packages:", ...packages, require("package-of-files").evaluated, (await import("package-of-modules")).evaluated);
    });`,
  "3.test.ts": `import * as runner from "bun:test";
    import { reset } from "./helper";
    const { test, vi } = runner;
    const again = async (how: string, act: () => unknown) => {
      const before = (await import("./counter")).evaluated;
      act();
      console.log(how + ":", (await import("./counter")).evaluated - before);
    };
    test("other ways to the function", async () => {
      const { resetModules } = vi;
      await again("taken out of vi", () => resetModules());
      const other = vi;
      await again("under another name", () => other.resetModules());
      await again("under a computed key", () => (vi as any)[["reset", "Modules"].join("")]());
      await again("handed to another file", () => reset(vi));
      await again("through the namespace", () => runner.jest.resetModules());
      await again("by call()", () => vi.resetModules.call(vi));
      await again("nothing", () => {});
    });`,
  "4.test.ts": `import { test } from "bun:test";
    import { evaluated } from "./counter";
    import { seen } from "./importer";
    test("a test file that resets nothing", () => {
      console.log("behind the resets of earlier test files:", typeof evaluated, typeof seen);
    });`,
  "5.test.ts": `import { mock, test, vi, jest } from "bun:test";
    test("beside a mock", async () => {
      let made = 0;
      mock.module("./counter", () => ({ evaluated: "mock " + ++made }));
      console.log("mocked:", (await import("./counter")).evaluated);
      vi.resetModules();
      console.log("mocked, behind vi:", (await import("./counter")).evaluated);
      jest.resetModules();
      console.log("mocked, behind jest:", (await import("./counter")).evaluated);
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:6" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

test("the build says where modules are reset", async () => {
  using dir = tempDir("reset-modules-notice", {
    "package.json": `{}`,
    "counter.ts": project["counter.ts"],
    "named.test.ts": `import { test, vi } from "bun:test";
test("resets", async () => {
  vi.resetModules();
  await import("./counter");
});`,
    "silent.test.ts": `import { test, vi } from "bun:test";
test("resets nothing", () => void vi.fn());`,
  });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
  expect(stderr.match(/^warn: TS100078: .*$/gm)).toEqual([
    "warn: TS100078: What loads again after resetModules() runs from source, not compiled. The tests still work, but from there on they don't test compiled code",
  ]);
  expect(stderr).toMatch(/named\.test\.ts:3:\d+/);
  expect(exitCode).toBe(0);
});

test("a reset that the build can't see is refused by name, with nothing changed", async () => {
  using dir = tempDir("reset-modules-unseen", {
    "package.json": `{}`,
    "counter.ts": project["counter.ts"],
    "counter.cjs": project["counter.cjs"],
    "unseen.test.ts": `import { test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
test("resets from a file that the test writes", async () => {
  const first = await import("./counter");
  require("./counter.cjs");
  const written = import.meta.dir + "/written.mjs";
  writeFileSync(written, 'import { vi } from "bun:test"; export const reset = () => vi.resetModules();');
  const { reset } = await import(written);
  let message = "it returned";
  try { reset(); } catch (error) { message = String((error as Error).message).replaceAll(import.meta.dir, "."); }
  console.log(message);
  console.log((await import("./counter")) === first, require("./counter.cjs").evaluated);
});`,
  });
  const { stdout, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(stdout.split("\n").filter(line => line && !line.startsWith("bun test "))).toEqual([
    expect.stringMatching(
      /^Cannot load '\.\/[\w.]+' again after vi\.resetModules\(\): the build found nothing that calls it, so the code that imports the file was compiled for a module that loads once\. Call it in a file that the tests import\.$/,
    ),
    "true 1",
  ]);
  expect(exitCode).toBe(0);
});

for (const isolation of [["--isolate"], []]) {
  for (const [way, env] of ways) {
    const name = `modules load again behind resetModules(), ${way}`;
    test.concurrent(isolation.length ? `${name}, isolated` : name, async () => {
      using dir = tempDir("reset-modules", project);
      const plain = await runTests(String(dir), {}, ...isolation);
      expect(plain.printed.slice(0, 2)).toEqual(["vi, import(): 1 2 false", "vi, the first goes on: 1"]);
      expect(plain.exitCode).toBe(0);
      expect(await runTests(String(dir), env, "--aot", ...isolation)).toEqual(plain);
    });
  }
}
