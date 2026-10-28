// Under --minify-syntax `bun build` leaves out an unused `new Map([..])`, `new Set([..])` and the like. An executable built with --aot leaves out the same.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { buildFlags, compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const sources = {
  "library.ts": `
export const unusedMapM1 = new Map<string, number>([["unusedMapTextM2", 1]]);
export const unusedSetM3 = new Set(["unusedSetTextM4"]);
export const unusedSpreadM5 = [...["unusedSpreadTextM6"]];
export class UnusedClassM7 {
  static table = new Map([["unusedStaticTextM8", 1]]);
}
function withEffect(text: string): string {
  console.log(text);
  return text;
}
export const unusedWithEffectM9 = new Set([withEffect("keptEffectTextM10")]);
export const usedMapM11 = new Map([["usedMapTextM12", 2]]);
`,
  "main.ts": `
import { usedMapM11 } from "./library";
console.log([...usedMapM11.keys()].join());
`,
};

const leftOut = ["unusedMapTextM2", "unusedSetTextM4", "unusedSpreadTextM6", "unusedStaticTextM8"];
const kept = ["keptEffectTextM10", "usedMapTextM12"];

describe.each([
  ["by default", []],
  ["with --minify-syntax", ["--minify-syntax"]],
] as [string, string[]][])("compile/aot/what minified syntax leaves out, built %s", (_, flags) => {
  const folder = String(tempDir("aot-what-minified-syntax-leaves-out", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  let bytes = Buffer.alloc(0);
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    const command = [bunExe(), ...compileCommand, buildFlags.withoutFunctionSource, ...flags];
    built(await spawned([...command, "./main.ts", "--outfile", executable], folder, bunEnv));
    bytes = readFileSync(executable);
  }, 300_000);

  test("the program prints what it prints under plain Bun", async () => {
    const run = await spawned([executable], folder, bunEnv);
    expect({ stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stdout: "keptEffectTextM10\nusedMapTextM12\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const found = (texts: string[]) => texts.filter(text => bytes.includes(text, 0, "latin1"));

  test("the executable holds the texts of what runs", () => {
    expect(found(kept)).toEqual(kept);
  });

  test.skipIf(!flags.length)("the executable holds no text of what is left out", () => {
    expect(found(leftOut)).toEqual([]);
  });
});
