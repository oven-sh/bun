import { expect } from "bun:test";
import { test } from "./supported";
import { symlinkSync } from "node:fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function run(files: Record<string, string>, links: Record<string, string> = {}) {
  using dir = tempDir("aot-outside-the-bundle", files);
  for (const [link, target] of Object.entries(links)) symlinkSync(target, join(String(dir), link), "dir");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--debug-aot", "src/main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function tsconfig(compilerOptions: Record<string, unknown> = {}) {
  return JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [], ...compilerOptions },
    include: ["src", "tests"],
  });
}

function declaresGlobal(name: string) {
  return `export declare const value: number;\ndeclare global {\n  var ${name}: number | undefined;\n}\n`;
}

function typedPackage(root: string, name: string, global: string) {
  return {
    [`${root}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js", types: "index.d.ts" }),
    [`${root}/index.js`]: `exports.value = 1;\n`,
    [`${root}/index.d.ts`]: declaresGlobal(global),
  };
}

function expectSeen(result: { stdout: string; stderr: string; exitCode: number }, count: number) {
  expect(result.stderr).not.toContain("Cannot find name");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: Array(count).fill("undefined").join(" ") + "\n", exitCode: 0 });
}

function expectNotSeen(result: { stdout: string; stderr: string; exitCode: number }, name: string) {
  expect(result.stderr).toContain(`Cannot find name '${name}'`);
  expect(result.stdout).toBe("");
  expect(result.exitCode).not.toBe(0);
}

test("globals that packages declare are found through files that only tsconfig.json includes", async () => {
  const count = 60;
  const packages = Object.assign({}, ...Array.from({ length: count }, (_, index) => typedPackage(`node_modules/package-${index}`, `package-${index}`, `fromPackage${index}`)));
  const imports = Array.from({ length: count }, (_, index) => `import { value as value${index} } from "package-${index}";`).join("\n");
  const sum = Array.from({ length: count }, (_, index) => `value${index}`).join(" + ");
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      ...packages,
      "tests/setup.ts": `${imports}\nexport const sum = ${sum};\n`,
      "src/main.ts": `console.log(typeof fromPackage0, typeof fromPackage31, typeof fromPackage59);\n`,
    }),
    3,
  );
});

test("a package that no file of the project imports declares nothing", async () => {
  const result = await run({
    "tsconfig.json": tsconfig(),
    ...typedPackage("node_modules/imported", "imported", "fromImported"),
    ...typedPackage("node_modules/installed", "installed", "fromInstalled"),
    "tests/setup.ts": `import { value } from "imported";\nexport const one = value;\n`,
    "src/main.ts": `console.log(typeof fromImported, typeof fromInstalled);\n`,
  });
  expectNotSeen(result, "fromInstalled");
  expect(result.stderr).not.toContain("Cannot find name 'fromImported'");
});

test("a file outside the bundle that adds to a module of the program is in the program", async () => {
  const result = await run({
    "tsconfig.json": tsconfig(),
    "src/rules.ts": `export interface Rules {\n  known?: number;\n}\nexport function count(rules: Rules): number {\n  return Object.keys(rules).length;\n}\n`,
    "tests/more-rules.ts": `export {};\ndeclare module "../src/rules" {\n  interface Rules {\n    custom?: number;\n  }\n}\n`,
    "tests/other.ts": `export const unrelated = 1;\n`,
    "src/main.ts": `import { count, type Rules } from "./rules";\nconst rules: Rules = { custom: 1 };\nconsole.log(count(rules));\n`,
  });
  expect(result.stderr).not.toContain("error");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
});

test("a file outside the bundle that declares a global itself is in the program", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      "tests/globals.ts": `declare global {\n  var fromTheTests: number | undefined;\n}\nexport {};\n`,
      "tests/other.ts": `export const unrelated = 1;\n`,
      "src/main.ts": `console.log(typeof fromTheTests);\n`,
    }),
    1,
  );
});

test("paths inside a package stand for the package", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      ...typedPackage("node_modules/parts", "parts", "fromParts"),
      "node_modules/parts/first.js": `exports.first = 1;\n`,
      "node_modules/parts/second.js": `exports.second = 2;\n`,
      ...typedPackage("node_modules/@scope/parts", "@scope/parts", "fromScopedParts"),
      "node_modules/@scope/parts/deep/third.js": `exports.third = 3;\n`,
      "tests/one.ts": `import { first } from "parts/first.js";\nexport const one = first;\n`,
      "tests/two.ts": `import { second } from "parts/second.js";\nimport { third } from "@scope/parts/deep/third.js";\nexport const two = [second, third];\n`,
      "src/main.ts": `console.log(typeof fromParts, typeof fromScopedParts);\n`,
    }),
    2,
  );
});

test("the declarations of an untyped package are looked for under @types", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      "node_modules/untyped/package.json": JSON.stringify({ name: "untyped", version: "1.0.0", main: "index.js" }),
      "node_modules/untyped/index.js": `exports.value = 1;\n`,
      ...typedPackage("node_modules/@types/untyped", "@types/untyped", "fromTypesOfUntyped"),
      "node_modules/@scope/untyped/package.json": JSON.stringify({ name: "@scope/untyped", version: "1.0.0", main: "index.js" }),
      "node_modules/@scope/untyped/index.js": `exports.value = 1;\n`,
      ...typedPackage("node_modules/@types/scope__untyped", "@types/scope__untyped", "fromTypesOfScopedUntyped"),
      "tests/setup.ts": `import { value } from "untyped";\nimport { value as scoped } from "@scope/untyped/index.js";\nexport const both = [value, scoped];\n`,
      "src/main.ts": `console.log(typeof fromTypesOfUntyped, typeof fromTypesOfScopedUntyped);\n`,
    }),
    2,
  );
});

test("declarations that only an exports map names are not looked for", async () => {
  expectNotSeen(
    await run({
      "tsconfig.json": tsconfig(),
      "node_modules/mapped/package.json": JSON.stringify({
        name: "mapped",
        version: "1.0.0",
        exports: { ".": { types: "./types/main.d.ts", custom: "./custom.js", default: "./index.js" }, "./sub": { types: "./types/sub.d.ts", default: "./sub.js" } },
      }),
      "node_modules/mapped/index.js": `exports.value = 1;\n`,
      "node_modules/mapped/custom.js": `exports.value = 2;\n`,
      "node_modules/mapped/sub.js": `exports.value = 3;\n`,
      "node_modules/mapped/types/main.d.ts": declaresGlobal("fromMapped"),
      "node_modules/mapped/types/sub.d.ts": declaresGlobal("fromMappedSub"),
      "tests/setup.ts": `import { value } from "mapped";\nimport { value as sub } from "mapped/sub";\nexport const both = [value, sub];\n`,
      "src/main.ts": `console.log(typeof fromMapped);\n`,
    }),
    "fromMapped",
  );
});

test("a project that imports itself by its own name is no installed package", async () => {
  expectNotSeen(
    await run({
      "tsconfig.json": tsconfig(),
      "package.json": JSON.stringify({ name: "itself", version: "1.0.0", types: "index.d.ts", exports: { "./*": "./*" } }),
      "index.d.ts": declaresGlobal("fromItself"),
      "src/library.ts": `export const value = 1;\n`,
      "tests/setup.ts": `import { value } from "itself/src/library.ts";\nexport const one = value;\n`,
      "src/main.ts": `console.log(typeof fromItself);\n`,
    }),
    "fromItself",
  );
});

test("a name that paths of tsconfig.json leads elsewhere still stands for the installed package", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig({ paths: { shadowed: ["./src/local.ts"], "shadowed/*": ["./src/*"] } }),
      ...typedPackage("node_modules/shadowed", "shadowed", "fromShadowed"),
      "src/local.ts": `export const value = 1;\n`,
      "tests/setup.ts": `import { value } from "shadowed";\nimport { value as again } from "shadowed/local.ts";\nexport const both = [value, again];\n`,
      "src/main.ts": `console.log(typeof fromShadowed);\n`,
    }),
    1,
  );
});

test("bare paths into the project itself name no package", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 40; index++) {
    files[`src/parts/part${index}.ts`] = `export const part${index} = ${index};\n`;
    files[`tests/deep/er/test${index}.ts`] = `import { part${index} } from "src/parts/part${index}.ts";\nimport { value } from "real";\nexport const seen = [part${index}, value];\n`;
  }
  expectSeen(
    await run({
      "tsconfig.json": tsconfig({ paths: { "src/*": ["./src/*"] }, allowImportingTsExtensions: true, noEmit: true }),
      ...typedPackage("node_modules/real", "real", "fromReal"),
      ...files,
      "src/main.ts": `console.log(typeof fromReal);\n`,
    }),
    1,
  );
});

test("a package of a workspace is found through its link, by its real path", async () => {
  expectSeen(
    await run(
      {
        "tsconfig.json": tsconfig(),
        ...typedPackage("packages/member", "member", "fromMember"),
        "node_modules/placeholder/package.json": JSON.stringify({ name: "placeholder", version: "1.0.0" }),
        "tests/setup.ts": `import { value } from "member";\nimport { value as again } from "member/index.js";\nexport const both = [value, again];\n`,
        "src/main.ts": `console.log(typeof fromMember);\n`,
      },
      { "node_modules/member": "../packages/member" },
    ),
    1,
  );
});

test("each importer finds the copy of a package that is nearest to it", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      ...typedPackage("tests/first/node_modules/twin", "twin", "fromFirstTwin"),
      "tests/first/node_modules/twin/one.js": `exports.one = 1;\n`,
      ...typedPackage("tests/second/node_modules/twin", "twin", "fromSecondTwin"),
      "tests/second/node_modules/twin/two.js": `exports.two = 2;\n`,
      ...typedPackage("node_modules/twin", "twin", "fromOuterTwin"),
      "node_modules/twin/three.js": `exports.three = 3;\n`,
      "tests/first/uses.ts": `import { one } from "twin/one.js";\nexport const first = one;\n`,
      "tests/second/uses.ts": `import { two } from "twin/two.js";\nexport const second = two;\n`,
      "tests/uses.ts": `import { three } from "twin/three.js";\nexport const third = three;\n`,
      "src/main.ts": `console.log(typeof fromFirstTwin, typeof fromSecondTwin, typeof fromOuterTwin);\n`,
    }),
    3,
  );
});

test("directories of one name in different places each find their own copy of a package", async () => {
  expectSeen(
    await run({
      "tsconfig.json": tsconfig(),
      ...typedPackage("tests/left/shared/node_modules/twin", "twin", "fromLeftTwin"),
      "tests/left/shared/node_modules/twin/one.js": `exports.one = 1;\n`,
      ...typedPackage("tests/right/shared/node_modules/twin", "twin", "fromRightTwin"),
      "tests/right/shared/node_modules/twin/two.js": `exports.two = 2;\n`,
      "tests/left/shared/uses.ts": `import { one } from "twin/one.js";\nexport const left = one;\n`,
      "tests/right/shared/uses.ts": `import { two } from "twin/two.js";\nexport const right = two;\n`,
      "src/main.ts": `console.log(typeof fromLeftTwin, typeof fromRightTwin);\n`,
    }),
    2,
  );
});

test("of the importers of one specifier the first in the project is the one that is asked from", async () => {
  const files = {
    "tsconfig.json": tsconfig(),
    ...typedPackage("tests/first/node_modules/twin", "twin", "fromFirstTwin"),
    ...typedPackage("tests/second/node_modules/twin", "twin", "fromSecondTwin"),
    "tests/first/uses.ts": `import { value } from "twin";\nexport const first = value;\n`,
    "tests/second/uses.ts": `import { value } from "twin";\nexport const second = value;\n`,
  };
  expectSeen(await run({ ...files, "src/main.ts": `console.log(typeof fromFirstTwin);\n` }), 1);
  expectNotSeen(await run({ ...files, "src/main.ts": `console.log(typeof fromSecondTwin);\n` }), "fromSecondTwin");
});

test("a file outside the bundle that the build script writes while it bundles counts as it is then", async () => {
  using dir = tempDir("aot-outside-the-bundle", {
    "tsconfig.json": tsconfig(),
    "tests/written-late.ts": `export const nothing = 0;\n`,
    "src/asset.d.ts": `declare module "*.asset" {\n  const path: string;\n  export default path;\n}\n`,
    "src/late.asset": `late\n`,
    "src/main.ts": `import late from "./late.asset";\nconsole.log(typeof late, typeof fromWrittenLate);\n`,
    "build.ts": `
      import { writeFileSync } from "node:fs";
      const result = await Bun.build({
        entrypoints: [import.meta.dir + "/src/main.ts"],
        compile: { aot: true, outfile: import.meta.dir + "/out" },
        plugins: [
          {
            name: "writes late",
            setup(build) {
              build.onLoad({ filter: /\\.asset$/ }, async () => {
                await Bun.sleep(500);
                writeFileSync(import.meta.dir + "/tests/written-late.ts", "declare global {\\n  var fromWrittenLate: number | undefined;\\n}\\nexport {};\\n");
                return { contents: "late", loader: "file" };
              });
            },
          },
        ],
      });
      if (!result.success) {
        console.error(result.logs.join("\\n"));
        process.exit(1);
      }
    `,
  });
  await using build = Bun.spawn({ cmd: [bunExe(), "build.ts"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(buildErrors).not.toContain("Cannot find name");
  expect(buildExitCode).toBe(0);
  await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "string undefined\n", exitCode: 0 });
});

async function buildWithLateWrites(files: Record<string, string>, written: Record<string, string>) {
  using dir = tempDir("aot-outside-the-bundle", {
    "tsconfig.json": tsconfig(),
    "src/asset.d.ts": `declare module "*.asset" {\n  const path: string;\n  export default path;\n}\n`,
    "src/late.asset": `late\n`,
    ...files,
    "written.json": JSON.stringify(written),
    "build.ts": `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { dirname } from "node:path";
      import written from "./written.json";
      const result = await Bun.build({
        entrypoints: [import.meta.dir + "/src/main.ts"],
        compile: { aot: true, outfile: import.meta.dir + "/out" },
        plugins: [
          {
            name: "writes late",
            setup(build) {
              build.onLoad({ filter: /\\.asset$/ }, async () => {
                await Bun.sleep(500);
                for (const [path, text] of Object.entries(written)) {
                  mkdirSync(dirname(import.meta.dir + "/" + path), { recursive: true });
                  writeFileSync(import.meta.dir + "/" + path, text);
                }
                return { contents: "late", loader: "file" };
              });
            },
          },
        ],
      });
      if (!result.success) {
        console.error(result.logs.join("\\n"));
        process.exit(1);
      }
    `,
  });
  await using build = Bun.spawn({ cmd: [bunExe(), "build.ts"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  if (buildExitCode !== 0) return { buildErrors, buildExitCode, stdout: "", exitCode: -1 };
  await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { buildErrors, buildExitCode, stdout, exitCode };
}

test("type-only file rewritten during bundling is re-read", async () => {
  const result = await buildWithLateWrites(
    {
      "src/shapes.ts": `export type Shape = { width: number };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { Shape } from "./shapes";\nconst shape: Shape = { width: 2, name: "wide" };\nconsole.log(typeof late, shape.width, shape.name);\n`,
    },
    { "src/shapes.ts": `export type Shape = { width: number; name: string };\n` },
  );
  expect(result.buildErrors).not.toContain("does not exist in type");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "string 2 wide\n", exitCode: 0 });
});

test("type-only file that loses a member during bundling fails the build", async () => {
  const result = await buildWithLateWrites(
    {
      "src/shapes.ts": `export type Shape = { width: number; name: string };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { Shape } from "./shapes";\nconst shape: Shape = { width: 2, name: "wide" };\nconsole.log(typeof late, shape.width, shape.name);\n`,
    },
    { "src/shapes.ts": `export type Shape = { width: number };\n` },
  );
  expect(result.buildErrors).toContain("does not exist in type");
  expect(result.buildExitCode).not.toBe(0);
});

test("type-only file added to a cached directory during bundling is resolved", async () => {
  const result = await buildWithLateWrites(
    {
      "src/generated/first.ts": `export type First = { first: number };\n`,
      "src/main.ts": `import late from "./late.asset";\nimport type { First } from "./generated/first";\nimport type { Second } from "./generated/second";\nconst first: First = { first: 1 };\nconst second: Second = { second: "two" };\nconsole.log(typeof late, first.first, second.second);\n`,
    },
    { "src/generated/second.ts": `export type Second = { second: string };\n` },
  );
  expect(result.buildErrors).not.toContain("Cannot find module");
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "string 1 two\n", exitCode: 0 });
});

test("a folder of packages that is itself a link is looked into", async () => {
  expectSeen(
    await run(
      {
        "tsconfig.json": tsconfig(),
        ...typedPackage("store/linked", "linked", "fromLinkedFolder"),
        "tests/nested/deeper/setup.ts": `import { value } from "linked";\nexport const one = value;\n`,
        "src/main.ts": `console.log(typeof fromLinkedFolder);\n`,
      },
      { "tests/node_modules": "../store" },
    ),
    1,
  );
});
