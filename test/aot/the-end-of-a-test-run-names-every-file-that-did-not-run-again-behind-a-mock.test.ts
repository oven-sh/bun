import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `import { test, vi } from "bun:test";\n`;
const ask = (at: string, file: string) => `  console.log("SAID", "${at}", (await import("./${file}")).show());\n`;
const inTest = (body: string) => `${head}test("t", async () => {\n${body}});\n`;
const esModules = {
  "floor.mjs": `export const level = "low";\n`,
  "meter.mjs": `import { level } from "./floor.mjs";\nexport const reading = "read " + level;\n`,
  "panel.mjs": `import { reading } from "./meter.mjs";\nexport const show = () => reading;\n`,
  "aside.mjs": `export const show = () => "aside";\n`,
};
const commonJs = {
  "floor.cjs": `exports.level = "low";\n`,
  "meter.cjs": `const { level } = require("./floor.cjs");\nexports.reading = "read " + level;\n`,
  "panel.cjs": `const { reading } = require("./meter.cjs");\nexports.show = () => reading;\n`,
};
// The build leaves the require() of an ES module or a data file that a mock may stand for to the run time.
const commonJsAbove = (floor: string) => ({
  "meter.cjs": `const { level } = require("./${floor}");\nexports.reading = "read " + level;\n`,
  "panel.cjs": commonJs["panel.cjs"],
});
const lay = (file: string) => `  vi.doMock("./${file}", () => ({ level: "deep" }));\n`;
// `bun test` links the modules that a factory imports to the original module and evicts them when the factory settles.
const mockAfterImporting = (file: string) =>
  `  vi.doMock("./floor.mjs", async () => {\n    await import("./${file}");\n    return { level: "deep" };\n  });\n` +
  `  console.log("SAID", "mock", (await import("./floor.mjs")).level);\n`;
const failAfterImporting = (file: string) =>
  `  vi.doMock("./floor.mjs", async () => {\n    await import("./${file}");\n    throw new Error("no floor");\n  });\n` +
  `  console.log("SAID", "mock", await import("./floor.mjs").then(() => "came", error => error.message));\n`;
// A require() inside a package is given a mocked module of that package itself, so the end of the mock changes nothing above it.
const requirerIn = (folder: string, name: string) => ({
  [`${folder}floor.mjs`]: esModules["floor.mjs"],
  [`${folder}meter.cjs`]: `exports.reading = "read " + require("./floor.mjs").level;\n`,
  "panel.mjs": `import meter from "${name}meter.cjs";\nexport const show = () => meter.reading;\n`,
  "b.test.mjs": inTest(
    `  vi.doMock("${name}floor.mjs", () => ({ level: "deep" }));\n  console.log("SAID", "mock", (await import("${name}floor.mjs")).level);\n` +
      ask("first", "panel.mjs") +
      `  vi.doUnmock("${name}floor.mjs");\n` +
      ask("second", "panel.mjs"),
  ),
});
// The test holds the door, so the second call reaches the panel by the require() in it and by nothing else.
const door = { "door.cjs": `exports.show = () => require("./panel.cjs").show();\n` };
const throughDoor = (body: string) => inTest(`  const door = await import("./door.cjs");\n` + body);
const call = (at: string) => `  console.log("SAID", "${at}", door.show());\n`;
// The desk makes its require() while the program runs, so its calls reach the gauge from outside the compiled code.
const desk = {
  "floor.cjs": `exports.level = "low";\n`,
  "gauge.cjs": `let reads = 0;\nexports.show = () => require("./floor.cjs").level + " " + ++reads;\n`,
  "desk.cjs": `const Module = require("node:module");\nconst ask = Module.createRequire(__filename);\nexports.show = () => ask("./gauge.cjs").show();\n`,
};
const atDesk = (body: string) =>
  `${head}const { doMock, doUnmock } = vi;\ntest("t", async () => {\n  const door = await import("./desk.cjs");\n${body}});\n`;
const layOverLoaded =
  call("first") +
  `  doMock("./floor.cjs", () => ({ level: "deep" }));\n` +
  call("under") +
  `  doUnmock("./floor.cjs");\n`;
// The kiln throws with no importer above it. `bun test` takes its failed entry out where a mock of vitest is made over it, so whoever asks next runs it again.
const kiln = { "kiln.mjs": `export const heat = "hot";\nthrow new Error("the kiln throws");\n` };
const potter = { "potter.mjs": `import { heat } from "./kiln.mjs";\nexport const pot = "fired " + heat;\n` };
const fire = (at: string, how = `import("./kiln.mjs")`) =>
  `  console.log("SAID", "${at}", await ${how}.then(() => "came", error => error.message));\n`;
