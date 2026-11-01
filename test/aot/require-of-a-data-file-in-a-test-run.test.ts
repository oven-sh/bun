import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `require("./x.json")` answers the parsed object, unless the loader of ES modules holds the file by then: then it answers the namespace object, with "default".
// A test run has an entry point for each test file, and a realm begins with one of them: what another test file imports the loader of this realm does not hold.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/s1.json": `{ "name": "s1", "list": [1] }
`,
  "src/s2.json": `{ "name": "s2", "list": [1] }
`,
  "src/s3.json": `{ "name": "s3", "list": [1] }
`,
  "src/s4.json": `{ "name": "s4", "list": [1] }
`,
  "src/s5.json": `{ "name": "s5", "list": [1] }
`,
  "src/s6.json": `{ "name": "s6", "list": [1] }
`,
  "src/s1.cjs": `const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
exports.seen = tag(require("./s1.json"));
exports.later = () => tag(require("./s1.json"));
`,
  "src/s2a.mjs": `const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
export const seen = tag(require("./s2.json"));
`,
  "src/s2b.mjs": `import j from "./s2.json";
export const name = j.name;
`,
  "src/s6.mjs": `import j from "./s6.json";
export const name = j.name;
`,
  "s1.test.mjs": `import { test } from "bun:test";
import j from "./src/s1.json";
import c from "./src/s1.cjs";
test("s1", () => { console.log("s1: a CommonJS file beside the import, at load:", c.seen, "| later:", c.later(), "|", j.name); });
`,
  "s2.test.mjs": `import { test } from "bun:test";
import { seen } from "./src/s2a.mjs";
import { name } from "./src/s2b.mjs";
test("s2", () => { console.log("s2: a module that runs ahead of the importer:", seen, "|", name); });
`,
  "s3.test.mjs": `import { test } from "bun:test";
const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
test("s3", () => { console.log("s3: nothing of this realm imports it:", tag(require("./src/s3.json")), "| again:", tag(require("./src/s3.json"))); });
`,
  "s3-importer.test.mjs": `import { test } from "bun:test";
import j from "./src/s3.json";
const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
test("s3 importer", () => { console.log("s3 importer:", j.name, tag(require("./src/s3.json"))); });
`,
  "s4.test.mjs": `import { test } from "bun:test";
const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
test("s4", async () => { const before = tag(require("./src/s4.json")); const space = await import("./src/s4.json"); console.log("s4: required, imported by a call, required:", before, "|", tag(space), "|", tag(require("./src/s4.json"))); });
`,
  "s4-importer.test.mjs": `import { test } from "bun:test";
import j from "./src/s4.json";
test("s4 importer", () => { console.log("s4 importer:", j.name); });
`,
  "s5.test.mjs": `import { test } from "bun:test";
const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
test("s5", async () => { const space = await import("./src/s5.json"); console.log("s5: imported by a call, then required:", tag(space), "|", tag(require("./src/s5.json"))); });
`,
  "s6.test.mjs": `import { test } from "bun:test";
const tag = value => Object.prototype.toString.call(value) + " " + Object.keys(value).join();
test("s6", async () => { const before = tag(require("./src/s6.json")); const { name } = await import("./src/s6.mjs"); console.log("s6: required, then a module that imports it is loaded:", before, "|", name, "|", tag(require("./src/s6.json"))); });
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`require() of a JSON file answers as under plain bun test, ${way}`, async () => {
    using dir = tempDir("aot-require-of-a-data-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain(
      "s3: nothing of this realm imports it: [object Object] name,list | again: [object Object] name,list",
    );
    expect(plain.stdout).toContain(
      "s2: a module that runs ahead of the importer: [object Module] default,list,name | s2",
    );
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 120_000);
}
