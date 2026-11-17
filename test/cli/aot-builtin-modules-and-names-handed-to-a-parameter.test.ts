import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../aot/harness/run";
import { test } from "../aot/supported";
import { compileEachAlone, importingByName, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

const plain = "plain.mjs";
const known: Record<string, string> = {
  "import-of-a-parameter.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconsole.log(typeof (await importAtRunTime("node:path")).join);\n`,
  "require-of-a-parameter.cjs": `const load = name => require(name);\nconsole.log(typeof load("node:path").join, typeof load("node:path").sep);\n`,
};

const unknown = importingByName("node:querystring", {
  "one-call-computes-the-name.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconst name = ["node:", "querystring"].join("");\nconsole.log(typeof (await importAtRunTime("node:path")).join, typeof (await importAtRunTime(name)).escape);\n`,
  "the-function-is-handed-on.mjs": `function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconst name = ["node:", "querystring"].join("");\nconsole.log(typeof (await Promise.all([name].map(importAtRunTime)))[0].escape);\n`,
  "the-function-is-exported.mjs": `export function importAtRunTime(specifier) {\n  return import(specifier);\n}\nconsole.log(typeof (await importAtRunTime("node:path")).join);\n`,
  "the-parameter-is-stored-to.cjs": `function load(name) {\n  name = ["node:", "querystring"].join("");\n  return require(name);\n}\nconsole.log(typeof load("node:path").escape);\n`,
  "the-arguments-object-stores-to-it.cjs": `function load(name) {\n  arguments[0] = ["node:", "querystring"].join("");\n  return require(name);\n}\nconsole.log(typeof load("node:path").escape);\n`,
  "the-name-is-spread.cjs": `function load(name) {\n  return require(name);\n}\nconsole.log(typeof load(...[["node:", "querystring"].join("")]).escape);\n`,
  "a-default-computes-the-name.cjs": `function load(name = ["node:", "querystring"].join("")) {\n  return require(name);\n}\nconsole.log(typeof load().escape);\n`,
});

const written = "written-names.mjs";
const computed = "computed-names.mjs";

test.skipIf(!startsAtAnyEntryPoint)(
  "a name that only written strings are handed to is a written name, and one that anything else can reach stays a computed one",
  async () => {
    using dir = tempDir("names-handed-to-a-parameter", {
      [plain]: `import { join } from "node:path";\nconsole.log(typeof join);\n`,
      ...known,
      ...unknown,
      [written]: oneAfterTheOther(known),
      [computed]: oneAfterTheOther(unknown),
    });
    const cwd = String(dir);
    const [ran, ...interpreted] = await Promise.all([
      compileEachAlone(cwd, [plain, written, computed]),
      ...[written, computed].map(entry => run([bunExe(), "run", `./${entry}`], cwd, bunEnv)),
    ]);
    expect(ran).toEqual({
      [plain]: { stdout: "function\n", exitCode: 0, bytes: expect.any(Number) },
      [written]: { stdout: interpreted[0].stdout, exitCode: 0, bytes: expect.any(Number) },
      [computed]: { stdout: interpreted[1].stdout, exitCode: 0, bytes: expect.any(Number) },
    });
    expect(interpreted.map(({ stdout }) => stdout.split("\n").length - 1)).toEqual(
      [known, unknown].map(programs => Object.keys(programs).length),
    );
    expect(ran[written].bytes - ran[plain].bytes).toBeLessThan(2 * 1024 * 1024);
  },
  240_000,
);
