import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

setDefaultTimeout(isASAN || isDebug ? 120_000 : 30_000);

const lines = (line: (index: number) => string) => Array.from({ length: 3000 }, (_, index) => line(index)).join("\n");
const wideModule = `export const value = 1;\n${lines(i => `export function f${i}(a: number, b: string): string { return b + (a * ${i}).toString(); }`)}\n`;
const wideCommonJS = `exports.value = 1;\n${lines(i => `exports.f${i} = function (a, b) { return b + (a * ${i}).toString(); };`)}\n`;
const importsWide = `import { value } from "./wide.ts";\nexport const next = value + 1;\n`;
const leavesAnImportBehind = (file: string) => `
  import { expect, test } from "bun:test";
  test("starts an import() and ends", () => {
    import("./${file}");
    expect(1).toBe(1);
  });
`;

const cases: Record<string, Record<string, string>> = {
  "two import() calls of one file at once": {
    "one.ts": `export const value = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
      const [first, second] = await Promise.all([import("./one.ts"), import("./one.ts")]);
      test("both are one module, and it is cached", () => {
        expect(first).toBe(second);
        expect(isolatedModuleCacheSourceType(require.resolve("./one.ts"))).toBe("BunTranspiledModule");
      });
    `,
  },
  "import() of a file beside import() of a file that imports it": {
    "wide.ts": wideModule,
    "imports-wide.ts": importsWide,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      const [wide, importer] = await Promise.all([import("./wide.ts"), import("./imports-wide.ts")]);
      test("the importer saw the same module", () => {
        expect(importer.next).toBe(wide.value + 1);
      });
    `,
  },
  "import() of a file beside import() of a file that imports it, inside a test": {
    "wide.ts": wideModule,
    "imports-wide.ts": importsWide,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      test("the importer saw the same module", async () => {
        const [importer, wide] = await Promise.all([import("./imports-wide.ts"), import("./wide.ts")]);
        expect(importer.next).toBe(wide.value + 1);
      });
    `,
  },
  "require() of a file that an import() is fetching": {
    "wide.ts": wideModule,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      const pending = import("./wide.ts");
      const required = require("./wide.ts");
      const imported = await pending;
      test("both are one module", () => {
        expect(required.f1).toBe(imported.f1);
      });
    `,
  },
  "require() of a file that an import statement is fetching": {
    "wide.ts": wideModule,
    "imports-wide.ts": importsWide,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
      const pending = import("./imports-wide.ts");
      while (isolatedModuleCacheSourceType(require.resolve("./imports-wide.ts")) === null) {
        await new Promise(resolve => setImmediate(resolve));
      }
      await new Promise(resolve => setImmediate(resolve));
      const required = require("./wide.ts");
      const importer = await pending;
      test("the importer saw the same module", () => {
        expect(importer.next).toBe(required.value + 1);
      });
    `,
  },
  "two import() calls of one CommonJS file at once": {
    "wide.cjs": wideCommonJS,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      const [first, second] = await Promise.all([import("./wide.cjs"), import("./wide.cjs")]);
      test("both are one module", () => {
        expect(first).toBe(second);
      });
    `,
  },
  "a file imports what the import() of the file before it is fetching": {
    "wide.ts": wideModule,
    "a.test.ts": leavesAnImportBehind("wide.ts"),
    "b.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./wide.ts";
      test("it is loaded", () => {
        expect(value).toBe(1);
      });
    `,
  },
  "a file imports the CommonJS file that the import() of the file before it is fetching": {
    "wide.cjs": wideCommonJS,
    "a.test.ts": leavesAnImportBehind("wide.cjs"),
    "b.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./wide.cjs";
      test("it is loaded", () => {
        expect(value).toBe(1);
      });
    `,
  },
  "import() with a type attribute of a file that is cached": {
    "one.ts": `export const value = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./one.ts";
      const again = await import("./one.ts", { with: { type: "ts" } });
      test("both load", () => {
        expect(again.value).toBe(value);
      });
    `,
  },
  "the default loader of require.extensions is called for a CommonJS file that is cached": {
    "one.cjs": `exports.value = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import Module from "node:module";
      const path = require.resolve("./one.cjs");
      const first = require("./one.cjs");
      const second = new Module(path);
      Module._extensions[".js"](second, path);
      test("it ran the file again", () => {
        expect(second.exports).toEqual(first);
        expect(second.exports).not.toBe(first);
      });
    `,
  },
  "the default loader of require.extensions is called for an ES module that is cached": {
    "one.mjs": `export const value = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import Module from "node:module";
      const path = require.resolve("./one.mjs");
      const first = require("./one.mjs");
      Module._extensions[".js"](new Module(path), path);
      test("it is loaded", () => {
        expect(first.value).toBe(1);
      });
    `,
  },
};

test.concurrent.each(Object.entries(cases))("--isolate: %s", async (_, files) => {
  using dir = tempDir("isolate-one-module-fetched-twice", files);
  const testFiles = Object.keys(files).filter(file => file.endsWith(".test.ts"));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", ...testFiles.map(file => `./${file}`)],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`${testFiles.length} pass`);
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});
