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
const lay = (file: string) => `  vi.doMock("./${file}", () => ({ level: "deep" }));\n`;
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
    const rows = lines.filter(line => / ran$/.test(line) && line.includes(", while ")).map(line => line.trim());
    const listed = flags.length ? rows.map(row => row.split(",")[0]) : rows;
    expect(listed.sort()).toEqual(named);
    expect(lines.some(line => line.includes("didn't run again"))).toBe(named.length > 0);
    expect(exitCode).toBe(0);
  },
);
