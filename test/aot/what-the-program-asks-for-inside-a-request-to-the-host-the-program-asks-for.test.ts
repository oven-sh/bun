// A closed executable refuses a module that is asked for by a name made at run time, and Link leans on that: what no written name reaches, nobody enters from outside.
// While the engine itself asks the host for a module that the image names, what the host asks back is no such load: `require("<a path that is missing at the build>")` opens that window.
// The host runs code of the program inside it: a loader in require.extensions, a callback of a plugin. What that code asks for by a name made at run time was admitted like a question of the host's own:
// `sum`, proven to take numbers, was entered with texts, and the process died of an illegal instruction.
//
// Each program is built alone, in a folder of its own whose path is spelled into it: the file must be missing at the build, or the build reads it as data and no window opens.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const sum = `"use strict";
module.exports = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
`;
const head = `"use strict";
const fs = require("node:fs");
const sum = require("./sum.cjs");
let total = 0;
for (let i = 0; i < 300; i++) total = sum(total, i) | 0;
let out = "not called";
function say(e) { return e.name + ":" + String(e.message).replace(/'[^']*'/, "<path>").slice(0, 48); }
`;
const refusal = "inside Error:Cannot load <path>: this executable can't load a";

async function answerOf(body: string) {
  using dir = tempDir("aot-request-inside-a-request-to-the-host", {
    "main.mjs": `import "./start.cjs";\n`,
    "sum.cjs": sum,
    "named.cjs": `exports.label = "named by the build";\n`,
  });
  const directory = String(dir);
  await Bun.write(join(directory, "start.cjs"), head + body.replaceAll("FOLDER", directory.replaceAll("\\", "/")));
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], directory);
  expect(built.exitCode).toBe(0);
  const { stdout, exitCode } = await run([executable], directory, bunEnv);
  return { stdout: stdout.trim(), exitCode };
}

const refused: Record<string, string> = {
  "a loader in require.extensions": String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader calls a helper that asks": String.raw`function helper() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require(JSON.parse('"./sum.cjs"')); }
require.extensions[".json"] = function load(module, filename) {
  try { const again = helper(); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader tail-calls a helper that asks": String.raw`function helper(module) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } module.exports = 1; return work; }
require.extensions[".json"] = function load(module, filename) { return helper(module); };
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader calls require by value": String.raw`const asks = [require][JSON.parse("0")];
require.extensions[".json"] = function load(module, filename) {
  try { const again = asks(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader calls module.require": String.raw`const own = module;
require.extensions[".json"] = function load(module, filename) {
  try { const again = own.require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader calls a require that it creates": String.raw`const { createRequire } = require("node:module");
require.extensions[".json"] = function load(module, filename) {
  try { const again = createRequire(__filename)(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader asks through a method of the library": String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const again = [JSON.parse('"./sum.cjs"')].map(require)[0]; out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader asks in the initializer of a field": String.raw`class Asks { again = require(JSON.parse('"./sum.cjs"')); }
require.extensions[".json"] = function load(module, filename) {
  try { const again = new Asks().again; out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "a loader imports by a name made at run time": String.raw`let later = Promise.resolve("none");
require.extensions[".json"] = function load(module, filename) {
  later = import(JSON.parse('"./sum.cjs"')).then(space => typeof space.default + ":" + space.default("a", "b"), e => "inside " + say(e));
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
later.then(said => console.log(String(total), said));
`,
  "onResolve of a plugin": String.raw`Bun.plugin({ name: "late", setup(build) {
  build.onResolve({ filter: /late\.json$/ }, () => { try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } return undefined; });
} });
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "onLoad of a plugin": String.raw`Bun.plugin({ name: "late", setup(build) {
  build.onLoad({ filter: /late\.json$/ }, () => { try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } return { exports: { a: 1 }, loader: "object" }; });
} });
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "Module._resolveFilename laid over": String.raw`const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (String(request).endsWith("late.json")) { try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } } return original.call(this, request, ...rest); };
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
  "the same function opens the window and is called inside it": String.raw`function both(module, filename) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (module) { try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } module.exports = 1; return; }
  fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
}
require.extensions[".json"] = both;
both();
console.log(String(total), out);
`,
  "the window is opened in an async function behind an await": String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
async function go() { await null; await new Promise(r => setTimeout(r, 1)); fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json"); console.log(String(total), out); }
go();
`,
  "the window is opened in a generator": String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
function* go() { yield 1; fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json"); yield 2; }
for (const step of go()) total += 0 * step;
console.log(String(total), out);
`,
  "outside any window": String.raw`try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); }
console.log(String(total), out);
`,
};

const stands: Record<string, [body: string, says: string]> = {
  "the loader asks for a file that the build named": [
    String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const named = require("./named.cjs"); out = typeof named + ":" + named.label; } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
    "44850 object:named by the build",
  ],
  "the loader asks for a built-in module": [
    String.raw`require.extensions[".json"] = function load(module, filename) {
  try { out = typeof require("node:path").join; } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
    "44850 function",
  ],
  "the loader asks for nothing": [
    String.raw`require.extensions[".json"] = function load(module, filename) {
  out = "the loader ran " + filename.endsWith("late.json");
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`,
    "44850 the loader ran true",
  ],
  "asked from an async function behind an await": [
    String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const named = require("./named.cjs"); out = typeof named + ":" + named.label; } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
async function go() { await null; await new Promise(r => setTimeout(r, 1)); fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json"); console.log(String(total), out); }
go();
`,
    "44850 object:named by the build",
  ],
  "asked from a generator": [
    String.raw`require.extensions[".json"] = function load(module, filename) {
  try { const named = require("./named.cjs"); out = typeof named + ":" + named.label; } catch (e) { out = "inside " + say(e); }
  module.exports = 1;
};
function* go() { yield 1; fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json"); yield 2; }
for (const step of go()) total += 0 * step;
console.log(String(total), out);
`,
    "44850 object:named by the build",
  ],
};

describe("a name made at run time is refused", () => {
  test.each(Object.entries(refused))(
    "%s",
    async (_, body) => {
      expect(await answerOf(body)).toEqual({ stdout: `44850 ${refusal}`, exitCode: 0 });
    },
    240_000,
  );
});

describe("what the build named is handed out", () => {
  test.each(Object.entries(stands))(
    "%s",
    async (_, [body, says]) => {
      expect(await answerOf(body)).toEqual({ stdout: says, exitCode: 0 });
    },
    240_000,
  );
});

test("a window inside a window: the outer loader gets the file that the build named, the inner one is refused", async () => {
  const body = String.raw`require.extensions[".json"] = function load(module, filename) {
  if (filename.endsWith("inner.json")) { try { const again = require(JSON.parse('"./sum.cjs"')); out = typeof again + ":" + again("a", "b"); } catch (e) { out = "inside " + say(e); } module.exports = 2; return; }
  try { const named = require("./named.cjs"); out = typeof named + ":" + named.label; } catch (e) { out = "inside " + say(e); } const first = out; fs.writeFileSync("FOLDER/inner.json", "{}"); try { require("FOLDER/inner.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/inner.json"); out = first + " then " + out;
  module.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}"); try { require("FOLDER/late.json"); } catch (e) { out += "|" + say(e); } fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`;
  expect(await answerOf(body)).toEqual({ stdout: `44850 object:named by the build then ${refusal}`, exitCode: 0 });
}, 240_000);
