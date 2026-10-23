import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { slot } from "../aot/run-programs";
import { test } from "../aot/supported";
import { importingByName } from "./aot-builtin-modules";

const plain = "plain.mjs";
const importsZlib = "imports-zlib.mjs";
const importsWorkerThreads = "imports-worker-threads.mjs";
const made = `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n`;

const files = {
  "package.json": JSON.stringify({ name: "a-small-program", version: "1.0.0" }),
  "lib.cjs": `exports.name = "lib";`,
};

const withoutADoor: Record<string, string> = {
  [plain]: `console.log("run");`,
  [importsZlib]: `import "node:zlib";\nconsole.log("run");`,
  [importsWorkerThreads]: `import "node:worker_threads";\nconsole.log("run");`,
  "a-made-require-of-a-written-name.mjs": `${made}console.log(require("./package.json").name ? "run" : "");`,
  "a-made-require-and-its-resolve.mjs": `${made}console.log(require("./lib.cjs").name && require.resolve("./lib.cjs") ? "run" : "");`,
  "a-made-require-under-another-name.mjs": `import { createRequire as makeRequire } from "node:module";\nconst load = makeRequire(import.meta.url);\nconsole.log(load("./lib.cjs").name && typeof load("node:zlib").gzipSync === "function" ? "run" : "");`,
  "a-require-made-only-to-resolve.mjs": `import { createRequire } from "node:module";\nconsole.log(createRequire(import.meta.url).resolve("./lib.cjs").endsWith("lib.cjs") ? "run" : "");`,
  "a-require-made-only-to-resolve.cjs": `const { createRequire } = require("module");\nfunction find(origin) {\n  return createRequire(__filename).resolve(origin);\n}\nconsole.log(find("./lib.cjs").endsWith("lib.cjs") ? "run" : "");`,
  "a-made-require-of-a-written-name.cjs": `const { createRequire } = require("node:module");\nconst load = createRequire(__filename);\nconsole.log(load("./lib.cjs").name ? "run" : "");`,
  "the-list-of-builtin-modules.mjs": `import { builtinModules, isBuiltin } from "node:module";\nconsole.log(builtinModules.length > 0 && isBuiltin("fs") ? "run" : "");`,
  "asks-whether-it-is-the-main-thread.mjs": `import { isMainThread, parentPort, workerData } from "node:worker_threads";\nconsole.log(isMainThread && !parentPort && !workerData ? "run" : "");`,
  "required-and-taken-apart.cjs": `const { isMainThread, parentPort } = require("node:worker_threads");\nconsole.log(isMainThread && !parentPort ? "run" : "");`,
  "required-and-read.cjs": `const threads = require("worker_threads");\nconsole.log(threads.isMainThread && require("module").builtinModules.length > 0 ? "run" : "");`,
  "the-default-import-read-by-harmless-names.mjs": `import Module from "node:module";\nconsole.log(Module.builtinModules.length > 0 && Module.isBuiltin("fs") ? "run" : "");`,
  "the-namespace-read-by-harmless-names.mjs": `import * as threads from "node:worker_threads";\nconsole.log(threads.isMainThread && threads.threadId === 0 ? "run" : "");`,
};

const name = `const name = ["node:zlib"][0];\n`;
const loaded = (how: string) => `console.log(typeof ${how}.gzipSync === "function" ? "run" : "");`;
const withADoor = importingByName("node:zlib", {
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

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test("harmless names of node:module and node:worker_threads bring no built-in module into the executable", async () => {
  const programs = { ...withoutADoor, ...withADoor };
  using dir = tempDir("builtin-modules-and-node-module", { ...files, ...programs });
  const sizes: Record<string, number> = {};
  await Promise.all(
    Object.keys(programs).map(entry =>
      slot(async () => {
        const outfile = join(String(dir), entry + ".exe");
        const { stderr, exitCode } = await run(
          [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile],
          String(dir),
        );
        expect({ entry, stderr, exitCode }).toEqual({
          entry,
          stderr: expect.not.stringContaining("error"),
          exitCode: 0,
        });
        const { stdout, exitCode: ranWith } = await run([outfile], String(dir), env);
        expect({ entry, stdout, ranWith }).toEqual({ entry, stdout: "run\n", ranWith: 0 });
        sizes[entry] = statSync(outfile).size;
      }),
    ),
  );
  for (const [entry, text] of Object.entries(withoutADoor)) {
    const base = text.includes('"node:zlib"')
      ? importsZlib
      : text.includes('worker_threads"')
        ? importsWorkerThreads
        : plain;
    expect({ entry, grows: sizes[entry] - sizes[base] > 1024 * 1024 }).toEqual({ entry, grows: false });
  }
}, 240_000);

test("bun run --aot interprets nothing of them", async () => {
  const programs = { ...withoutADoor, ...withADoor };
  using dir = tempDir("builtin-modules-and-node-module", { ...files, ...programs });
  await Promise.all(
    Object.keys(programs).map(entry =>
      slot(async () => {
        const { stdout, exitCode } = await run([bunExe(), "run", "--debug-aot", entry], String(dir), env);
        expect({ entry, stdout, exitCode }).toEqual({ entry, stdout: "run\n", exitCode: 0 });
      }),
    ),
  );
}, 240_000);
