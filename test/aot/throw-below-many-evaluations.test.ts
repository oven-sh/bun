// A file at the bottom of many files that load one another catches what a require() throws. Only the files that the error left have failed.
// The run time marks what an evaluation begins with a byte. Evaluations nested more deeply than a byte counts shared a mark, and all of them failed.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { run } from "./harness/run";
import { test } from "./supported";

const catches = `let found = "none";
try { found = require("./extra.mjs").title; } catch (error) { found = "caught " + error.message; }
globalThis.found = found;
`;
const level = (next: string) => `module.exports = { level: require("./${next}").level + 1 };\n`;

/** Each of them writes the files of `count` levels. The first level is first.*. */
const shapes = {
  "a module imports a CommonJS file, which requires the next module"(count: number) {
    const files: Record<string, string> = { "first.cjs": `module.exports = require("./e0.mjs");\n` };
    for (let k = 0; k < count; k++) {
      files[`e${k}.mjs`] = `import below from "./r${k}.cjs";\nexport const level = below.level;\n`;
      files[`r${k}.cjs`] = k + 1 < count ? level(`e${k + 1}.mjs`) : catches + "module.exports = { level: 1 };\n";
    }
    return files;
  },
  "the same with a cycle at each level"(count: number) {
    const files: Record<string, string> = { "first.cjs": `module.exports = require("./e0.mjs");\n` };
    for (let k = 0; k < count; k++) {
      files[`e${k}.mjs`] =
        `import { side } from "./s${k}.mjs";\nimport below from "./r${k}.cjs";\nexport const level = below.level;\nexport const sides = () => side();\n`;
      files[`s${k}.mjs`] = `import { level } from "./e${k}.mjs";\nexport const side = () => level;\n`;
      files[`r${k}.cjs`] = k + 1 < count ? level(`e${k + 1}.mjs`) : catches + "module.exports = { level: 1 };\n";
    }
    return files;
  },
  "the error is caught half way up"(count: number) {
    const files: Record<string, string> = { "first.cjs": `module.exports = require("./e0.mjs");\n` };
    for (let k = 0; k < count; k++) {
      files[`e${k}.mjs`] = `import below from "./r${k}.cjs";\nexport const level = below.level;\n`;
      files[`r${k}.cjs`] = k + 1 < count ? level(`e${k + 1}.mjs`) : `throw new Error("nothing here");\n`;
      if (k === count / 2)
        files[`r${k}.cjs`] =
          `let level = ${count / 2 - 1};\ntry { level = require("./e${k + 1}.mjs").level; } catch (error) { globalThis.found = "caught " + error.message; }\nmodule.exports = { level: level + 1 };\n`;
    }
    return files;
  },
  "modules import one another"(count: number) {
    const files: Record<string, string> = { "first.cjs": `module.exports = require("./m0.mjs");\n` };
    for (let k = 0; k < count; k++)
      files[`m${k}.mjs`] =
        k + 1 < count
          ? `import { level as below } from "./m${k + 1}.mjs";\nexport const level = below + 1;\n`
          : catches + "export const level = 1;\n";
    return files;
  },
  "CommonJS files require one another"(count: number) {
    const files: Record<string, string> = { "first.cjs": `module.exports = require("./r0.cjs");\n` };
    for (let k = 0; k < count; k++)
      files[`r${k}.cjs`] = k + 1 < count ? level(`r${k + 1}.cjs`) : catches + "module.exports = { level: 1 };\n";
    return files;
  },
} satisfies Record<string, (count: number) => Record<string, string>>;

// Each level of the first three takes some kilobytes of stack, three times as many under ASan.
const cases: [keyof typeof shapes, number][] = [
  ["a module imports a CommonJS file, which requires the next module", 100],
  ["a module imports a CommonJS file, which requires the next module", 250],
  ["a module imports a CommonJS file, which requires the next module", isASAN ? 300 : 600],
  ["the same with a cycle at each level", 250],
  ["the same with a cycle at each level", isASAN ? 300 : 400],
  ["the error is caught half way up", isASAN ? 300 : 600],
  ["modules import one another", 4_000],
  ["CommonJS files require one another", isASAN ? 600 : 1_000],
];

const load = (call: string) => `let first;
try { first = (${call}).level; } catch (error) { first = "thrown " + error.message; }
console.log("level", first, globalThis.found);
`;

for (const [shape, count] of cases)
  test(`${shape}: ${count}`, async () => {
    using dir = tempDir("aot-throw-below", {
      "package.json": `{ "name": "p" }`,
      "extra.mjs": `import "./inner.cjs";\nexport const title = "extra";\n`,
      "inner.cjs": `throw new Error("nothing here");\n`,
      "require.cjs": load(`require("./first.cjs")`),
      "import.mjs": load(`(await import("./first.cjs")).default`),
      // describe() has no time limit. A test has five seconds, which some hundred files take where forty runs share eight processors.
      "levels.test.cjs": `const { describe, test } = require("bun:test");\ndescribe("levels", () => {\n${load(`require("./first.cjs")`)}test("stand", () => {});\n});\n`,
      ...shapes[shape](count),
    });
    const folder = String(dir);
    const line = `level ${count} caught nothing here`;
    const lines = (text: string) => text.split("\n").filter(each => each.startsWith("level "));
    for (const entry of ["require.cjs", "import.mjs"]) {
      const executable = join(folder, isWindows ? "levels.exe" : "levels");
      const build = [bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable];
      built(await spawned(build, folder, bunEnv));
      const { stdout, exitCode } = await spawned([executable], folder, bunEnv);
      expect({ entry, lines: lines(stdout), exitCode }).toEqual({ entry, lines: [line], exitCode: 0 });
    }
    for (const flags of [[], ["--aot"]]) {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./levels.test.cjs"], folder, bunEnv);
      const said = exitCode ? stderr : "";
      expect({ flags, lines: lines(stdout), exitCode, said }).toEqual({ flags, lines: [line], exitCode: 0, said: "" });
    }
  });
