import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// 1,200 modules import one another through barrels of 20 modules, and through barrels over five of those.
const modules = 1200;
const barrelSize = 20;
const outerSize = 5;
const testFiles = 12;

function project(mockingFiles: number) {
  const files: Record<string, string> = { "timings.json": `{ "version": 1, "files": {} }` };
  const outerOf = (k: number) => Math.floor(k / barrelSize / outerSize);
  for (let k = 0; k < modules; k++) {
    const below = [1 + ((k * 7) % 90), 2 + ((k * 13) % 110)].map(step => Math.min(modules - 1, k + step));
    const imports = [...new Set(below)].filter(d => d !== k);
    files[`m${k}.js`] =
      imports.map(d => `import { f${d}, name${d} } from "./outer${outerOf(d)}.js";\n`).join("") +
      `export const name${k} = "m${k}";\n` +
      `export function f${k}(x) { ${imports.map(d => `if (x === ${d}) return f${d}(0) + name${d}.length;`).join(" ")} return x + ${k}; }\n`;
  }
  const barrels = Math.ceil(modules / barrelSize);
  for (let b = 0; b < barrels; b++)
    files[`barrel${b}.js`] = Array.from({ length: barrelSize }, (_, k) => b * barrelSize + k)
      .filter(k => k < modules)
      .map(k => `export * from "./m${k}.js";\n`)
      .join("");
  for (let o = 0; o * outerSize < barrels; o++)
    files[`outer${o}.js`] = Array.from({ length: outerSize }, (_, k) => o * outerSize + k)
      .filter(b => b < barrels)
      .map(b => `export * from "./barrel${b}.js";\n`)
      .join("");
  for (let k = 0; k < testFiles; k++)
    files[`importing${k}.test.js`] =
      `import { expect, test } from "bun:test";\nimport { f${k} } from "./m${k}.js";\n` +
      `test("t${k}", () => { expect(f${k}(-1)).toBe(${k - 1}); });\n`;
  for (let t = 0; t < mockingFiles; t++) {
    const mocked = Array.from({ length: 10 }, (_, k) => (t * 97 + k * 41) % modules);
    files[`mocking${t}.test.js`] =
      `import { expect, mock, test } from "bun:test";\n` +
      mocked.map(m => `mock.module("./m${m}.js", () => ({ name${m}: "mock", f${m}: () => ${m} }));\n`).join("") +
      `const { name${mocked[0]} } = await import("./m${mocked[0]}.js");\n` +
      `test("t", () => { expect(name${mocked[0]}).toBe("mock"); });\n`;
  }
  return files;
}

async function timeOfImportingFiles(mockingFiles: number) {
  using dir = tempDir("star-exports-beside-mocks", project(mockingFiles));
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--isolate", "--timings=timings.json", "--update-timings", "."],
    String(dir),
    bunEnv,
  );
  expect({ exitCode, passed: stderr.match(/^\s*(\d+) pass$/m)?.[1] }).toEqual({
    exitCode: 0,
    passed: String(testFiles + mockingFiles),
  });
  const timings: Record<string, number> = (await Bun.file(join(String(dir), "timings.json")).json()).files;
  return Object.entries(timings).reduce(
    (sum, [path, time]) => sum + (path.split(/[\\/]/).at(-1)!.startsWith("importing") ? time : 0),
    0,
  );
}

// Other work on the machine only adds to a time. A ratio that is over its bound is measured again, three times at most.
async function smallestRatio(bound: number) {
  let smallest = Infinity;
  for (let attempt = 0; attempt < 4 && smallest >= bound; attempt++) {
    if (attempt && performance.now() > 200_000) break;
    const alone = await timeOfImportingFiles(0);
    smallest = Math.min(smallest, (await timeOfImportingFiles(24)) / Math.max(alone, testFiles));
  }
  return smallest;
}

test("a module that another test file mocks does not make each import through `export *` search every module behind it", async () => {
  // Where the link resolved each name through the records of every module behind the barrels, the files took thirty times as long.
  const most = 8;
  expect(await smallestRatio(most)).toBeLessThan(most);
});
