import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Every builder of a test run says how long its program is and what its bytes hash to. One Bun, the same files and the same flags: the same programs.
// Whoever changes how a run is built, and not what it builds, compares these lines.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/q/package.json": `{ "name": "q", "type": "module", "main": "index.js" }`,
  "node_modules/q/index.js": `export const twice = n => n * 2;\nexport class Pair { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } }\n`,
  "src/sums.ts": `import { Pair, twice } from "q";\nexport function sumOf(list: number[]): number { let sum = 0; for (const n of list) sum += twice(n); return sum; }\nexport const pair = (a: number, b: number) => new Pair(a, b).sum();\n`,
  "a.test.ts": `import { expect, test } from "bun:test";\nimport { sumOf } from "./src/sums";\ntest("a sum", () => expect(sumOf([1, 2, 3])).toBe(12));\n`,
  "b.test.ts": `import { expect, test } from "bun:test";\nimport { pair } from "./src/sums";\ntest("a pair", () => expect(pair(1, 2)).toBe(3));\n`,
};

test("two runs of one project over layers write the same programs", async () => {
  using dir = tempDir("aot-the-same-programs", files);
  const env = {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
    BUN_JSC_logAOTPhaseTimes: "1",
  };
  const programs: string[][] = [];
  for (let time = 0; time < 2; time++) {
    const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", "--aot"], String(dir), env);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
    programs.push(
      stderr
        .split("\n")
        .filter(line => /^AOT part build \| the program \| \d+ bytes \| hash [0-9a-f]{16}$/.test(line))
        .sort(),
    );
  }
  // The packages with Bun's own code, the project's files, a program for each test file.
  expect(programs[0].length).toBe(4);
  expect(programs[1]).toEqual(programs[0]);
}, 300_000);