const requireKiln = `  try {\n    createRequire(import.meta.url)("./kiln.mjs");\n  } catch (error) {\n    console.log("SAID", "second", error.message);\n  }\n`;
const runs = {
  "the next test file asks for a module above the mock": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.mjs")),
      "z.test.mjs": inTest(ask("second", "panel.mjs")),
    },
    named: ["meter.mjs, while z.test.mjs ran", "panel.mjs, while z.test.mjs ran"],
  },
  "the mock is removed and the same test asks again": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(
        lay("floor.mjs") + ask("first", "panel.mjs") + `  vi.doUnmock("./floor.mjs");\n` + ask("second", "panel.mjs"),
      ),
    },
    named: ["meter.mjs, while b.test.mjs ran", "panel.mjs, while b.test.mjs ran"],
  },
  "an earlier test file loaded the module and the next one mocks below it": {
    files: {
      ...esModules,
      "a.test.mjs": inTest(ask("earlier", "panel.mjs")),
      "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.mjs")),
    },
    named: ["meter.mjs, while b.test.mjs ran", "panel.mjs, while b.test.mjs ran"],
  },
  "CommonJS files that require the mocked file": {
    files: {
      ...commonJs,
      "b.test.mjs": inTest(lay("floor.cjs") + ask("first", "panel.cjs")),
      "z.test.mjs": inTest(ask("second", "panel.cjs")),
    },
    named: ["meter.cjs, while z.test.mjs ran", "panel.cjs, while z.test.mjs ran"],
  },
  "an earlier test file loaded CommonJS files and the next one mocks the file that they require": {
    files: {
      ...commonJs,
      "a.test.mjs": inTest(ask("earlier", "panel.cjs")),
      "b.test.mjs": inTest(lay("floor.cjs") + ask("first", "panel.cjs")),
    },
    named: ["meter.cjs, while b.test.mjs ran", "panel.cjs, while b.test.mjs ran"],
  },
  "CommonJS files that require a mocked ES module": {
    files: {
      "floor.mjs": esModules["floor.mjs"],
      ...commonJsAbove("floor.mjs"),
      "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.cjs")),
      "z.test.mjs": inTest(ask("second", "panel.cjs")),
    },
    named: ["meter.cjs, while z.test.mjs ran", "panel.cjs, while z.test.mjs ran"],
  },
  "an earlier test file loaded CommonJS files that require an ES module and the next one mocks it": {
    files: {
      "floor.mjs": esModules["floor.mjs"],
      ...commonJsAbove("floor.mjs"),
      "a.test.mjs": inTest(ask("earlier", "panel.cjs")),
      "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.cjs")),
    },
    named: ["meter.cjs, while b.test.mjs ran", "panel.cjs, while b.test.mjs ran"],
  },
  "CommonJS files that require a mocked data file": {
    files: {
      "floor.json": `{ "level": "low" }\n`,
      ...commonJsAbove("floor.json"),
      "b.test.mjs": inTest(lay("floor.json") + ask("first", "panel.cjs")),
      "z.test.mjs": inTest(ask("second", "panel.cjs")),
    },
    named: ["meter.cjs, while z.test.mjs ran", "panel.cjs, while z.test.mjs ran"],
  },
  "the mock is removed and the same test asks again by require()": {
    files: {
      ...commonJs,
      ...door,
      "b.test.mjs": throughDoor(lay("floor.cjs") + call("first") + `  vi.doUnmock("./floor.cjs");\n` + call("second")),
    },
    named: ["meter.cjs, while b.test.mjs ran", "panel.cjs, while b.test.mjs ran"],
  },
  "this test file had loaded the files, only the test loads the mock, and it asks again behind its end": {
    files: {
      ...commonJs,
      "b.test.mjs": inTest(
        ask("first", "panel.cjs") +
          lay("floor.cjs") +
          `  console.log("SAID", "mock", (await import("./floor.cjs")).level);\n` +
          ask("under", "panel.cjs") +
          `  vi.doUnmock("./floor.cjs");\n` +
          ask("second", "panel.cjs"),
      ),
    },
    named: [],
  },
  "the mock is removed and nobody asks again by require()": {
    files: {
      ...commonJs,
      ...door,
      "b.test.mjs": throughDoor(lay("floor.cjs") + call("first") + `  vi.doUnmock("./floor.cjs");\n`),
    },
    named: [],
  },
  "the mock is removed and a require() that was made while the program ran asks again": {
    files: { ...desk, "b.test.mjs": atDesk(layOverLoaded + call("second")) },
    named: ["gauge.cjs, while b.test.mjs ran"],
  },
  "the mock is removed and nobody asks again by a require() that was made while the program ran": {
    files: { ...desk, "b.test.mjs": atDesk(layOverLoaded) },
    named: [],
  },
  "three test files in workers of their own name a file once": {
    files: {
      ...esModules,
      ...Object.fromEntries(
        ["b", "c", "d"].map(name => [
          name + ".test.mjs",
          inTest(
            lay("floor.mjs") +
              ask("first", "panel.mjs") +
              `  vi.doUnmock("./floor.mjs");\n` +
              ask("second", "panel.mjs"),
          ),
        ]),
      ),
    },
    flags: ["--parallel"],
    named: ["meter.mjs", "panel.mjs"],
  },
  "a file threw, a mock without a factory is made over it, and import() asks again": {
    files: { ...kiln, "b.test.mjs": inTest(fire("first") + `  vi.doMock("./kiln.mjs");\n` + fire("second")) },
    named: ["kiln.mjs, while b.test.mjs ran"],
  },
  "a file threw, a mock without a factory is made over it, and require() asks again": {
    files: {
      ...kiln,
      "b.test.mjs":
        `import { createRequire } from "node:module";\n` +
        inTest(fire("first") + `  vi.doMock("./kiln.mjs");\n` + requireKiln),
    },
    named: ["kiln.mjs, while b.test.mjs ran"],
  },
  "a file threw, a mock is made over it, and importActual() evaluates the file again": {
    files: {
      ...kiln,
      "b.test.mjs": inTest(
        fire("first") +
          `  vi.doMock("./kiln.mjs", () => ({ heat: "mild" }));\n` +
          fire("second", `vi.importActual("./kiln.mjs")`),
      ),
    },
    named: [],
  },
  "a file threw, a factory that takes the original is made over it, and require() asks again": {
    files: {
      ...kiln,
      "b.test.mjs":
        `import { createRequire } from "node:module";\n` +
        inTest(
          fire("first") +
            `  vi.doMock("./kiln.mjs", async original => ({ heat: (await original()).heat }));\n` +
            requireKiln +
            `  await new Promise(done => setTimeout(done, 300));\n`,
        ),
    },
    named: ["kiln.mjs, while b.test.mjs ran"],
  },
  "a file threw below its importer, where `bun test` keeps the failure too": {
    files: {
      ...kiln,
      ...potter,
      "b.test.mjs": inTest(fire("first", `import("./potter.mjs")`) + `  vi.doMock("./kiln.mjs");\n` + fire("second")),
    },
    named: [],
  },
  "a file threw, a mock without a factory is made over it, and nobody asks again": {
    files: { ...kiln, "b.test.mjs": inTest(fire("first") + `  vi.doMock("./kiln.mjs");\n`) },
    named: [],
  },
  "factory's importer is imported again": {
    files: { ...esModules, "b.test.mjs": inTest(mockAfterImporting("panel.mjs") + ask("second", "panel.mjs")) },
    named: ["meter.mjs, while b.test.mjs ran", "panel.mjs, while b.test.mjs ran"],
  },
  "factory's importer is never reimported": {
    files: { ...esModules, "b.test.mjs": inTest(mockAfterImporting("panel.mjs")) },
    named: [],
  },
  "factory imports an unrelated module": {
    files: { ...esModules, "b.test.mjs": inTest(mockAfterImporting("aside.mjs") + ask("second", "aside.mjs")) },
    named: [],
  },
  "modules reset before the reimport": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(mockAfterImporting("panel.mjs") + `  vi.resetModules();\n` + ask("second", "panel.mjs")),
    },
    named: [],
  },
  "failed factory's importer is reimported": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(failAfterImporting("panel.mjs") + `  await import("./panel.mjs").catch(() => {});\n`),
    },
    named: ["meter.mjs, while b.test.mjs ran", "panel.mjs, while b.test.mjs ran"],
  },
  "failed factory's importer never reimported": {
    files: { ...esModules, "b.test.mjs": inTest(failAfterImporting("panel.mjs")) },
    named: [],
  },
  "package's own requirer is unaffected": {
    files: {
      "node_modules/@made-up/kit/package.json": `{ "name": "@made-up/kit" }`,
      ...requirerIn("node_modules/@made-up/kit/", "@made-up/kit/"),
    },
    named: [],
  },
  "project's requirer is named": {
    files: requirerIn("", "./"),
    named: ["meter.cjs, while b.test.mjs ran", "panel.mjs, while b.test.mjs ran"],
  },
  "nobody asks again": {
    files: { ...esModules, "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.mjs")) },
    named: [],
  },
  "the next test file asks for a module that no mock lies below": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(lay("floor.mjs") + ask("first", "panel.mjs")),
      "z.test.mjs": inTest(ask("second", "aside.mjs")),
    },
    named: [],
  },
  "no mock": {
    files: {
      ...esModules,
      "b.test.mjs": inTest(ask("first", "panel.mjs")),
      "z.test.mjs": inTest(ask("second", "panel.mjs")),
    },
    named: [],
  },
};

test.each(Object.entries(runs))(
  "%s",
  async (_, { files, named, flags = [] }: { files: object; named: string[]; flags?: string[] }) => {
    using directory = tempDir("files-that-did-not-run-again", { "package.json": `{ "name": "made-up" }`, ...files });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", ...flags], String(directory), bunEnv);
    const lines = (stdout + "\n" + stderr).split("\n");
    const rows = lines.filter(line => /^\s*\S+, while .+ ran$/.test(line)).map(line => line.trim());
    const listed = flags.length ? rows.map(row => row.split(",")[0]) : rows;
    expect(listed.sort()).toEqual(named);
    expect(lines.some(line => line.includes("didn't run again"))).toBe(named.length > 0);
    expect(exitCode).toBe(0);
  },
);
