import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test writes a module into a folder that nobody knows, loads it, and the module lays a spy on an export of the product. No build sees that
// file. Its text stands in the test file, and the path of the product's file goes into the text from a `const` of the test file.

const lay = `export function lay(name) { return spyOn(lib, name).mockReturnValue("spied"); }`;
const written: Record<string, { text: string; call?: string; opened: number; stays?: boolean }> = {
  "a template, the name a parameter": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(lib)}; " + lay + "`",
    opened: 2,
  },
  "a template, the path between quotes": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from '${lib}'; " + lay + "`",
    opened: 2,
  },
  "a template, the name spelled": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(lib)}; export const lay = () => spyOn(lib, 'answer').mockReturnValue('spied');`",
    opened: 1,
  },
  "a template, the name put in": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(lib)}; export const lay = () => spyOn(lib, ${JSON.stringify(name)}).mockReturnValue('spied');`",
    opened: 1,
  },
  "a template that requires the file": {
    text: "`import { spyOn } from 'bun:test'; export const lay = name => spyOn(require(${JSON.stringify(lib)}), name).mockReturnValue('spied');`",
    opened: 2,
  },
  // Neither half of the text looks like code by itself.
  "a template, nothing called on the spy": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(lib)}; export const lay = () => spyOn(lib, 'answer');`",
    opened: 1,
  },
  "a template, the folder put in": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from '${import.meta.dir}/../src/lib.ts'; " + lay + "`",
    opened: 2,
  },
  "a template, the path from a resolver": {
    text:
      "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(require.resolve('../src/lib.ts'))}; " +
      lay +
      "`",
    opened: 2,
  },
  "a template that mocks the module": {
    text: "`import { mock } from 'bun:test'; export const lay = () => { mock.module(${JSON.stringify(lib)}, () => ({ answer: () => 'spied', other: () => 'other' })); return mock(); };`",
    opened: 2,
    stays: true,
  },
  // The written code names no module: the test file loads it and hands its object over.
  "a text that is handed the object and the name": {
    text: "`import { spyOn } from 'bun:test'; export const lay = (object, name) => spyOn(object, name);`",
    call: "lay(await import(lib), name)",
    opened: 2,
  },
  // No value and not nothing fits the substitution: a name does.
  "such a text with a name left open": {
    text: "`import { spyOn } from 'bun:test'; export const lay = (object, name) => spyOn(object, name); export const read = object => object.${part}();`",
    call: "lay(await import(lib), name)",
    opened: 2,
  },
  "a sum": {
    text: `"import { spyOn } from 'bun:test'; import * as lib from " + JSON.stringify(lib) + ${JSON.stringify("; " + lay)}`,
    opened: 2,
  },
};

const files = {
  "package.json": `{ "name": "spies-in-written-code", "type": "module" }`,
  "src/lib.ts": `export function answer(): string { return "real"; }\nexport function other(): string { return "other"; }\n`,
  "src/far.ts": `export function far(): string { return "far"; }\n`,
  "src/user.ts": `import { far } from "./far";\nimport { answer, other } from "./lib";\nexport const ask = () => [answer(), other(), far()].join(" ");\n`,
};

const testFile = (text: string, call = "lay(name)") => `
import { test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../src/user";
const lib = join(import.meta.dir, "../src/lib.ts");
const name = ["ans", "wer"].join("");
const part = process.env.NOTHING_IS_HERE ?? "other";
test("the spy is met inside the product", async () => {
  const folder = mkdtempSync(join(tmpdir(), "written-"));
  writeFileSync(join(folder, "late.ts"), ${text});
  const { lay } = await import(join(folder, "late.ts"));
  const spy = ${call}.mockReturnValue("spied");
  console.log("SPY " + ask());
  spy.mockRestore();
  console.log("SPY " + ask());
  rmSync(folder, { recursive: true });
});
`;

async function spiesOf(dir: string, flags: string[], words?: string) {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }) };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./test/a.test.ts"], dir, env);
  const lines = (stdout + "\n" + stderr).split("\n");
  const opened = lines.map(line => line.match(/variables that tests may replace (\d+) in/)).filter(Boolean);
  return {
    seen: lines.filter(line => line.startsWith("SPY ") || line.includes("Cannot spy")),
    exitCode,
    opened: opened.reduce((sum, found) => sum + Number(found![1]), 0),
  };
}

test.each(Object.entries(written))(
  "a spy in code that a test writes: %s",
  async (_, { text, call, opened, stays }) => {
    using dir = tempDir("aot-spies-in-written-code", { ...files, "test/a.test.ts": testFile(text, call) });
    const [plain, ...compiled] = await Promise.all([
      spiesOf(String(dir), []),
      spiesOf(String(dir), ["--aot"], "TestRunLayers:0"),
      spiesOf(String(dir), ["--aot"], "TestRunLayers:2"),
    ]);
    const restored = stays ? "SPY spied other far" : "SPY real other far";
    expect(plain).toEqual({ seen: ["SPY spied other far", restored], exitCode: 0, opened: 0 });
    // What the text names is opened, and nothing else of the product.
    for (const run of compiled) expect(run).toEqual({ ...plain, opened });
  },
  240_000,
);
