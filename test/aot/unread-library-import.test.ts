// package.json says `"sideEffects": false`, and a file of the library imports another one by a statement that binds nothing: `import "./setup.mjs"`.
// `bun build --compile` drops such a statement, so the executable never runs setup.mjs. A test run shows what the executable does, however it is cut into programs.
// `bun test`, which bundles nothing, runs setup.mjs.
//
// Every form is a folder of one project, with a package.json of its own, and the project runs once in each way: a run over layers costs the same whatever it holds.
// ID in a text is the folder's name: each line that is printed begins with it, and so does each global, because at default flags the test files share a realm.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { afterAll } from "./listed";
import { test } from "./supported";

const packageJson = `{ "name": "z", "sideEffects": false }`;
const project: Record<string, string> = {};
let count = 0;
function add(files: Record<string, string>) {
  const id = `c${String(++count).padStart(2, "0")}`;
  for (const [path, text] of Object.entries({ "package.json": packageJson, ...files }))
    project[`${id}/${path}`] = text.replaceAll("ID", id);
  return id;
}
let folder: ReturnType<typeof tempDir> | undefined;
afterAll(() => folder?.[Symbol.dispose]());
const folderOf = (id: string) => join(String((folder ??= tempDir("unread-library-import", project))), id);

const ways = [
  ["at default flags", ["--aot"], ""],
  ["as one program under --isolate", ["--aot", "--isolate"], "TestRunLayers:0"],
  ["over two layers", ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as const;
const runs = new Map<string, Promise<{ printed: Map<string, string[]>; exitCode: number | null }>>();
/** What each folder printed in one run of the whole project. */
function ran(flags: readonly string[], words = "") {
  return runs.getOrInsertComputed(JSON.stringify([flags, words]), async () => {
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], join(folderOf("c01"), ".."), env);
    const printed = new Map<string, string[]>();
    for (const [, id, text] of stdout.matchAll(/^(c\d+)\| (.*)$/gm))
      printed.getOrInsertComputed(id, () => []).push(text);
    return { printed, exitCode };
  });
}
const seen = async (id: string, flags: readonly string[], words = "") =>
  (await ran(flags, words)).printed.get(id) ?? [];
// One folder that fails ends the run with 1. Each folder is judged by what it printed, so that the one at fault is named.
for (const [way, flags, words] of [["uncompiled", ["--isolate"], ""], ...ways] as const)
  test.concurrent(
    `no test file fails, ${way}`,
    async () => expect((await ran(flags, words)).exitCode).toBe(0),
    240_000,
  );

async function runExecutable(id: string, flags: string[]) {
  const outfile = join(folderOf(id), flags.length ? "compiled" : "bundled");
  const built = await run([bunExe(), "build", "--compile", ...flags, "./main.mjs", "--outfile", outfile], folderOf(id));
  expect(built.stderr + built.stdout).not.toContain("error");
  expect(built.exitCode).toBe(0);
  const { stdout, exitCode } = await run([outfile], folderOf(id));
  const mark = `${id}| `;
  return {
    printed: stdout.split("\n").flatMap(line => (line.startsWith(mark) ? [line.slice(mark.length)] : [])),
    exitCode,
  };
}

const testFile = (text: string) => `import { test } from "bun:test";\n${text}test("runs", () => {});\n`;
const uses = `import { made } from "./helper.mjs";\nconsole.log("ID| made:", made, "ready:", globalThis.readyID);\n`;
const shared = {
  "setup.mjs": `console.log("ID| setup runs");\nglobalThis.readyID = true;\nexport default 1;\n`,
  "main.mjs": uses,
  "a.test.mjs": testFile(uses),
};
const forms: Record<string, Record<string, string>> = {
  "a bare import": { "helper.mjs": `import "./setup.mjs";\nexport const made = 1;\n` },
  "no name at all": { "helper.mjs": `import {} from "./setup.mjs";\nexport const made = 1;\n` },
  "two files further on": {
    "helper.mjs": `import { made } from "./between.mjs";\nexport { made };\n`,
    "between.mjs": `import "./setup.mjs";\nexport const made = 1;\n`,
  },
};
const dropped = ["made: 1 ready: undefined"];
for (const [form, files] of Object.entries(forms)) {
  const id = add({ ...shared, ...files });
  test.concurrent(
    `${form}, uncompiled and as an executable`,
    async () => {
      expect(await seen(id, ["--isolate"])).toEqual(["setup runs", "made: 1 ready: true"]);
      expect(await runExecutable(id, [])).toEqual({ printed: dropped, exitCode: 0 });
      expect(await runExecutable(id, ["--aot"])).toEqual({ printed: dropped, exitCode: 0 });
    },
    240_000,
  );
  for (const [way, flags, words] of ways)
    test.concurrent(`${form}, ${way}`, async () => expect(await seen(id, flags, words)).toEqual(dropped), 240_000);
}

