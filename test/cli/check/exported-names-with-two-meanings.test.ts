// `export default X` and `export = X` are about the exported value X where there is one, also beside a type of that name that is not exported.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    verbatimModuleSyntax: true,
    lib: ["esnext"],
    types: [],
  },
});

// The errors are those of TypeScript 7.0.2.
test.concurrent.each([
  ["a type and an exported value", "type Size = number;\nexport const Size = 1;\nexport default Size;\n", []],
  [
    "an interface and an exported function",
    "interface Size { a: 1 }\nexport function Size() {}\nexport default Size;\n",
    [],
  ],
  ["an exported type and a value", "export type Size = number;\nconst Size = 1;\nexport default Size;\n", []],
  ["a type and a value", "type Size = number;\nconst Size = 1;\nexport default Size;\n", []],
  ["a type alone", "type Size = number;\nexport default Size;\n", ["(2,16) TS1284"]],
  ["an exported type alone", "export type Size = number;\nexport default Size;\n", ["(2,16) TS1284"]],
])("%s", async (_, program, errors) => {
  using dir = tempDir("check-exported-names", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual(errors);
});
