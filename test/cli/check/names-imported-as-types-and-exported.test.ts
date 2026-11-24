// A name that is imported as a type and declared again as an exported value is the import's where it's used: the module's own symbol of the name is both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", moduleResolution: "bundler", lib: ["esnext"], types: [] },
});

const files = {
  "tsconfig.json": tsconfig,
  "b.ts": "export class C { c = 1; }\nexport const D = 2;\nexport interface I { i: 1 }\n",
  "t.ts": 'export type { D as F } from "./b";\n',
  "class.ts": 'import type { C } from "./b";\nexport class C { a = 1; }\nexport const x = C;\nconst y = new C();\nexport { y };\n',
  "const.ts": 'import type { D } from "./b";\nexport const D = 1;\nexport const z: never = D;\nexport type T = typeof D;\n',
  "value.ts": 'import { D } from "./b";\nexport function D() { return 1; }\nexport const z: never = D;\n',
  "type.ts": 'import type { I } from "./b";\nexport const I = 1;\nexport const z: never = I;\n',
  "exported-type.ts": 'import { F } from "./t";\nexport const F = 1;\nexport const z: never = F;\n',
};

// The errors are those of TypeScript 7.0.2.
test("names that are imported as types and exported as values", async () => {
  using dir = tempDir("check-names-imported-as-types", files);
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty", "--all"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^(\S+\.ts\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`).sort()).toEqual([
    "class.ts(1,15) TS2395",
    "class.ts(1,15) TS2440",
    "class.ts(2,14) TS2395",
    "class.ts(3,18) TS1361",
    "class.ts(4,15) TS1361",
    "const.ts(1,15) TS2395",
    "const.ts(1,15) TS2440",
    "const.ts(2,14) TS2395",
    "const.ts(3,14) TS2322",
    "const.ts(3,25) TS1361",
    "exported-type.ts(1,10) TS2395",
    "exported-type.ts(1,10) TS2440",
    "exported-type.ts(2,14) TS2395",
    "exported-type.ts(3,14) TS2322",
    "exported-type.ts(3,25) TS1362",
    "type.ts(1,15) TS2395",
    "type.ts(2,14) TS2395",
    "type.ts(3,14) TS2322",
    "type.ts(3,25) TS1361",
    "value.ts(1,10) TS2440",
    "value.ts(3,14) TS2322",
  ]);
});
