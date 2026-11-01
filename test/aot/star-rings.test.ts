// `export *` leads round in rings and meets again behind a fork. A name that nobody behind the stars has ends the load with a SyntaxError, and a search for it ends.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const ring = (behind: string) => ({
  "package.json": `{ "name": "p" }`,
  "index.mjs": `export * from "./a.mjs";\nexport * from "./b.mjs";\n`,
  "a.mjs": `export * from "./index.mjs";\n${behind}export const a = 1;\n`,
  "b.mjs": `export * from "./index.mjs";\n${behind}export const b = 2;\n`,
  "main.mjs": `import { nothing } from "./index.mjs";\nconsole.log("SEEN main", nothing);\n`,
  "a.test.mjs": `import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./main.mjs");
  } catch (error) {
    console.log("SEEN caught", error.name);
  }
});
`,
});

const projects: Record<string, Record<string, string>> = {
  "ES modules alone": ring(""),
  "a CommonJS file of the project behind two of the stars": {
    ...ring(`export * from "./c.cjs";\n`),
    "c.cjs": `exports.c = 3;\n`,
  },
  "a package behind two of the stars": {
    ...ring(`export * from "pkg";\n`),
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "./index.js" }`,
    "node_modules/pkg/index.js": `exports.c = 3;\n`,
  },
};

// Two modules a level, each with a star over both of the next level: as many ways down as two to the power of the levels.
const forks = (levels: number, main: string) => ({
  "package.json": `{ "name": "p" }`,
  ...Object.fromEntries(
    Array.from({ length: levels * 2 }, (_, index) => {
      const level = index >> 1;
      const next = level + 1 < levels ? ["a", "b"].map(side => `l${level + 1}${side}`) : ["m"];
      return [`l${level}${"ab"[index & 1]}.mjs`, next.map(name => `export * from "./${name}.mjs";\n`).join("")];
    }),
  ),
  "m.mjs": `export const m = "real m", gone = "real gone";\n`,
  "main.mjs": main,
  "a.test.mjs": `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./m.mjs", () => ({ m: "mock m" }));
  await import("./main.mjs");
});
`,
});

const forked: Record<string, { main: string; expected: string[]; more?: Record<string, string> }> = {
  "a name that the mock has, and the namespace object": {
    main: `import * as ns from "./l0a.mjs";\nimport { m } from "./l0a.mjs";\nconsole.log("SEEN main", m, ns.gone, Object.keys(ns).join());\n`,
    expected: ["SEEN main mock m undefined m"],
  },
  "a name that the mock leaves out": {
    main: `import { gone } from "./l0a.mjs";\nconsole.log("SEEN main", gone);\n`,
    expected: ["SEEN main undefined"],
  },
  // A mock that lacks the name sends the run past what lies below it, so what was asked there is asked again behind it.
  "below modules that another test file mocks": {
    main: `import { m, gone } from "./top.mjs";\nconsole.log("SEEN main", m, gone);\n`,
    expected: ["SEEN main mock m undefined", "SEEN other real m mock own"],
    more: {
      "top.mjs": `export * from "./l0a.mjs";\nexport * from "./l0b.mjs";\n`,
      "l0a.mjs": `export * from "./l1a.mjs";\nexport * from "./l1b.mjs";\nexport const own = "real own";\n`,
      "other.mjs": `import { m, own } from "./top.mjs";\nconsole.log("SEEN other", m, own);\n`,
      "b.test.mjs": `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./l0a.mjs", () => ({ own: "mock own" }));
  mock.module("./l1a.mjs", () => ({}));
  await import("./other.mjs");
});
`,
    },
  },
};

async function seen(files: Record<string, string>, words?: string) {
  using dir = tempDir("aot-star-rings", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...(words ? ["--aot"] : [])], String(dir), env);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [name, { main, expected, more }] of Object.entries(forked)) {
  test.concurrent.each([
    ["plain Bun", undefined],
    ["one program", "TestRunLayers:0"],
    ["two layers", "TestRunLayers:2"],
  ])(`26 levels of forked stars over a mocked module: ${name}: %s`, async (_, words) => {
    expect(await seen({ ...forks(26, main), ...more }, words)).toEqual({ stdout: expected, exitCode: 0 });
  });
}

for (const [name, files] of Object.entries(projects)) {
  test.concurrent.each([
    ["plain Bun", undefined],
    ["one program", "TestRunLayers:0"],
    ["one layer", "TestRunLayers:1"],
    ["two layers", "TestRunLayers:2"],
  ])(`${name}: %s`, async (_, words) => {
    expect(await seen(files, words)).toEqual({ stdout: ["SEEN caught SyntaxError"], exitCode: 0 });
  });
}
