import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test writes a module into a folder that nobody knows, loads it, and the module lays a spy on an export of the product. No build sees that
// file. Its text stands in the test file, and the path of the product's file goes into the text from a `const` of the test file.

type Form = { text: string; call?: string; opened: number; stays?: boolean };
const lay = `export function lay(name) { return spyOn(lib, name).mockReturnValue("spied"); }`;

// These name the file of the product. Each has a product of its own, so one run asks all of them: a text that is not read leaves its own product closed.
// A text that a build can only half read does not belong among them: it opens every product, and then none of the others can fail.
const named: Record<string, Form> = {
  "a template, the name a parameter": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from ${JSON.stringify(lib)}; " + lay + "`",
    opened: 2,
  },
  "a template, the path between quotes": {
    text: "`import { spyOn } from 'bun:test'; import * as lib from '${lib}'; " + lay + "`",
    opened: 2,
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
  "a sum": {
    text: `"import { spyOn } from 'bun:test'; import * as lib from " + JSON.stringify(lib) + ${JSON.stringify("; " + lay)}`,
    opened: 2,
  },
};

// The written code names no module: the test file loads it and hands its object over. As one program that was right.
const handed: Record<string, Form> = {
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
};

const product = {
  "src/lib.ts": `export function answer(): string { return "real"; }\nexport function other(): string { return "other"; }\n`,
  "src/far.ts": `export function far(): string { return "far"; }\n`,
  "src/user.ts": `import { far } from "./far";\nimport { answer, other } from "./lib";\nexport const ask = () => [answer(), other(), far()].join(" ");\n`,
};

const testFile = (id: string, text: string, call = "lay(name)") => `
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
  console.log("SPY ${id} " + ask());
  spy.mockRestore();
  console.log("SPY ${id} " + ask());
  rmSync(folder, { recursive: true });
});
`;

async function spiesOf(dir: string, testFiles: string[], flags: string[], words?: string) {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }) };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...testFiles], dir, env);
  const lines = (stdout + "\n" + stderr).split("\n");
  const opened = lines.map(line => line.match(/variables that tests may replace (\d+) in/)).filter(Boolean);
  return {
    seen: lines.filter(line => line.startsWith("SPY ") || line.includes("Cannot spy")),
    exitCode,
    opened: opened.reduce((sum, found) => sum + Number(found![1]), 0),
  };
}

for (const [forms, words] of [
  [named, "TestRunLayers:0"],
  [handed, "TestRunLayers:0"],
] as const) {
  const ids = Object.fromEntries(Object.keys(forms).map((form, index) => [form, `c${index + 1}`]));
  let both: Promise<Awaited<ReturnType<typeof spiesOf>>[]> | undefined;
  const ran = () =>
    (both ??= (async () => {
      const files: Record<string, string> = { "package.json": `{ "name": "spies-in-written-code", "type": "module" }` };
      for (const [form, { text, call }] of Object.entries(forms)) {
        for (const [path, body] of Object.entries(product)) files[`${ids[form]}/${path}`] = body;
        files[`${ids[form]}/test/a.test.ts`] = testFile(ids[form], text, call);
      }
      using dir = tempDir("aot-spies-in-written-code", files);
      const testFiles = Object.values(ids).map(id => `./${id}/test/a.test.ts`);
      return await Promise.all([
        spiesOf(String(dir), testFiles, []),
        spiesOf(String(dir), testFiles, ["--aot"], words),
      ]);
    })());

  test.each(Object.entries(forms))(
    "a spy in code that a test writes: %s",
    async (form, { stays }) => {
      const [plain, compiled] = await ran();
      const of = (run: typeof plain) => run.seen.filter(line => line.startsWith(`SPY ${ids[form]} `));
      expect(of(plain)).toEqual([
        `SPY ${ids[form]} spied other far`,
        `SPY ${ids[form]} ${stays ? "spied" : "real"} other far`,
      ]);
      expect(of(compiled)).toEqual(of(plain));
    },
    240_000,
  );

  test(`what the texts name is opened, and nothing else of the product: ${Object.keys(forms)[0]} ..`, async () => {
    const [plain, compiled] = await ran();
    expect(plain.opened).toBe(0);
    expect(compiled).toEqual({ ...plain, opened: Object.values(forms).reduce((sum, { opened }) => sum + opened, 0) });
  }, 240_000);
}
