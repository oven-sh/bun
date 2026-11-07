import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const preload = `
import { stored } from "./src/stores";
(process as any).flag = 1;
(Math as any).helper = () => 2;
(JSON as any).limit = 40;
(Reflect as any).text = "text";
(console as any).note = { depth: 3 };
(Bun as any).mark = 5;
(Array as any).twice = (n: number) => n * 2;
(Object as any)["comp" + "uted"] = 7;
Object.assign(Symbol, { assigned: 8 });
Object.defineProperty(Number, "defined", { value: 9, configurable: true });
Object.defineProperty(String, "withGetter", { get: () => 10, configurable: true });
Reflect.set(Promise, "reflected", 11);
(process.env as any).ENV_OF_THE_PRELOAD = "12";
(process.versions as any).ofThePreload = "13";
(Map as any)[Symbol.for("ofThePreload")] = 14;
(Date as any)[0] = 15;
// Polyfills: what instances find above them.
(Array.prototype as any).lastOne = function (this: unknown[]) { return this[this.length - 1]; };
(String.prototype as any).shouted = function (this: string) { return this.toUpperCase() + "!"; };
(Number.prototype as any).doubled = function (this: number) { return this * 2; };
Object.assign(Map.prototype, { limitOfMaps: 18 });
Object.defineProperty(Set.prototype, "limitOfSets", { value: 19, configurable: true });
(Uint8Array.prototype as any).limitOfBytes = 20;
// Members that are there already, replaced by the keys of a literal.
Object.assign(Date, { now: () => 1000 });
Object.assign(Number, {}, { ["isInteger"]: () => "assigned" });
Object.defineProperties(Math, { random: { value: () => 0.5, configurable: true, writable: true } });
Object.assign(URL, { canParse: () => "assigned" });
stored();
`;
const uses = [
  `(process as any).flag + 1`,
  `(process as any).flag`,
  `typeof (process as any).flag`,
  `(process as any).flag === 1`,
  `(process as any).flag ?? "a default"`,
  "`${(process as any).flag}`",
  `(process as any).flag ? "yes" : "no"`,
  `"flag" in process`,
  `Object.hasOwn(process, "flag")`,
  `(({ flag }: any) => flag * 3)(process)`,
  `(Math as any).helper()`,
  `(Math as any).helper?.() ?? "none"`,
  `typeof (Math as any).helper`,
  `(JSON as any).limit - 1`,
  `(Reflect as any).text.length`,
  `(Reflect as any).text + "!"`,
  `(console as any).note.depth + 1`,
  `(console as any).note?.depth`,
  `(Bun as any).mark * 2`,
  `(Array as any).twice(21)`,
  `(Object as any).computed + 1`,
  `(Symbol as any).assigned + 1`,
  `(Number as any).defined + 1`,
  `(String as any).withGetter + 1`,
  `(Promise as any).reflected + 1`,
  `process.env.ENV_OF_THE_PRELOAD + "!"`,
  `(process.versions as any).ofThePreload + "!"`,
  `(Map as any)[Symbol.for("ofThePreload")] + 1`,
  `(Date as any)[0] + 1`,
  `(Error as any).storedBySrc + 1`,
  `(process as any).tableOfSrc.get("a") + 1`,
  `(globalThis as any).process.flag + 1`,
  `((name: string) => (process as any)[name] + 1)("flag")`,
  `Object.keys(Math).join()`,
  `([1, 2, 3] as any).lastOne()`,
  `("text" as any).shouted()`,
  `((21) as any).doubled()`,
  `(new Map() as any).limitOfMaps + 1`,
  `(new Set() as any).limitOfSets + 1`,
  `(new Uint8Array(1) as any).limitOfBytes ? "yes" : "no"`,
  `Date.now() + 1`,
  `Number.isInteger(1.5) + "!"`,
  `Math.random() + 1`,
  `URL.canParse("no") + "!"`,
  `(Math as any).neverStored + 1`,
  `typeof (process as any).neverStored`,
];

test("each read is as in plain bun test", async () => {
  using dir = tempDir(
    "aot-preload-stores-on-built-in-objects",
    Object.fromEntries([
      ["package.json", `{ "name": "preloaded", "type": "module" }`],
      ["preload.ts", preload],
      [
        "src/stores.ts",
        `export function stored() {\n  (Error as any).storedBySrc = 16;\n  (process as any).tableOfSrc = new Map([["a", 17]]);\n}\n`,
      ],
      ...uses.map((use, index) => [
        `use-${String(index).padStart(2, "0")}.test.ts`,
        `import { test } from "bun:test";\ntest("use", () => {\n  let seen: string;\n  try {\n    seen = String(${use});\n  } catch (error) {\n    seen = "threw " + (error as Error).name;\n  }\n  console.log("RESULT|${index}|" + seen);\n});\n`,
      ]),
    ]),
  );
  const seenWith = async (words: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=8", "--preload", "./preload.ts", ...flags],
      String(dir),
      { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    );
    const results = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("RESULT|"));
    return {
      results: results.sort(),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, twoLayers, oneLayer] = await Promise.all([
    seenWith("TestRunLayers:2,TestRunPartFiles:1"),
    seenWith("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seenWith("TestRunLayers:1,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.results.length).toBe(uses.length);
  expect(plain.results).toContain("RESULT|0|2");
  expect(plain.failed).toEqual([]);
  expect(twoLayers).toEqual(plain);
  expect(oneLayer).toEqual(plain);
}, 180_000);
