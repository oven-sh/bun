// `vi.importMock("./lib")`, `vi.importActual("./lib")`, `jest.requireActual("./lib")`, `jest.requireMock("./lib")` and `jest.createMockFromModule("./lib")`:
// native code of the test runner loads the module. The build follows the name as it follows that of an `import()` or a `require()`, and the module is
// one that the host may ask for. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const count = (name: string) => `globalThis.${name} = (globalThis.${name} ?? 0) + 1;`;

const project = {
  "package.json": `{}`,
  "lib.ts": `${count("libRuns")}
    export const plain = () => "real";
    export default () => "real default";
    export const object = { number: 1, nested: { call: () => "nested" } };
    export class Box { get() { return "box"; } }
    export const unread = "nobody imports this name";`,
  "only-named.ts": `${count("onlyNamedRuns")}
    import { below } from "./below";
    export const alone = () => "alone above " + below;
    export const value = 7;`,
  "only-actual.ts": `${count("onlyActualRuns")}
    export const alone = () => "alone";`,
  "below.ts": `export const below = "below";`,
  "common.cjs": `${count("commonRuns")}
    exports.plain = () => "real";
    exports.number = 3;`,
  "only-required.cjs": `${count("onlyRequiredRuns")}
    exports.alone = () => "alone above " + require("./below.cjs");`,
  "below.cjs": `module.exports = "below";`,
  "helper.ts": `import { vi } from "bun:test";
    export const throughHelper = () => vi.importActual<typeof import("./only-actual")>("./only-actual");`,
  "node_modules/a-package/package.json": `{ "name": "a-package", "type": "module", "main": "index.js" }`,
  "node_modules/a-package/index.js": `export const ofPackage = () => "of the package";`,
  "1.test.ts": `import { test, vi } from "bun:test";
    import * as lib from "./lib";
    test("importMock", async () => {
      const made = await vi.importMock<typeof lib>("./lib");
      console.log("a file that is loaded:", vi.isMockFunction(made.plain), String(made.plain()), made.object.number, String(made.object.nested.call()), typeof made.Box, made.unread);
      console.log("the file itself is as it was:", lib.plain(), lib.default(), made === lib, (globalThis as any).libRuns);
      const alone = await vi.importMock<typeof import("./only-named")>("./only-named");
      console.log("a file that nothing else names:", vi.isMockFunction(alone.alone), String(alone.alone()), alone.value, (globalThis as any).onlyNamedRuns);
      const ofPackage = await vi.importMock<any>("a-package");
      console.log("a package:", vi.isMockFunction(ofPackage.ofPackage), String(ofPackage.ofPackage()));
    });`,
  "2.test.ts": `import { test, vi } from "bun:test";
    import * as lib from "./lib";
    import { throughHelper } from "./helper";
    test("importActual", async () => {
      const actual = await vi.importActual<typeof lib>("./lib");
      console.log("a file that is loaded:", actual.plain(), actual.unread, actual === lib, Object.keys(actual).join());
      const alone = await vi.importActual<typeof import("./only-named")>("./only-named");
      console.log("a file that only the runner loads:", alone.alone(), alone.value, typeof (globalThis as any).onlyNamedRuns);
      console.log("named in a helper:", (await throughHelper()).alone(), (globalThis as any).onlyActualRuns);
      console.log("the same again:", (await vi.importActual("./only-named")) === alone, (await import("./only-named")) === alone);
    });`,
  "3.test.ts": `import { test, vi } from "bun:test";
    test("a name that leads nowhere", async () => {
      const message = (error: unknown) => String((error as Error).message).replaceAll(import.meta.dir, ".").split("\\n")[0];
      console.log(await vi.importMock("./is-not-there").then(() => "loaded", message));
      console.log(await vi.importActual("./is-not-there").then(() => "loaded", message));
    });`,
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
  // The folder keeps what these names may reach apart from the files above.
  "computed/counter.ts": `export const increment = () => 1;
    export const unread = () => 2;`,
  "computed/user.ts": `import { increment } from "./counter";
    export const use = () => increment();`,
  "computed/common.cjs": `exports.plain = () => "real";
    exports.unread = 3;`,
  "5.test.ts": `import { jest, test, vi } from "bun:test";
    import { join } from "node:path";
    import common from "./computed/common.cjs";
    import { use } from "./computed/user";
    test("a computed name", async () => {
      const keys = (module: object) => Object.keys(module).sort().join();
      const counter = join(import.meta.dir, "computed", ["coun", "ter"].join("") + ".ts");
      console.log("importMock:", keys(await vi.importMock(counter)), use());
      console.log("importActual:", keys(await vi.importActual(counter)), (await vi.importActual<any>(counter)).unread());
      const required = join(import.meta.dir, "computed", ["com", "mon"].join("") + ".cjs");
      console.log("requireActual:", keys(jest.requireActual(required)), jest.requireActual(required) === common);
      console.log("requireMock:", keys(jest.requireMock(required)), String(jest.requireMock(required).plain()));
      console.log("createMockFromModule:", keys(jest.createMockFromModule(required) as object));
    });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

describe.each([[] as string[], ["--isolate"]])("bun test %s", (...isolate) => {
  test.each(ways)("%s", async (_, env) => {
    using dir = tempDir("runner-loads-by-name", project);
    const plain = await runTests(String(dir), {}, ...isolate);
    expect(plain.results).toEqual([
      "pass importMock",
      "pass importActual",
      "pass a name that leads nowhere",
      "pass the three of jest",
      "pass a computed name",
    ]);
    expect(await runTests(String(dir), env, "--aot", ...isolate)).toEqual(plain);
  });
});
