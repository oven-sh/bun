// A message names a module by the specifier of the first import of it in the file, unless that import is in the other mode (`import x = require`): then by the
// specifier that an import would have, even if the file has one behind it. The errors are those of TypeScript 7.0.2.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const exporter = `export const v = 1;\nconst local = 2;\nexport const w = local;\n`;

test.concurrent.each([
  [
    "import = require first, with the extensions of TypeScript",
    `import N = require("./b.mjs");\nexport { default } from "./b.mjs";\nimport { local } from "./b.mjs";\nexport const n = [N, local];\n`,
    { module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true },
    [
      `c.mts(2,10): error TS2305: Module '"./b.mts"' has no exported member 'default'.`,
      `c.mts(3,10): error TS2459: Module '"./b.mts"' declares 'local' locally, but it is not exported.`,
    ],
  ],
  [
    "import = require behind an export",
    `export { default } from "./b.mjs";\nimport N = require("./b.mjs");\nimport { local } from "./b.mjs";\nexport const n = [N, local];\n`,
    { module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true },
    [
      `c.mts(1,10): error TS2305: Module '"./b.mjs"' has no exported member 'default'.`,
      `c.mts(3,10): error TS2459: Module '"./b.mjs"' declares 'local' locally, but it is not exported.`,
    ],
  ],
  [
    "import = require first, without them",
    `import N = require("./b.mjs");\nimport { local, absent } from "./b.mjs";\nexport const n = [N, local, absent];\n`,
    { module: "preserve", moduleResolution: "bundler" },
    [
      `c.mts(2,10): error TS2459: Module '"./b.mjs"' declares 'local' locally, but it is not exported.`,
      `c.mts(2,17): error TS2305: Module '"./b.mjs"' has no exported member 'absent'.`,
    ],
  ],
  [
    "import = require first, spelled another way than what follows",
    `import N = require("./b.mjs");\nimport { local, absent } from "./b.mts";\nexport const n = [N, local, absent];\n`,
    { module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true },
    [
      `c.mts(2,10): error TS2459: Module '"./b.mts"' declares 'local' locally, but it is not exported.`,
      `c.mts(2,17): error TS2305: Module '"./b.mts"' has no exported member 'absent'.`,
    ],
  ],
])("%s", async (_, importer, options, errors) => {
  const compilerOptions = { strict: true, noEmit: true, target: "esnext", lib: ["esnext"], types: [], ...options };
  using dir = tempDir("check-modules-in-two-modes", {
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "b.mts": exporter,
    "c.mts": importer,
  });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  expect(stdout.trim().split("\n")).toEqual(errors);
});
