// `jest.requireActual("./lib")`, `jest.requireMock("./lib")` and `jest.createMockFromModule("./lib")`: native code of the test runner loads the module. The build follows the
// name as it follows that of a `require()`, and the module is one that the host may ask for. Plain `bun test` says what is right.
// vi.importActual(): ./fixed-runs/closed/import-actual-in-a-helper.txt.
// The project stands alone: in the company of many test files the fault did not show.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const count = (name: string) => `globalThis.${name} = (globalThis.${name} ?? 0) + 1;`;

const project = {
  "package.json": `{}`,
  "below.ts": `export const below = "below";`,
  "common.cjs": `${count("commonRuns")}
    exports.plain = () => "real";
    exports.number = 3;`,
  "only-required.cjs": `${count("onlyRequiredRuns")}
    exports.alone = () => "alone above " + require("./below.cjs");`,
  "below.cjs": `module.exports = "below";`,
  "4.test.ts": `import { jest, test } from "bun:test";
    test("the three of jest", () => {
      const actual = jest.requireActual("./common.cjs");
      console.log("requireActual:", actual.plain(), actual.number, actual === require("./common.cjs"), (globalThis as any).commonRuns);
      const mocked = jest.requireMock("./common.cjs");
      console.log("requireMock:", jest.isMockFunction(mocked.plain), String(mocked.plain()), mocked.number, actual.plain());
      const made = jest.createMockFromModule("./common.cjs") as any;
      console.log("createMockFromModule:", jest.isMockFunction(made.plain), String(made.plain()), made.number, made === mocked);
      console.log("a file that nothing else names:", jest.requireActual("./only-required.cjs").alone(), (globalThis as any).onlyRequiredRuns);
      console.log("an ES module:", jest.requireActual("./below.ts").below);
    });`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

test("the three of jest", async () => {
  using dir = tempDir("runner-loads-by-name", project);
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass the three of jest"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});