// Whoever stands above a layer may read any name through an `export *`, so such a statement stays: without it `made` is never initialized.
// `import * as all` takes no name of the file, and whoever reads `all` reads every one: such a statement stays too.
const names = { "names.mjs": `export const a = 1;\nexport const b = 2;\n` };
const prints = testFile(`import made from "./library.mjs";\nconsole.log("ID|", JSON.stringify(made));\n`);
const kept: Record<string, Record<string, string>> = {
  "a name comes through two barrels": {
    "defines.mjs": `export const made = 1;\n`,
    "inner.mjs": `export * from "./defines.mjs";\n`,
    "outer.mjs": `export * from "./inner.mjs";\n`,
    "a.test.mjs": testFile(`import { made } from "./outer.mjs";\nconsole.log("ID| made:", made);\n`),
  },
  "a namespace is read by a spread": {
    "library.mjs": `import * as all from "./names.mjs";\nexport default { ...all };\n`,
  },
  "a namespace is read by Object.keys()": {
    "library.mjs": `import * as all from "./names.mjs";\nexport default Object.keys(all);\n`,
  },
  "a namespace is read under computed names": {
    "library.mjs": `import * as all from "./names.mjs";\nexport default ["a", "b"].map(name => all[name]);\n`,
  },
  "a namespace is read in a function": {
    "library.mjs": `import * as all from "./names.mjs";\nconst copy = () => ({ ...all });\nexport default copy();\n`,
  },
  "a namespace is read handed on": {
    "library.mjs": `import * as all from "./names.mjs";\nexport { all };\nexport default all.a;\n`,
  },
  "a namespace is read beside a statement that binds nothing": {
    "library.mjs": `import "./names.mjs";\nimport * as all from "./names.mjs";\nexport default { ...all };\n`,
  },
};
for (const [form, files] of Object.entries(kept)) {
  const id = add({ ...names, "a.test.mjs": prints, ...files });
  for (const [way, flags, words] of ways)
    test.concurrent(
      `${form}, ${way}`,
      async () => {
        const plain = await seen(id, ["--isolate"]);
        expect(plain).toHaveLength(1);
        expect(await seen(id, flags, words)).toEqual(plain);
      },
      240_000,
    );
}

// A call brings the file into the executable all the same. It runs where the call runs, as in `bun build --compile`, and not where the dropped statement stood.
const free = `console.log("ID| free runs");\nexport const free = 1;\n`;
const helper = `import "./free.mjs";\nexport const made = 1;\nconsole.log("ID| helper runs");\n`;
const brought: Record<string, { files: Record<string, string>; printed: string[] }> = {
  "the entry point imports it and loads it later": {
    files: {
      "main.mjs": `import "./free.mjs";\nconsole.log("ID| main");\nawait import("./free.mjs");\nconsole.log("ID| end");\n`,
    },
    printed: ["main", "free runs", "end"],
  },
  "a file of the library imports it, and the entry point loads it later": {
    files: {
      "helper.mjs": helper,
      "main.mjs": `import { made } from "./helper.mjs";\nconsole.log("ID| main", made);\nawait import("./free.mjs");\nconsole.log("ID| end");\n`,
    },
    printed: ["helper runs", "main 1", "free runs", "end"],
  },
  "the call never runs": {
    files: {
      "helper.mjs": helper,
      "main.mjs": `import { made } from "./helper.mjs";\nconsole.log("ID| main", made);\nif (process.argv.length > 9) await import("./free.mjs");\nconsole.log("ID| end");\n`,
    },
    printed: ["helper runs", "main 1", "end"],
  },
};
for (const [form, { files, printed }] of Object.entries(brought)) {
  const id = add({ "free.mjs": free, ...files });
  test.concurrent(
    `an executable: ${form}`,
    async () => {
      expect(await runExecutable(id, [])).toEqual({ printed, exitCode: 0 });
      expect(await runExecutable(id, ["--aot"])).toEqual({ printed, exitCode: 0 });
    },
    240_000,
  );
}
