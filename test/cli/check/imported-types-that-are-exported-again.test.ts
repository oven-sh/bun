// `export default T` and `export = T` take a type as well, and an import of one is used there: each was told as never used under `noUnusedLocals`. TypeScript 7.0.2
// tells nothing about these programs but what is listed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const exporter = `export interface I { i: 1 }\nexport type N = string;\nexport class K { k = 1; }\nexport default interface D { d: 1 }\nexport const X = 1;\n`;

const check = async (importer: string, module: string) => {
  const compilerOptions = {
    strict: true,
    noEmit: true,
    target: "esnext",
    lib: ["esnext"],
    types: [],
    noUnusedLocals: true,
    module,
    moduleResolution: "bundler",
  };
  using dir = tempDir("check-imported-types-exported", {
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "a.ts": exporter,
    "c.ts": importer,
  });
  const { stdout, exitCode } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  const errors = [...stdout.matchAll(/^c\.ts\((\d+,\d+)\): error (TS\d+)/gm)].map(([, at, code]) => `${at} ${code}`);
  expect(exitCode).toBe(errors.length ? 1 : 0);
  return errors;
};

// In parentheses it's a value.
test.concurrent.each([
  ["export default (I);", "esnext", ["1,10 TS6133", "2,17 TS2693"]],
  ["export default ((I));", "esnext", ["1,10 TS6133", "2,18 TS2693"]],
  ["export = (I);", "commonjs", ["1,10 TS6133", "2,11 TS2693"]],
] as const)("%s", async (line, module, errors) => {
  expect(await check(`import { I } from "./a";\n${line}\n`, module)).toEqual([...errors]);
});

const imports = [
  `import { I as T } from "./a";`,
  `import { type N as T } from "./a";`,
  `import type { I as T } from "./a";`,
  `import T from "./a";`,
  `import type T from "./a";`,
  `import { K as T } from "./a";`,
];

test.concurrent.each(imports)("%s", async line => {
  expect(await check(`${line}\nexport default T;\n`, "esnext")).toEqual([]);
  expect(await check(`${line}\nexport default T;\n`, "commonjs")).toEqual([]);
  expect(await check(`${line}\nexport { T as default };\n`, "esnext")).toEqual([]);
  expect(await check(`${line}\nexport = T;\n`, "commonjs")).toEqual([]);
  expect(await check(`${line}\nexport default 1;\n`, "esnext")).toHaveLength(1);
});
