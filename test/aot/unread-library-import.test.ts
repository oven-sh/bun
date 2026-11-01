// package.json says `"sideEffects": false`, and a file of the library imports another one by a statement that binds nothing: `import "./setup.mjs"`.
// `bun build --compile` drops such a statement, so the executable never runs setup.mjs. A test run shows what the executable does, however it is cut into programs.
// `bun test`, which bundles nothing, runs setup.mjs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const uses = `import { made } from "./helper.mjs";\nconsole.log("made:", made, "ready:", globalThis.ready);\n`;
const shared = {
  "package.json": `{ "name": "z", "sideEffects": false }`,
  "setup.mjs": `console.log("setup runs");\nglobalThis.ready = true;\nexport default 1;\n`,
  "main.mjs": uses,
  "a.test.mjs": `import { test } from "bun:test";\n${uses}test("runs", () => {});\n`,
};
const forms: Record<string, Record<string, string>> = {
  "a bare import": { "helper.mjs": `import "./setup.mjs";\nexport const made = 1;\n` },
  "no name at all": { "helper.mjs": `import {} from "./setup.mjs";\nexport const made = 1;\n` },
  "two files further on": {
    "helper.mjs": `import { made } from "./between.mjs";\nexport { made };\n`,
    "between.mjs": `import "./setup.mjs";\nexport const made = 1;\n`,
  },
};
const lines = (text: string) => text.split("\n").filter(line => line && !line.startsWith("bun test "));

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: lines(stdout), exitCode };
}

async function runExecutable(folder: string, flags: string[]) {
  const outfile = join(folder, flags.length ? "compiled" : "bundled");
  const built = await run([bunExe(), "build", "--compile", ...flags, "./main.mjs", "--outfile", outfile], folder);
  expect(built.stderr + built.stdout).not.toContain("error");
  expect(built.exitCode).toBe(0);
  const { stdout, exitCode } = await run([outfile], folder);
  return { printed: lines(stdout), exitCode };
}

for (const [form, files] of Object.entries(forms))
  test.concurrent(
    form,
    async () => {
      using dir = tempDir("unread-library-import", { ...shared, ...files });
      const folder = String(dir);
      const dropped = { printed: ["made: 1 ready: undefined"], exitCode: 0 };
      expect(await runTests(folder, ["--isolate"])).toEqual({
        printed: ["setup runs", "made: 1 ready: true"],
        exitCode: 0,
      });
      expect(await runExecutable(folder, [])).toEqual(dropped);
      expect(await runExecutable(folder, ["--aot"])).toEqual(dropped);
      expect(await runTests(folder, ["--aot"])).toEqual(dropped);
      expect(await runTests(folder, ["--aot", "--isolate"], "TestRunLayers:0")).toEqual(dropped);
      expect(await runTests(folder, ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(dropped);
    },
    240_000,
  );

// Whoever stands above a layer may read any name through an `export *`, so such a statement stays: without it `made` is never initialized.
test.concurrent(
  "a name comes through two barrels, over two layers",
  async () => {
    using dir = tempDir("unread-library-import-barrels", {
      "package.json": shared["package.json"],
      "defines.mjs": `export const made = 1;\n`,
      "inner.mjs": `export * from "./defines.mjs";\n`,
      "outer.mjs": `export * from "./inner.mjs";\n`,
      "a.test.mjs": `import { test } from "bun:test";\nimport { made } from "./outer.mjs";\nconsole.log("made:", made);\ntest("runs", () => {});\n`,
    });
    const expected = { printed: ["made: 1"], exitCode: 0 };
    expect(await runTests(String(dir), ["--isolate"])).toEqual(expected);
    expect(await runTests(String(dir), ["--aot", "--isolate"], "TestRunLayers:0")).toEqual(expected);
    expect(await runTests(String(dir), ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(expected);
  },
  240_000,
);

// `import * as all` takes no name of the file, and whoever reads `all` reads every one: such a statement stays.
const read: Record<string, string> = {
  "by a spread": `import * as all from "./names.mjs";\nexport default { ...all };\n`,
  "by Object.keys()": `import * as all from "./names.mjs";\nexport default Object.keys(all);\n`,
  "under computed names": `import * as all from "./names.mjs";\nexport default ["a", "b"].map(name => all[name]);\n`,
  "in a function": `import * as all from "./names.mjs";\nconst copy = () => ({ ...all });\nexport default copy();\n`,
  "handed on": `import * as all from "./names.mjs";\nexport { all };\nexport default all.a;\n`,
  "beside a statement that binds nothing": `import "./names.mjs";\nimport * as all from "./names.mjs";\nexport default { ...all };\n`,
};
for (const [form, library] of Object.entries(read))
  test.concurrent(
    `a namespace is read ${form}`,
    async () => {
      using dir = tempDir("unread-library-import-namespace", {
        "package.json": shared["package.json"],
        "names.mjs": `export const a = 1;\nexport const b = 2;\n`,
        "library.mjs": library,
        "a.test.mjs": `import { test } from "bun:test";\nimport made from "./library.mjs";\nconsole.log(JSON.stringify(made));\ntest("runs", () => {});\n`,
      });
      const plain = await runTests(String(dir), ["--isolate"]);
      expect(plain.printed).toHaveLength(1);
      expect(plain.exitCode).toBe(0);
      expect(await runTests(String(dir), ["--aot"])).toEqual(plain);
      expect(await runTests(String(dir), ["--aot", "--isolate"], "TestRunLayers:0")).toEqual(plain);
      expect(await runTests(String(dir), ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
    },
    240_000,
  );

// A call brings the file into the executable all the same. It runs where the call runs, as in `bun build --compile`, and not where the dropped statement stood.
const free = `console.log("free runs");\nexport const free = 1;\n`;
const helper = `import "./free.mjs";\nexport const made = 1;\nconsole.log("helper runs");\n`;
const brought: Record<string, { files: Record<string, string>; printed: string[] }> = {
  "the entry point imports it and loads it later": {
    files: {
      "main.mjs": `import "./free.mjs";\nconsole.log("main");\nawait import("./free.mjs");\nconsole.log("end");\n`,
    },
    printed: ["main", "free runs", "end"],
  },
  "a file of the library imports it, and the entry point loads it later": {
    files: {
      "helper.mjs": helper,
      "main.mjs": `import { made } from "./helper.mjs";\nconsole.log("main", made);\nawait import("./free.mjs");\nconsole.log("end");\n`,
    },
    printed: ["helper runs", "main 1", "free runs", "end"],
  },
  "the call never runs": {
    files: {
      "helper.mjs": helper,
      "main.mjs": `import { made } from "./helper.mjs";\nconsole.log("main", made);\nif (process.argv.length > 9) await import("./free.mjs");\nconsole.log("end");\n`,
    },
    printed: ["helper runs", "main 1", "end"],
  },
};
for (const [form, { files, printed }] of Object.entries(brought))
  test.concurrent(
    `an executable: ${form}`,
    async () => {
      using dir = tempDir("unread-library-import-call", {
        "package.json": shared["package.json"],
        "free.mjs": free,
        ...files,
      });
      expect(await runExecutable(String(dir), [])).toEqual({ printed, exitCode: 0 });
      expect(await runExecutable(String(dir), ["--aot"])).toEqual({ printed, exitCode: 0 });
    },
    240_000,
  );
