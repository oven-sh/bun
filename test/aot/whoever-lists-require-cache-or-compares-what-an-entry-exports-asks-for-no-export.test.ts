import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const library = {
  "lib/names.cjs": `exports.read = 1;\nexports.nobodyNamesThis = function nobodyNamesThis() { return "called"; };`,
  "lib/read-by-name.cjs": `exports.kept = 1;\nexports.dropped = 2;`,
  "lib/plugin.cjs": `module.exports = function plugin() { return "plugin"; };`,
  "lib/module.ts": `export const shown = 1;\nexport function nobodyNamesThisEither() { return 2; }`,
};

const head = `
  const path = require("node:path");
  const name = key => path.basename(key);
  const own = key => key.includes(path.sep + "lib" + path.sep);
  const names = require("./lib/names.cjs");
  const readByName = require("./lib/read-by-name.cjs");
  const plugin = require("./lib/plugin.cjs");
  const ofModule = require("./lib/module.ts");
  const keyOfNames = require.resolve("./lib/names.cjs");`;

/** The use at the top level, in a function, in a method and in a field. `TABLE` stands for the table. */
function filesOf(declared: string, table: string, use: string) {
  const written = use.replaceAll("TABLE", table);
  return {
    ...library,
    "uses.cjs": `${head}
      ${declared}
      const atTop = ${written};
      function inFunction() { return ${written}; }
      class Holder { field = ${written}; method() { return ${written}; } }
      exports.answers = () => [atTop, inFunction(), new Holder().field, new Holder().method(), names.read, readByName.kept, plugin(), ofModule.shown];`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { answers } from "./uses.cjs";
      test("answers", () => { for (const answer of answers()) console.log(String(answer)); });`,
  };
}

const tables = [
  ["", "require.cache"],
  ["const cache = require.cache;", "cache"],
  [`const Module = require("node:module");`, "Module._cache"],
];

async function expectAsPlain(use: string) {
  for (const [declared, table] of tables) {
    using dir = tempDir("uses-of-require-cache", filesOf(declared, table, use));
    const plain = await run([bunExe(), "test"], String(dir), bunEnv);
    const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }
}

const asksForNothing = {
  "Object.keys()": `Object.keys(TABLE).filter(own).map(name).sort().join()`,
  "Object.getOwnPropertyNames()": `Object.getOwnPropertyNames(TABLE).filter(own).map(name).sort().join()`,
  "Reflect.ownKeys()": `Reflect.ownKeys(TABLE).filter(key => typeof key === "string" && own(key)).map(name).sort().join()`,
  "for in": `(() => { const found = []; for (const key in TABLE) if (own(key)) found.push(name(key)); return found.sort().join(); })()`,
  "in": `[keyOfNames in TABLE, "/nowhere.js" in TABLE].join()`,
  "a test of the table": `TABLE ? "there" : "missing"`,
  "a test of an entry": `[!!TABLE[keyOfNames], !TABLE["/nowhere.js"], typeof TABLE[keyOfNames], TABLE[keyOfNames] === undefined].join()`,
  "=== on what an entry exports": `(() => { const keys = Object.keys(TABLE); for (let i = 0; i < keys.length; i++) if (TABLE[keys[i]].exports === plugin) return name(keys[i]); return "none"; })()`,
  "!== on what an entry exports": `Object.keys(TABLE).filter(own).filter(key => TABLE[key].exports !== plugin).map(name).sort().join()`,
  "=== undefined on what an entry exports": `Object.keys(TABLE).filter(own).filter(key => TABLE[key].exports === undefined).map(name).sort().join()`,
};

const asksForEveryExport = {
  "a member of what an entry exports": `TABLE[keyOfNames].exports.nobodyNamesThis()`,
  "the keys of what an entry exports": `Object.keys(TABLE).filter(own).map(key => name(key) + ":" + Object.keys(TABLE[key].exports).join("+")).sort().join()`,
  "typeof what an entry exports": `Object.keys(TABLE).filter(own).map(key => name(key) + ":" + typeof TABLE[key].exports).sort().join()`,
  "== on what an entry exports": `String(TABLE[keyOfNames].exports == "[object Object]")`,
  "an entry in a variable": `(() => { const entry = TABLE[keyOfNames]; return [entry.exports.nobodyNamesThis(), entry.loaded, name(entry.id)].join(); })()`,
  "the table handed to a function": `(table => table[keyOfNames].exports.nobodyNamesThis())(TABLE)`,
};

// Which is which: src/aot/builtins/resolve/tests/module_cache.rs.
for (const [title, use] of Object.entries({ ...asksForNothing, ...asksForEveryExport }))
  test(title, () => expectAsPlain(use));
