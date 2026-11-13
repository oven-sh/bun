// `--external unseen` leaves a package out of the executable: it runs from disk, and the build has not seen its code. One such package made the build give up what it knew of
// every CommonJS file of the program: express with one package left out was 16% larger. Now only the file that asks for the package lets go of what it exports.
// So the package may not come by what another file exports. part/index.js hands its exports object on as a value, as `debug` does; the program calls twice() with numbers alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const project = (road: string, handed: string) => ({
  "package.json": `{ "name": "made-up", "dependencies": { "part": "1.0.0", "unseen": "1.0.0" } }`,
  "node_modules/part/package.json": `{ "name": "part", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/part/common.js": `function setup(env) {
  function make(n) { return env.twice(n); }
  make.twice = n => env.twice(n);
  return make;
}
module.exports = setup;
`,
  "node_modules/part/index.js": `exports.twice = function twice(n) { return n + n; };\nmodule.exports = require("./common.js")(exports);\n`,
  "node_modules/unseen/package.json": `{ "name": "unseen", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/unseen/index.js": `exports.road = function road(handed) { ${road} };\n`,
  "asks.js": `const unseen = require("unseen");\nmodule.exports = { road: handed => unseen.road(handed) };\n`,
  "main.js": `const part = require("part");
const asks = require("./asks.js");
let sum = 0;
for (let i = 0; i < 50; i++) sum += part.twice(i);
let said;
try {
  said = asks.road(${handed});
} catch (error) {
  said = "threw " + String(error.message).replace(/'[^']*'/, "'the file'").split(":")[0];
}
console.log("SAID", sum, said, part.twice(4));
`,
});

const inside = `require("node:path").join(require("node:path").dirname(Bun.main), "node_modules", "part", "index.js")`;

describe.each(
  Object.entries({
    "the module object of the file that asked shows neither exports nor a loader nor children": [
      `const parent = module.parent; return [typeof parent, typeof parent.exports, typeof parent.require, (parent.children ?? []).length].join()`,
      "undefined",
      "object,undefined,undefined,0",
    ],
    "its own require of the package finds the files on disk, a second copy": [
      `const found = require("part"); return found.twice("ab") + " " + (found === handed)`,
      "part",
      "abab false",
    ],
    "the path of the file inside the executable is refused": [
      `return require(${inside}).twice("ab")`,
      "undefined",
      "threw Cannot load 'the file'",
    ],
    "what the program hands it is called like any other function": [`return handed.twice("ab")`, "part", "abab"],
  }),
)("%s", (_, [road, handed, said]) => {
  test("in an executable", async () => {
    using dir = tempDir("aot-a-package-left-out", project(road, handed));
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    const built = await run([bunExe(), "build", "--compile", "--aot", "--external", "unseen", "./main.js", "--outfile", executable], String(dir)); // prettier-ignore
    expect(built.exitCode).toBe(0);
    expect((await run([executable], String(dir), bunEnv)).stdout.trim()).toBe(`SAID 2450 ${said} 8`);
  });
});
