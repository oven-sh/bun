import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "db.json": `{ "a": 1 }`,
  "other.js": `module.exports = { a: 1 };`,
  "only-json.js": `module.exports = require("./db.json");`,
  "only-script.js": `module.exports = require("./other.js");`,
  "node_modules/fake-db/package.json": `{ "name": "fake-db", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/fake-db/db.json": `{ "text/plain": { "extensions": ["txt"] } }`,
  "node_modules/fake-db/index.js": `/*!\n * fake-db\n */\n\n/**\n * Module exports.\n */\n\nmodule.exports = require('./db.json')\n`,
  "node_modules/fake-types/package.json": `{ "name": "fake-types", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/fake-types/index.js": `'use strict'\nvar db = require('fake-db')\nexports.extension = function (type) { return db[type] && db[type].extensions[0] }\n`,
  "required.cjs": `
    const json = require("./only-json.js"), script = require("./only-script.js");
    console.log(JSON.stringify(json), json === require("./db.json"), JSON.stringify(script), script === require("./other.js"));
    console.log(require("fake-types").extension("text/plain"), require("fake-db") === require("fake-db/db.json"));
  `,
  "imported.mjs": `
    import json from "./only-json.js";
    import script from "./only-script.js";
    import types from "fake-types";
    console.log(JSON.stringify(json), JSON.stringify(script), types.extension("text/plain"));
  `,
  "only.test.js": `
    const { test } = require("node:test"), assert = require("node:assert");
    test("extension", () => { assert.strictEqual(require("fake-types").extension("text/plain"), "txt"); });
  `,
};

async function run(cwd: string, args: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd, env);
  return { stdout, stderr, exitCode };
}

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test.concurrent.each(["required.cjs", "imported.mjs"])(
  "bun run --aot %s: a module that only re-exports another is compiled",
  async entry => {
    using dir = tempDir("aot-reexport-only", files);
    const plain = await run(String(dir), ["run", entry], bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await run(String(dir), ["run", "--debug-aot", entry], compiledOnly)).toEqual(plain);
  },
  120_000,
);

test("bun test --aot: a package whose main file only re-exports a JSON file is compiled", async () => {
  using dir = tempDir("aot-reexport-only", files);
  const { stderr, exitCode } = await run(String(dir), ["test", "--debug-aot", "./only.test.js"], compiledOnly);
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
}, 120_000);
