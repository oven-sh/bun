import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as spawned } from "./harness/run";
import { test } from "./supported";

// `require` is one function per module: every mention of it is the same object, and so are `module.require` and `arguments[1]`.
// (In an executable all modules share the bundle's one `require`.)

const checks = `const first = require, second = require;
const say = (what, value) => console.log(__filename.slice(__filename.lastIndexOf("/") + 1), what, value);
say("the same twice", first === second && require === require);
first.stored = 1;
say("stored through one mention, read through another", require.stored);
function inAFunction() { return require; }
say("the same in a function", inAFunction() === first);
say("module.require", module.require === require);
say("arguments[1]", arguments[1] === require);
say("resolve", require.resolve === require.resolve);
say("cache, main, extensions", [require.cache === require.cache, require.main === require.main, require.extensions === require.extensions].join());
Object.freeze(first);
say("frozen through one mention, asked through another", Object.isFrozen(require));
try { require.late = 2; say("a store after freezing", require.late); } catch (error) { say("a store after freezing throws", error.name); }
say("still requires", typeof require("node:path").join + " " + require("./data.json").k);
`;

const files = {
  "main.cjs": `"use strict";\n${checks}require("./lib/inner.cjs");\nsay("not the other module's", require !== globalThis.requireOfInner);\n`,
  "lib/inner.cjs": `"use strict";\n${checks}globalThis.requireOfInner = require;\n`,
  "data.json": `{ "k": 1 }`,
  "lib/data.json": `{ "k": 2 }`,
};

test("bun run --aot prints what bun run prints", async () => {
  using dir = tempDir("require-identity", files);
  const plain = await spawned([bunExe(), "run", "main.cjs"], String(dir));
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("inner.cjs the same twice true");
  const aot = await spawned([bunExe(), "run", "--debug-aot", "main.cjs"], String(dir), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
