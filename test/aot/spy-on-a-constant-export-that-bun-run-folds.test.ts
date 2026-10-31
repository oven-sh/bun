import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/from-enums.ts": `enum Color { Red, Green = "green", Blue = 4, Sum = Red | Blue }
const enum Fixed { One = 1 }
export const red = Color.Red;
export const green = Color.Green;
export const inBrackets = Color["Blue"];
export const fixed = Fixed.One;
export const both = Color.Red | Color.Blue | Fixed.One;
export const negative = -Color.Blue;
export const template = \`\${Color.Green}-\${Color.Blue}\`;
export const asserted = Color.Blue as number;
export const copy = red;
export const copyPlus = copy + negative;
export const summed = Color.Sum;
export const compared = Color.Blue === 4;
export const chosen = Color.Red ? "yes" : "no";
export const either = Color.Red || Color.Green;
export const textLength = Color.Green.length;
export const firstLetter = Color.Green[0];
export const byMember = ["x", "y"][Color.Red];
export const joined = Color.Green + "!";
export const kind = typeof Color.Red;
export const reverse = Color[0];
export const read = () => [red, green, inBrackets, fixed, both, negative, template, asserted, copy, copyPlus, summed, compared, chosen, either, textLength, firstLetter, byMember, joined, kind, reverse];
`,
  "src/from-literals.mjs": `export const text = "abc";
export const textLength = text.length;
export const wideLength = "héllo".length;
export const lastLetter = text[2];
export const ofArray = ["a", "b", "c"][1];
export const ofHole = ["a", , "c"][1];
export const ofNested = [["p", "q"]][0][1];
export const ofObject = { f: 1 }.f;
export const ofShorthand = { text }.text;
export const lengthOfItem = ["abc"][0].length;
export const pastEnd = "abc"[5];
export const wideLetter = "héllo"[1];
export const ofTwo = { f: 1, g: 2 }.g;
export const read = () => [text, textLength, wideLength, lastLetter, ofArray, ofHole, ofNested, ofObject, ofShorthand, lengthOfItem, pastEnd, wideLetter, ofTwo];
`,
  "spy.test.mjs": `import { test, spyOn } from "bun:test";
const show = value => (typeof value === "function" ? "function" : String(value));
for (const file of ["from-enums.ts", "from-literals.mjs"]) {
  test(file, async () => {
    const ns = await import("./src/" + file);
    const read = ns.read;
    console.log(file, "before:", read().map(show).join());
    for (const name of Object.keys(ns)) if (name !== "read") spyOn(ns, name);
    console.log(file, "spied:", read().map(show).join());
  });
}
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a file's own reads of a constant whose value bun run works out keep that value under a spy, ${way}`, async () => {
    using dir = tempDir("aot-spy-on-a-constant-that-bun-run-folds", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain(
      "from-enums.ts spied: 0,green,4,1,5,-4,green-4,4,0,-4,4,true,no,green,5,g,x,function,function,function",
    );
    expect(plain.stdout).toContain(
      "from-literals.mjs spied: abc,3,5,c,b,undefined,q,1,function,3,function,function,function",
    );
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
