import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(directory: string, entryPoint: string) {
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", outfile],
    directory,
  );
  if (exitCode) return { said, exitCode, stdout: "" };
  const { stdout } = await run([outfile], directory);
  return { said, exitCode, stdout };
}
const exact = JSON.stringify({
  compilerOptions: { strict: true, exactOptionalPropertyTypes: true, typeRoots: ["./no-types-here"] },
});

const shipped = `export interface Settings { retries?: number }
export const settings: Settings = { retries: undefined };
export function reset(target: Settings): void { target.retries = undefined; }
export function describe(target: Settings): string { return ("retries" in target) + " " + target.retries; }
export const described = describe({ retries: undefined });
`;

test("a package that ships its TypeScript stays typed where it stores undefined into an optional property and the application has exactOptionalPropertyTypes", async () => {
  using dir = tempDir("aot-dependency-exact-optional", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": exact,
    "main.ts": `import { describe, described, reset, settings, type Settings } from "ships-typescript";
function next(target: Settings): number { return "retries" in target ? target.retries + 1 : -1; }
const full: Settings = { retries: 2 };
console.log(described, describe(settings), describe(full), describe({}), next(settings), next(full), next({}));
reset(full);
console.log(describe(full), next(full));
`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": shipped,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({
    exitCode: 0,
    stdout: "true undefined true undefined true 2 false undefined NaN 3 -1\ntrue undefined NaN\n",
  });
}, 120_000);

test("the application's own store of undefined into an optional property stops the build under exactOptionalPropertyTypes", async () => {
  using dir = tempDir("aot-own-exact-optional", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": exact,
    "main.ts": shipped + `console.log(described);\n`,
  });
  const { said, exitCode } = await build(String(dir), "./main.ts");
  for (const code of ["TS2375", "TS2412", "TS2379"]) expect(said).toContain(code);
  expect(exitCode).not.toBe(0);
}, 120_000);
