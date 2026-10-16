import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `Module._cache` is `require.cache` by another name: what a program writes to it, or deletes from it, counts for every `require()` that follows.

const files = {
  "lib.js": `exports.name = "the real lib"; exports.dep = require("./dep.js").name;`,
  "dep.js": `exports.name = "the real dep"; globalThis.loads = (globalThis.loads ?? 0) + 1;`,
};

const stub = `{ id: key, filename: key, loaded: true, exports: { name: "a stub in _cache" } }`;

const programs: Record<string, string> = {
  "a-stub-is-written.js": `const Module = require("node:module");
const key = require.resolve("./dep.js");
Module._cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), Module._cache === require.cache, globalThis.loads);
`,
  "without-the-prefix.js": `const Module = require("module");
const key = require.resolve("./dep.js");
Module._cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "a-member-at-once.js": `const key = require.resolve("./dep.js");
require("node:module")._cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "imported.mjs": `import Module, { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./dep.js");
Module._cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "taken-out-by-a-pattern.js": `const { _cache } = require("node:module");
const key = require.resolve("./dep.js");
_cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "taken-out-under-another-name.js": `const Module = require("module");
const { _cache: modules } = Module;
const key = require.resolve("./dep.js");
modules[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "imported-by-its-name.mjs": `import { _cache, createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./dep.js");
_cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "the-name-of-the-module-is-computed.js": `const name = ["node:module"][0];
const key = require.resolve("./dep.js");
require(name)._cache[key] = ${stub};
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "in-a-function-of-another-file.js": `const { put } = require("./puts.js");
put(require.resolve("./dep.js"));
console.log(JSON.stringify(require("./lib.js")), globalThis.loads);
`,
  "only-read.js": `const Module = require("node:module");
require("./lib.js");
console.log(Object.keys(Module._cache).map(key => key.split("/").pop()).sort().join(), globalThis.loads);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("cache-by-its-other-name", {
      ...files,
      "puts.js": `const Module = require("node:module");\nexports.put = key => { Module._cache[key] = ${stub}; };\n`,
      [entry]: programs[entry],
    });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
