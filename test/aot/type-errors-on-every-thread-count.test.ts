import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The base types of an interface are resolved once for all its declarations, so one evaluation finds the TS2312 of every file
// that declares a wrong base. Above one thread the larger files are checked first, and `slow` keeps the check of `first.ts` busy
// until the others are through. So a later file is the first to ask for the base types. It leaves the error in `first.ts` to
// that file's own check, which must still get to report it.

const slow = `type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Four = \`\${Digit}\${Digit}\${Digit}\${Digit}\`;
type Turn<T, Mark extends string> = T extends \`\${infer Head}\${infer Rest}\` ? \`\${Rest}\${Head}\${Mark}\` : never;
export type Slow = ${"abcdefgh".split("").reduce((inner, mark) => `Turn<${inner}, "${mark}">`, "Four")};
`;
const first = `${slow}type U = string | number;
declare global { interface Merged extends U { one: number } }
export function one(merged: Merged): number { return merged.one + 1; }
`;
const two = `export function two(merged: Merged): number { return merged.two + 2; }\n`;
const large = Array.from({ length: 400 }, (_, i) => `declare const filler${i}: number;\n`).join("");
const main = (from: string, extension: string) =>
  `import { one } from "${from}/first${extension}";\nimport { two } from "${from}/second${extension}";\nconst merged = { one: 1, two: 2 };\nconsole.log(one(merged), two(merged));\n`;
const options = { strict: true, typeRoots: ["./no-types-here"], skipLibCheck: true };

async function build(directory: string, threads: number) {
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", `--aot-threads=${threads}`, "./main.ts", "--outfile", outfile],
    directory,
  );
  return { said, exitCode };
}

test("each file of a package with a type error is compiled without its types on every thread count", async () => {
  using dir = tempDir("aot-two-files-of-a-package", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...options, allowImportingTsExtensions: true, noEmit: true },
    }),
    "main.ts": main("ships-typescript", ".ts"),
    "node_modules/ships-typescript/package.json": JSON.stringify({ name: "ships-typescript" }),
    "node_modules/ships-typescript/first.ts": first,
    "node_modules/ships-typescript/second.ts": `type V = string | number;\ndeclare global { interface Merged extends V { two: number } }\n${two}${large}`,
  });
  for (const threads of [1, 2, 8]) {
    const { said, exitCode } = await build(String(dir), threads);
    const demoted = ["first", "second"].filter(name => said.includes(`${name}.ts' has 1 type error`));
    expect({ threads, demoted, exitCode }).toEqual({ threads, demoted: ["first", "second"], exitCode: 0 });
  }
}, 240_000);

// The other error lies in a declaration file that `skipLibCheck` leaves out, so the one in `first.ts` alone can stop the build.
test("a type error of the program stops the build on every thread count", async () => {
  using dir = tempDir("aot-two-files-of-the-program", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: options, files: ["main.ts", "last.d.ts"] }),
    "main.ts": main(".", ""),
    "first.ts": first,
    "second.ts": two + large,
    "last.d.ts": `type V = string | number;\ninterface Merged extends V { two: number }\n`,
  });
  for (const threads of [1, 2, 8]) {
    const { said, exitCode } = await build(String(dir), threads);
    expect({ threads, stops: said.includes("TS2312") && exitCode !== 0 }).toEqual({ threads, stops: true });
  }
}, 240_000);
