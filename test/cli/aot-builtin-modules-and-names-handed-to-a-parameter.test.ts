import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { test } from "../aot/supported";
import { importingByName } from "./aot-builtin-modules";

const wire = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function built(entry: string, text: string) {
  using dir = tempDir("names-handed-to-a-parameter", { [entry]: text });
  const cwd = String(dir);
  const plain = await run([bunExe(), "run", `./${entry}`], cwd, bunEnv);
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", "made.exe"],
    cwd,
    bunEnv,
  );
  expect({ entry, exitCode: build.exitCode }).toEqual({ entry, exitCode: 0 });
  const made = await run([join(cwd, "made.exe")], cwd, wire);
  return {
    size: statSync(join(cwd, "made.exe")).size,
    stdout: made.stdout,
    exitCode: made.exitCode,
    plain: plain.stdout,
  };
}

const known: Record<string, string> = {
  "import-of-a-parameter.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconsole.log(typeof (await importAtRunTime("node:path")).join);\n`,
  "require-of-a-parameter.cjs": `const load = name => require(name);\nconsole.log(typeof load("node:path").join, typeof load("node:path").sep);\n`,
};

const unknown = importingByName("node:zlib", {
  "one-call-computes-the-name.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconst name = ["node:", "zlib"].join("");\nconsole.log(typeof (await importAtRunTime("node:path")).join, typeof (await importAtRunTime(name)).gzipSync);\n`,
  "the-function-is-handed-on.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconst name = ["node:", "zlib"].join("");\nconsole.log(typeof (await Promise.all([name].map(importAtRunTime)))[0].gzipSync);\n`,
  "the-function-is-exported.mjs": `export function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconsole.log(typeof (await importAtRunTime("node:path")).join);\n`,
  "the-parameter-is-stored-to.cjs": `function load(name) {\n  name = ["node:", "zlib"].join("");\n  return require(name);\n}\nconsole.log(typeof load("node:path").gzipSync);\n`,
  "the-arguments-object-stores-to-it.cjs": `function load(name) {\n  arguments[0] = ["node:", "zlib"].join("");\n  return require(name);\n}\nconsole.log(typeof load("node:path").gzipSync);\n`,
  "the-name-is-spread.cjs": `function load(name) {\n  return require(name);\n}\nconsole.log(typeof load(...[["node:", "zlib"].join("")]).gzipSync);\n`,
  "a-default-computes-the-name.cjs": `function load(name = ["node:", "zlib"].join("")) {\n  return require(name);\n}\nconsole.log(typeof load().gzipSync);\n`,
});

test("a name that only written strings are handed to is a written name", async () => {
  const plain = await built("plain.mjs", `import { join } from "node:path";\nconsole.log(typeof join);\n`);
  for (const [entry, text] of Object.entries(known)) {
    const found = await built(entry, text);
    expect({
      entry,
      stdout: found.stdout,
      exitCode: found.exitCode,
      grows: found.size - plain.size > 2 * 1024 * 1024,
    }).toEqual({ entry, stdout: found.plain, exitCode: 0, grows: false });
  }
}, 240_000);

test("a name that anything else can reach stays a computed one", async () => {
  for (const [entry, text] of Object.entries(unknown)) {
    const found = await built(entry, text);
    expect({ entry, stdout: found.stdout, exitCode: found.exitCode }).toEqual({
      entry,
      stdout: found.plain,
      exitCode: 0,
    });
  }
}, 480_000);
