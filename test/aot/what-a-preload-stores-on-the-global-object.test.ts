import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// In a layered test run the preload and what it imports are compiled in a program below those of the test files. No statement of a test file's program stores the names that the preload
// adds to the global object, and the compiler took that for "nobody stores them": `globalThis.helper("x")` threw "is not a function", `globalThis.limit + 1` was NaN, `typeof helper` was
// "undefined". A program that uses anything of another program (a file of the project, a package, a module of the library) counts on code that it has not seen, which hides it. So each read
// stands alone in a test file that imports bun:test alone, and each test file is a program of its own here.
const preload = `
import "./src/stores";
declare var global: any;
(globalThis as any).withCast = (name: string) => "cast/" + name;
// @ts-ignore
globalThis.withoutCast = (name: string) => "plain/" + name;
global.throughGlobal = (name: string) => "global/" + name;
Object.assign(globalThis, { assigned: (name: string) => "assigned/" + name });
Object.defineProperty(globalThis, "defined", { value: (name: string) => "defined/" + name, configurable: true, writable: true });
Object.defineProperty(globalThis, "withGetter", { get: () => "got", configurable: true });
for (const key of ["listedOne", "listedTwo"]) (globalThis as any)[key] = key;
Reflect.set(globalThis, "reflected", "reflected");
(globalThis as any).aNumber = 41;
(globalThis as any).anObject = { inner: { deep: "deep" } };
(globalThis as any).aClass = class Planted { value = "planted"; };
`;
const uses = [
  `(globalThis as any).withCast("x")`,
  `(globalThis as any).withoutCast("x")`,
  `(globalThis as any).throughGlobal("x")`,
  `global.withCast("x")`,
  `g.withCast("x")`,
  `withCast("x")`,
  `typeof withCast + " " + typeof aNumber + " " + typeof neverStored`,
  `typeof (globalThis as any).withCast`,
  `(globalThis as any).assigned("x")`,
  `(globalThis as any).defined("x")`,
  `(globalThis as any).withGetter`,
  `(globalThis as any).listedOne + " " + (globalThis as any).listedTwo`,
  `(globalThis as any).reflected`,
  `(globalThis as any).aNumber + 1`,
  `(globalThis as any).aNumber === undefined`,
  `(globalThis as any).aNumber ?? "a default"`,
  `(({ aNumber }) => aNumber)(globalThis as any)`,
  `(globalThis as any).anObject.inner.deep`,
  `new (globalThis as any).aClass().value`,
  `(globalThis as any).fromSrc("x")`,
  `(globalThis as any).withCast?.("x")`,
  `(globalThis as any).neverStored`,
  `(globalThis as any).neverStored?.("x")`,
  `[(globalThis as any).aNumber, ((globalThis as any).aNumber = 6), (globalThis as any).aNumber].join()`,
];

test("each read is as in plain bun test", async () => {
  using dir = tempDir(
    "aot-preload-stores-on-the-global-object",
    Object.fromEntries([
      ["package.json", `{ "name": "preloaded", "type": "module" }`],
      ["preload.ts", preload],
      [
        "src/stores.ts",
        `(globalThis as any).fromSrc = (name: string) => "src/" + name;\nexport const stored = true;\n`,
      ],
      ...uses.map((use, index) => [
        `use-${String(index).padStart(2, "0")}.test.ts`,
        `import { test } from "bun:test";\ndeclare var global: any, withCast: any, aNumber: any, neverStored: any;\nconst g = globalThis as any;\ntest("use", () => {\n  let seen: string;\n  try {\n    seen = String(${use});\n  } catch (error) {\n    seen = "throws " + (error as Error).name;\n  }\n  console.log("RESULT|${index}|" + seen);\n});\n`,
      ]),
    ]),
  );
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=8", "--preload", "./preload.ts", ...flags],
      String(dir),
      { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
    );
    // With --parallel what a worker prints comes by way of the runner.
    const results = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("RESULT|"));
    return {
      results: results.sort(),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, layers] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.results.length).toBe(uses.length);
  expect(plain.results).toContain("RESULT|0|cast/x");
  expect(plain.failed).toEqual([]);
  expect(layers).toEqual(plain);
}, 120_000);
