// A build has one type checker, which the tsconfig.json of the entry point sets up. Where the tsconfig.json of a folder answers one of the options that
// can't change from one file to the next otherwise, what the checker says of the files in that folder is not what their own project says of them.
// So a build that looks for type errors looks for none there. docs/compiler/aot.mdx says which options those are.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const options = {
  strict: true,
  module: "esnext",
  moduleResolution: "bundler",
  target: "esnext",
  types: [],
  lib: ["esnext", "dom"],
};
const project = (ofFolder: object | undefined, text: string) => ({
  "tsconfig.json": JSON.stringify({ compilerOptions: options }),
  "main.ts": `import { first } from "./lib/index";\nconsole.log(first([4]), first([]));\n`,
  "lib/index.ts": text,
  ...(ofFolder && { "lib/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json", compilerOptions: ofFolder }) }),
});
const returnsUndefined = `export function first(list: number[]): number {\n  return list.length ? list[0] : undefined;\n}\n`;
const commands: [string, string[]][] = [
  ["bun compile --check", ["compile", "--check", "./main.ts"]],
  ["bun check --aot", ["check", "--aot", "--no-pretty", "./main.ts"]],
];

for (const [name, command] of commands) {
  describe.concurrent(name, () => {
    const errors = async (files: Record<string, string>) => {
      using folder = tempDir("aot-type-errors-under-another-tsconfig", files);
      const { stdout, stderr, exitCode } = await run([bunExe(), ...command], String(folder), {
        ...bunEnv,
        NO_COLOR: "1",
      });
      return { codes: [...new Set((stdout + stderr).match(/\bTS\d+\b/g))], exitCode };
    };

    test("reports nothing of what a folder without null checks allows", async () => {
      expect(await errors(project({ strictNullChecks: false }, returnsUndefined))).toEqual({ codes: [], exitCode: 0 });
    });

    test("reports nothing of what a package beside the program allows, which names the aot condition", async () => {
      const manifest = {
        name: "lib",
        version: "1.0.0",
        exports: { ".": { aot: "./index.ts", default: "./index.js" } },
        compilerOptions: { strict: false },
      };
      const files = { ...project(undefined, returnsUndefined), "lib/package.json": JSON.stringify(manifest) };
      expect(await errors(files)).toEqual({ codes: [], exitCode: 0 });
    });

    test("reports it where no tsconfig.json of the folder allows it", async () => {
      expect(await errors(project(undefined, returnsUndefined))).toEqual({ codes: ["TS2322"], exitCode: 1 });
    });

    test("reports it where the tsconfig.json of the folder makes the same program", async () => {
      expect(await errors(project({ noUnusedLocals: true }, returnsUndefined))).toEqual({
        codes: ["TS2322"],
        exitCode: 1,
      });
    });

    test("reports an early error in such a folder", async () => {
      const declaredTwice = `let x = 1;\nlet x = 2;\nexport function first(list: number[]): number {\n  return list[0] + x;\n}\n`;
      expect(await errors(project({ strictNullChecks: false }, declaredTwice))).toEqual({
        codes: ["TS2451"],
        exitCode: 1,
      });
    });
  });
}
