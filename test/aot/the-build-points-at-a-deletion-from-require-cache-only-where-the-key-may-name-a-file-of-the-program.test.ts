// `delete require.cache[key]` does nothing for a compiled module, and the build says so with TS100091. A file that is not in the executable is read again behind
// the deletion, as in `bun <file>`, so the build says nothing there. A key that the build cannot read may name a compiled module.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

type Case = { key: (part: string, outside: string) => string; warns: boolean };
const cases: Record<string, Case> = {
  "a compiled file by require.resolve": { key: () => `require.resolve("./part.cjs")`, warns: true },
  "a compiled file by its written path": { key: part => part, warns: true },
  "a compiled file by its path in a constant": { key: () => `whole`, warns: true },
  "a key that the build cannot read": { key: () => `process.argv[2]`, warns: true },
  "a file outside by require.resolve": { key: (_, outside) => `require.resolve(${outside})`, warns: false },
  "a file outside by its written path": { key: (_, outside) => outside, warns: false },
  "a text that is no whole path": { key: () => `"part.cjs"`, warns: false },
};

const made = `const { createRequire } = require("node:module");\n`;
const waysToTheTable: Record<string, { text: string; warning: "TS100091" | "TS100093" }> = {
  "destructured": { text: `const { cache } = createRequire(__filename);\ndelete cache[part];`, warning: "TS100091" },
  "destructured under another name": {
    text: `const { cache: table } = createRequire(__filename);\ndelete table[part];`,
    warning: "TS100091",
  },
  "destructured off a variable": {
    text: `const made = createRequire(__filename);\nconst { cache } = made;\nReflect.deleteProperty(cache, part);`,
    warning: "TS100091",
  },
  "given to Reflect.deleteProperty": { text: `Reflect.deleteProperty(require.cache, part);`, warning: "TS100091" },
  "held in a variable": {
    text: `const made = createRequire(__filename);\nconst table = made.cache;\ndelete table[part];`,
    warning: "TS100091",
  },
  "of a require that a function makes": {
    text: `const made = (() => createRequire(__filename))();\ndelete made.cache[part];`,
    warning: "TS100091",
  },
  "of a require that a function answers with": {
    text: `function getRequire() {\n  return require;\n}\ndelete getRequire().cache[part];`,
    warning: "TS100091",
  },
  "destructured off what a function makes": {
    text: `function make() {\n  return createRequire(__filename);\n}\nconst { cache } = make();\ndelete cache[part];`,
    warning: "TS100091",
  },
  "that a function answers with": {
    text: `const table = (() => createRequire(__filename).cache)();\ndelete table[part];`,
    warning: "TS100093",
  },
  "in an object": {
    text: `const holder = { table: createRequire(__filename).cache };\ndelete holder.table[part];`,
    warning: "TS100093",
  },
  "assigned by a pattern": { text: `let cache;\n({ cache } = require);\ndelete cache[part];`, warning: "TS100093" },
};

test.concurrent.each(Object.keys(waysToTheTable))("the table %s", async name => {
  const { text, warning } = waysToTheTable[name];
  using sources = tempDir("aot-a-way-to-the-table", {
    "part.cjs": "exports.a = 1;\n",
    "main.cjs": `${made}const part = require.resolve("./part.cjs");\nrequire(part);\n${text}\nconsole.log(typeof require(part));\n`,
  });
  using outside = tempDir("aot-a-way-to-the-table-outside", {});
  const executable = join(String(outside), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const warnings = (built.stdout + built.stderr).match(/TS10009[13]/g);
  expect(warnings).toEqual([warning]);
});

const quietTexts: Record<string, string> = {
  "another member destructured": `const { resolve } = createRequire(__filename);\nconsole.log(typeof resolve);`,
  "another member assigned by a pattern": `let resolve;\n({ resolve } = require);\nconsole.log(typeof resolve);`,
  "a path outside given to Reflect.deleteProperty": `Reflect.deleteProperty(require.cache, "/outside/config.json");`,
  "a member of that name of something else": `const make = () => ({ cache: {} });\nconst { cache } = make();\ndelete cache[part];`,
};

test.concurrent.each(Object.keys(quietTexts))("no warning for %s", async name => {
  using sources = tempDir("aot-no-way-to-the-table", {
    "part.cjs": "exports.a = 1;\n",
    "main.cjs": `${made}const part = require.resolve("./part.cjs");\nrequire(part);\n${quietTexts[name]}\n`,
  });
  using outside = tempDir("aot-no-way-to-the-table-outside", {});
  const executable = join(String(outside), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  expect(built.stdout + built.stderr).not.toMatch(/TS10009[13]/);
});

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { key, warns } = cases[name];
  using sources = tempDir("aot-a-deletion-from-require-cache", { "part.cjs": "exports.a = 1;\n" });
  using outside = tempDir("aot-a-deletion-from-require-cache-outside", {});
  const part = JSON.stringify(join(String(sources), "part.cjs"));
  const config = JSON.stringify(join(String(outside), "config.json"));
  const text = `const whole = ${part};\nrequire("./part.cjs");\ntry {\n  delete require.cache[${key(part, config)}];\n} catch {}\nconsole.log(typeof whole);\n`;
  await Bun.write(join(String(sources), "main.cjs"), text);
  const executable = join(String(outside), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  expect((built.stdout + built.stderr).includes("TS100091")).toBe(warns);
});
