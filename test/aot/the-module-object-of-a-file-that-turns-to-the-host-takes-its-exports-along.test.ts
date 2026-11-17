// Link follows `module.exports` of a CommonJS file from the file's stores to the written `require` sites, and proves what the exported functions are called with.
// A request that turns to the host hands over the module object of the file that asks, and Bun passes it to Module._resolveFilename as `parent`:
// whoever has laid a function over that reads `exports` off it and calls `sum`, proven to take numbers, with texts. No name is asked for on that road, so no refusal stands on it.
//
// Each program is built alone, in a folder of its own whose path is spelled into it: the file must be missing at the build, or the build reads it as data and nothing turns to the host.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const sum = `function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}`;
const start = `"use strict";
const fs = require("node:fs");
const asks = require("./asks.cjs");
function pick(from, a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return from.sum(a, b); }
let total = 0;
for (let i = 0; i < 300; i++) total = pick(asks, total, i) | 0;
globalThis.out = "not called";
function say(e) { return e.name + ":" + String(e.message).replace(/'[^']*'/, "<path>").slice(0, 48); }
HOOK
fs.writeFileSync("FOLDER/late.json", "{}"); try { asks.ask(); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`;
const calls = `out = typeof got.exports.sum + ":" + got.exports.sum("a", "b");`;

const laidOver = `(0, eval)(${JSON.stringify(`const Module = process.getBuiltinModule("node:module"); const original = Module._resolveFilename; Module._resolveFilename = function (name, got) { if (String(name).endsWith("late.json")) { ${calls} } return original.apply(this, arguments); };`)});`;

const programs: Record<string, string> = {
  "a require of a path that is missing at the build": `return require("FOLDER/late.json");`,
  "require.resolve of a name made at run time": `return require.resolve(JSON.parse('"FOLDER/late.json"'));`,
  "require goes to evaluated text by value": `return (0, eval)("(load) => load('FOLDER/late.json')")(require);`,
};

async function answersOf(ask: string) {
  using dir = tempDir("aot-module-object-goes-to-the-host", { "main.mjs": `import "./start.cjs";\n` });
  const directory = String(dir);
  const spelled = (text: string) => text.replaceAll("FOLDER", directory.replaceAll("\\", "/"));
  await Bun.write(join(directory, "start.cjs"), spelled(start.replace("HOOK", () => laidOver)));
  await Bun.write(
    join(directory, "asks.cjs"),
    spelled(
      `"use strict";\n${sum}\nfunction ask() {\n  let work = 0;\n  for (let i = 0; i < 2; i++) work = (work + i) | 0;\n  ${ask}\n}\nmodule.exports = { sum, ask };\n`,
    ),
  );
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  return { plain: [plain.stdout.trim(), plain.exitCode], compiled: [compiled.stdout.trim(), compiled.exitCode] };
}

describe("what is laid over Module._resolveFilename reads the exports off the module object of the file that asked", () => {
  test.each(Object.entries(programs))(
    "%s",
    async (_, ask) => {
      const { plain, compiled } = await answersOf(ask);
      expect(plain).toEqual(["44850 function:ab", 0]);
      expect(compiled).toEqual(plain);
    },
    240_000,
  );
});
