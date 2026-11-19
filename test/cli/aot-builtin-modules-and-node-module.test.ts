import { expect } from "bun:test";
import { tempDir } from "harness";
import { test } from "../aot/supported";
import { compileEachAlone, importingByName, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

const plain = "plain.mjs";
const importsQuerystring = "imports-querystring.mjs";
const made = `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n`;

const files = {
  "package.json": JSON.stringify({ name: "a-small-program", version: "1.0.0" }),
  "lib.cjs": `exports.name = "lib";`,
};

const bases = {
  [plain]: `console.log("run");`,
  [importsQuerystring]: `import "node:querystring";\nconsole.log("run");`,
};

const withoutADoor: Record<string, string> = {
  "a-made-require-of-a-written-name.mjs": `${made}console.log(require("./package.json").name ? "run" : "");`,
  "a-made-require-and-its-resolve.mjs": `${made}console.log(require("./lib.cjs").name && require.resolve("./lib.cjs") ? "run" : "");`,
  "a-made-require-under-another-name.mjs": `import { createRequire as makeRequire } from "node:module";\nconst load = makeRequire(import.meta.url);\nconsole.log(load("./lib.cjs").name && typeof load("node:querystring").escape === "function" ? "run" : "");`,
  "a-require-made-only-to-resolve.mjs": `import { createRequire } from "node:module";\nconsole.log(createRequire(import.meta.url).resolve("./lib.cjs").endsWith("lib.cjs") ? "run" : "");`,
  "a-require-made-only-to-resolve-in-commonjs.cjs": `const { createRequire } = require("module");\nfunction find(origin) {\n  return createRequire(__filename).resolve(origin);\n}\nconsole.log(find("./lib.cjs").endsWith("lib.cjs") ? "run" : "");`,
  "a-made-require-of-a-written-name-in-commonjs.cjs": `const { createRequire } = require("node:module");\nconst load = createRequire(__filename);\nconsole.log(load("./lib.cjs").name ? "run" : "");`,
  "the-list-of-builtin-modules.mjs": `import { builtinModules, isBuiltin } from "node:module";\nconsole.log(builtinModules.length > 0 && isBuiltin("fs") ? "run" : "");`,
  "the-default-import-read-by-harmless-names.mjs": `import Module from "node:module";\nconsole.log(Module.builtinModules.length > 0 && Module.isBuiltin("fs") ? "run" : "");`,
};

const name = `const name = ["node:querystring"][0];\n`;
const loaded = (how: string) => `console.log(typeof ${how}.escape === "function" ? "run" : "");`;
const withADoor = importingByName("node:querystring", {
  "a-made-require-of-a-computed-name.mjs": `${made}${name}${loaded("require(name)")}`,
  "a-made-require-that-is-handed-on.mjs": `${made}${name}const use = load => load(name);\n${loaded("use(require)")}`,
  "a-made-require-that-is-called-at-once.mjs": `import { createRequire } from "node:module";\n${name}${loaded("createRequire(import.meta.url)(name)")}`,
  "a-made-require-that-is-stored-to.mjs": `import { createRequire } from "node:module";\n${name}let load = null;\nload = createRequire(import.meta.url);\n${loaded("load(name)")}`,
  "create-require-is-handed-on.mjs": `import { createRequire } from "node:module";\n${name}const make = [createRequire][0];\n${loaded("make(import.meta.url)(name)")}`,
  "the-default-import.mjs": `import Module from "node:module";\n${name}${loaded("Module.createRequire(import.meta.url)(name)")}`,
  "the-namespace.mjs": `import * as module from "node:module";\n${name}${loaded("module.createRequire(import.meta.url)(name)")}`,
  "required-and-kept.cjs": `const { createRequire } = require("node:module");\n${name}const load = createRequire(__filename);\n${loaded("load(name)")}`,
  "required.cjs": `const { createRequire } = require("node:module");\n${name}${loaded("createRequire(__filename)(name)")}`,
});

const harmless = "without-a-door.mjs";
const loading = "with-a-door.mjs";

test.skipIf(!startsAtAnyEntryPoint)(
  "harmless names of node:module bring no built-in module into the executable",
  async () => {
    using dir = tempDir("builtin-modules-and-node-module", {
      ...files,
      ...bases,
      ...withoutADoor,
      ...withADoor,
      [harmless]: oneAfterTheOther(withoutADoor),
      [loading]: oneAfterTheOther(withADoor),
    });
    const ran = await compileEachAlone(String(dir), [...Object.keys(bases), harmless, loading]);
    expect(ran).toEqual({
      [plain]: { stdout: "run\n", exitCode: 0, bytes: expect.any(Number) },
      [importsQuerystring]: { stdout: "run\n", exitCode: 0, bytes: expect.any(Number) },
      [harmless]: { stdout: "run\n".repeat(Object.keys(withoutADoor).length), exitCode: 0, bytes: expect.any(Number) },
      [loading]: { stdout: "run\n".repeat(Object.keys(withADoor).length), exitCode: 0, bytes: expect.any(Number) },
    });
    // How large compiled code is follows from how Bun was built, so what a require that may go anywhere costs is the measure.
    const most = (ran[loading].bytes - ran[importsQuerystring].bytes) / 2;
    expect(ran[harmless].bytes - ran[importsQuerystring].bytes).toBeLessThan(most);
  },
  240_000,
);
