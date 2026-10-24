// Full types that are there and that a build does not use: the build says what it found, why it is not used and what to do.
// A program is never refused for it, and prints what it prints without them.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../../aot/run-programs";
import { describe, test } from "../../aot/supported";

type Files = Record<string, string>;

async function compile(folder: string, entry = "./app.ts") {
  const program = join(folder, isWindows ? "app.exe" : "app");
  const command = [bunExe(), "compile", entry, "--outfile", program];
  const built = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  const lines = (built.stdout + built.stderr).replaceAll("\\", "/").split(/\r?\n/);
  const said = (prefix: string) => lines.filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length));
  const ran = built.exitCode === 0 ? await spawned([program], folder, bunEnv) : undefined;
  return {
    errors: said("error: "),
    warnings: said("warn: "),
    notes: said("note: "),
    exitCode: built.exitCode,
    signal: built.signal,
    stdout: ran?.stdout,
  };
}

const slashed = (path: string) => path.replaceAll("\\", "/");

const said = (warnings: string[], notes: string[], stdout: string) => ({
  errors: [],
  warnings,
  notes,
  exitCode: 0,
  signal: null,
  stdout,
});

const summary = (have: number, used: number) =>
  `${have === 1 ? "1 package has" : have + " packages have"} full types, and ${used === 0 ? "none are" : used === 1 ? "1 is" : used + " are"} compiled from them`;

describe.concurrent("a package that ships full types", () => {
  const conditions = { types: "./index.d.ts", "full-types": "./index.full.ts", default: "./index.js" };
  const manifest = (members: object) =>
    JSON.stringify({ name: "greeter", version: "1.0.0", type: "module", ...members });
  const greeter = (members: object, files: Files = {}): Files => ({
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "app.ts": `import { greet } from "greeter";\nconsole.log(greet("Ada"));\n`,
    "node_modules/greeter/package.json": manifest(members),
    "node_modules/greeter/index.js": `export function greet(name) {\n  return "hello " + name;\n}\n`,
    "node_modules/greeter/index.d.ts": `export declare function greet(name: string): string;\n`,
    "node_modules/greeter/index.full.ts": `export function greet(name: string): string {\n  return "hello " + name;\n}\n`,
    ...files,
  });
  const used = '"greeter" 1.0.0 is compiled from its full types in node_modules/greeter';
  const unused = (reason: string) =>
    `"greeter" is compiled without types, because its full types in node_modules/greeter can't be used: ${reason}`;
  const notExported =
    'index.full.ts is beside index.js, but no "full-types" condition in the "exports" of package.json points at it';
  const misspelled =
    'the "exports" of package.json point at index.full.ts under a condition that isn\'t spelled "full-types"';
  const ignored = (member: string) =>
    `TS100068: "${member}" in node_modules/greeter/package.json is ignored, so the full types of "greeter" are type checked as strict. bun compile reads "compilerOptions" at the top level of that file`;

  const { "full-types": typed, ...others } = conditions;
  const wrong: [title: string, files: Files, warning: string][] = [
    ["no condition in exports", greeter({ exports: { ".": others } }), unused(notExported)],
    ["no exports", greeter({ main: "./index.js", types: "./index.d.ts" }), unused(notExported)],
    [
      "the condition behind default",
      greeter({ exports: { ".": { ...others, "full-types": typed } } }),
      unused(
        'in the "exports" of package.json, the "full-types" condition that points at index.full.ts comes after a condition that already matches. Put it before "import", "require" and "default"',
      ),
    ],
    [
      "the condition without its s",
      greeter({ exports: { ".": { "full-type": typed, ...others } } }),
      unused(misspelled),
    ],
    ["the condition in camel case", greeter({ exports: { ".": { fullTypes: typed, ...others } } }), unused(misspelled)],
    [
      "the condition capitalized",
      greeter({ exports: { ".": { "Full-Types": typed, ...others } } }),
      unused(misspelled),
    ],
    [
      "a field at the top level, like types",
      greeter({ main: "./index.js", types: "./index.d.ts", "full-types": typed }),
      unused(
        'package.json points at index.full.ts in a "full-types" field at the top level. It has to be a condition in "exports"',
      ),
    ],
    [
      "a file that is not there",
      greeter({ exports: { ".": { ...conditions, "full-types": "./typed.ts" } } }),
      unused("typed.ts is missing"),
    ],
    [
      "the declaration file",
      greeter({ exports: { ".": { ...conditions, "full-types": "./index.d.ts" } } }),
      unused("index.d.ts is a declaration file. A full-types file is index.js with types added"),
    ],
    [
      "a file that nothing checks",
      greeter(
        { exports: { ".": conditions } },
        {
          "node_modules/greeter/index.full.ts": `// @ts-nocheck\nexport function greet(name: string): string {\n  return "hello " + name;\n}\n`,
        },
      ),
      unused("index.full.ts has a // @ts-nocheck comment, so nothing checks its types. Remove the comment"),
    ],
    [
      "a file that is other code",
      greeter(
        { exports: { ".": conditions } },
        {
          "node_modules/greeter/index.full.ts": `export function greet(name: string): string {\n  return "hi " + name;\n}\n`,
        },
      ),
      unused("index.full.ts without its types doesn't match index.js. Was the package patched?"),
    ],
  ];

  test.each(wrong)(
    "%s",
    (_, files, warning) =>
      slot(async () => {
        using dir = tempDir("full-types-not-used", files);
        expect(await compile(String(dir))).toEqual(said([warning], [summary(1, 0)], "hello Ada\n"));
      }),
    600_000,
  );

  test(
    "laid as the documentation says",
    () =>
      slot(async () => {
        using dir = tempDir(
          "full-types-used",
          greeter({ exports: { ".": conditions }, compilerOptions: { strict: true } }),
        );
        expect(await compile(String(dir))).toEqual(said([], [used, summary(1, 1)], "hello Ada\n"));
      }),
    600_000,
  );

  const options: [title: string, members: object, member: string][] = [
    [
      "inside an entry of exports",
      { exports: { ".": { compilerOptions: { strict: false }, ...conditions } } },
      "exports > . > compilerOptions",
    ],
    ["in lower case", { exports: { ".": conditions }, compileroptions: { strict: false } }, "compileroptions"],
    ["with a dash", { exports: { ".": conditions }, "compiler-options": { strict: false } }, "compiler-options"],
    [
      "inside publishConfig",
      { exports: { ".": conditions }, publishConfig: { compilerOptions: { strict: false } } },
      "publishConfig > compilerOptions",
    ],
  ];

  test.each(options)(
    "compilerOptions %s",
    (_, members, member) =>
      slot(async () => {
        using dir = tempDir("full-types-options", greeter(members));
        expect(await compile(String(dir))).toEqual(said([ignored(member)], [used, summary(1, 1)], "hello Ada\n"));
      }),
    600_000,
  );

  const invalid: [title: string, compilerOptions: unknown, error: string][] = [
    ["an option that TypeScript does not have", { stric: true }, "TS5023: Unknown compiler option 'stric'."],
    [
      "a text where a boolean goes",
      { strict: "no" },
      "TS5024: Compiler option 'strict' requires a value of type boolean.",
    ],
    ["a list", [], "TS5024: Compiler option 'compilerOptions' requires a value of type object."],
  ];

  test.each(invalid)(
    "compilerOptions with %s",
    (_, compilerOptions, error) =>
      slot(async () => {
        using dir = tempDir("full-types-options", greeter({ exports: { ".": conditions }, compilerOptions }));
        const warning = `TS100070: "compilerOptions" in node_modules/greeter/package.json has an error, so the full types of "greeter" are type checked without that option: ${error}`;
        expect(await compile(String(dir))).toEqual(said([warning], [used, summary(1, 1)], "hello Ada\n"));
      }),
    600_000,
  );

  test(
    "the declaration file under the condition is still what the program is type checked against",
    () =>
      slot(async () => {
        const files = greeter({ exports: { ".": { ...conditions, "full-types": "./index.d.ts" } } });
        using dir = tempDirWithBunTypes("full-types-not-used", files);
        expect(await compile(String(dir))).toMatchObject({ errors: [], exitCode: 0, stdout: "hello Ada\n" });
      }),
    600_000,
  );

  test(
    "compilerOptions of another tool are nobody's mistake",
    () =>
      slot(async () => {
        const members = { exports: { ".": conditions }, tsd: { compilerOptions: { strict: false } } };
        using dir = tempDir("full-types-options", greeter(members));
        expect(await compile(String(dir))).toEqual(said([], [used, summary(1, 1)], "hello Ada\n"));
      }),
    600_000,
  );

  test(
    "one warning for a package, however many of its files have one beside them",
    () =>
      slot(async () => {
        const files = greeter(
          { main: "./index.js" },
          {
            "node_modules/greeter/index.js": `import { hello } from "./hello.js";\nexport function greet(name) {\n  return hello + name;\n}\n`,
            "node_modules/greeter/index.full.ts": `import { hello } from "./hello.js";\nexport function greet(name: string): string {\n  return hello + name;\n}\n`,
            "node_modules/greeter/hello.js": `export const hello = "hello ";\n`,
            "node_modules/greeter/hello.full.ts": `export const hello: string = "hello ";\n`,
          },
        );
        using dir = tempDir("full-types-not-used", files);
        const { warnings, ...rest } = await compile(String(dir));
        expect(rest).toEqual((({ warnings, ...rest }) => rest)(said([], [summary(1, 0)], "hello Ada\n")));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith(
          '"greeter" is compiled without types, because its full types in node_modules/greeter',
        );
      }),
    600_000,
  );

  test(
    "an entry of exports that has no condition, beside one that has",
    () =>
      slot(async () => {
        const files = greeter(
          { exports: { ".": conditions, "./version": "./version.js" } },
          {
            "app.ts": `import { greet } from "greeter";\nimport { version } from "greeter/version";\nconsole.log(greet("Ada"), version);\n`,
            "node_modules/greeter/version.js": `export const version = "1.0.0";\n`,
            "node_modules/greeter/version.full.ts": `export const version: string = "1.0.0";\n`,
          },
        );
        using dir = tempDir("full-types-not-used", files);
        const warning = unused(
          notExported.replace("index.full.ts", "version.full.ts").replace("index.js", "version.js"),
        );
        expect(await compile(String(dir))).toEqual(said([warning], [summary(1, 0)], "hello Ada 1.0.0\n"));
      }),
    600_000,
  );
});

describe.concurrent("full types that a project has for a package", () => {
  const installed: Files = {
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "app.ts": `import { eachRow } from "each-row";\neachRow([{ id: 1 }, { id: 2 }], row => console.log(row.id));\n`,
    "node_modules/each-row/package.json": JSON.stringify({
      name: "each-row",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      types: "index.d.ts",
    }),
    "node_modules/each-row/index.js": `export function eachRow(rows, visit) {\n  for (const row of rows) visit(row);\n}\n`,
    "node_modules/each-row/index.d.ts": `export function eachRow<Row>(rows: Row[], visit: (row: Row) => void): void;\n`,
  };
  const manifest = (members: object = {}) =>
    JSON.stringify({
      format: 2,
      name: "each-row",
      version: "1.0.0",
      when: {},
      lay: { "index.js": "" },
      needs: [],
      ...members,
    });
  const typed = `export function eachRow<Row>(rows: Row[], visit: (row: Row) => void): void {\n  for (const row of rows) visit(row);\n}\n`;
  const kit = (folder: string, members: object = {}): Files => ({
    [`${folder}/full-types.json`]: manifest(members),
    [`${folder}/lay/index.js`]: typed,
  });
  const printed = "1\n2\n";
  const used = (folder: string) => `"each-row" 1.0.0 is compiled from its full types in ${folder}`;
  const unused = (name: string, reason: string) =>
    `TS100056: The full types of "${name}" in .full-types/${name} can't be used: ${reason}`;
  const unread = (folder: string, reason: string) => `TS100067: bun compile doesn't read ${folder}: ${reason}`;
  const noManifest = "it has no full-types.json. Add the file, or remove the folder";
  const misnamed = "the folder has to be named .full-types";

  test(
    "laid as the documentation says",
    () =>
      slot(async () => {
        using dir = tempDir("full-types-used", { ...installed, ...kit(".full-types/each-row") });
        expect(await compile(String(dir))).toEqual(said([], [used(".full-types/each-row"), summary(1, 1)], printed));
      }),
    600_000,
  );

  test(
    "a project that has nothing of the kind hears nothing",
    () =>
      slot(async () => {
        using dir = tempDir("no-full-types", installed);
        expect(await compile(String(dir))).toEqual(said([], [], printed));
      }),
    600_000,
  );

  const wrong: [title: string, files: Files, warnings: string[], have: number][] = [
    [
      "full-types.json under another name",
      { ".full-types/each-row/sound.json": manifest(), ".full-types/each-row/lay/index.js": typed },
      [unread(".full-types/each-row", noManifest)],
      0,
    ],
    [
      "a scoped package without full-types.json",
      { ".full-types/@rows/each/lay/index.js": typed },
      [unread(".full-types/@rows/each", noManifest)],
      0,
    ],
    [
      "a package that the program never imports",
      kit(".full-types/every-row", { name: "every-row" }),
      [unused("every-row", `the program doesn't import "every-row". Check the name of the folder, or remove it`)],
      1,
    ],
    [
      "the folder of the package in another case",
      kit(".full-types/Each-Row"),
      [unused("Each-Row", `the program imports "each-row", spelled differently. Rename the folder`)],
      1,
    ],
    ["the folder without its dot", kit("full-types/each-row"), [unread("full-types", misnamed)], 0],
    ["the folder with an underscore", kit(".full_types/each-row"), [unread(".full_types", misnamed)], 0],
    ["the folder without its s", kit(".full-type/each-row"), [unread(".full-type", misnamed)], 0],
    [
      "the folder under its former name",
      { ".sound/each-row/sound.json": manifest(), ".sound/each-row/lay/index.js": typed },
      [unread(".sound", misnamed)],
      0,
    ],
    [
      "another name in full-types.json",
      kit(".full-types/each-row", { name: "every-row" }),
      [unused("each-row", `the "name" in full-types.json is "every-row", but the folder is for "each-row"`)],
      1,
    ],
    [
      "no format in full-types.json",
      kit(".full-types/each-row", { format: undefined, sound: 2 }),
      [unused("each-row", `"format" in full-types.json is missing or not valid`)],
      1,
    ],
    [
      "a format that this Bun does not know",
      kit(".full-types/each-row", { format: 3 }),
      [unused("each-row", `this version of Bun doesn't support the "format" in full-types.json`)],
      1,
    ],
    [
      "another version",
      kit(".full-types/each-row", { version: "2.0.0" }),
      [
        unused(
          "each-row",
          "they are for version 2.0.0, but 1.0.0 is installed. Replace them with the full types for 1.0.0, or remove them",
        ),
      ],
      1,
    ],
    [
      "the file under lay named as TypeScript",
      {
        ".full-types/each-row/full-types.json": manifest({ lay: { "index.ts": "" } }),
        ".full-types/each-row/lay/index.ts": typed,
      },
      [unused("each-row", "they add index.ts, and full types can only replace installed files")],
      1,
    ],
    [
      "the file beside full-types.json",
      { ".full-types/each-row/full-types.json": manifest(), ".full-types/each-row/index.js": typed },
      [unused("each-row", "lay/index.js is missing")],
      1,
    ],
    [
      "installed without the prefix",
      kit("node_modules/@oven/each-row"),
      [unread("node_modules/@oven/each-row", "a package that holds full types is named @oven/full-types-<name>")],
      0,
    ],
    [
      "installed without full-types.json",
      { "node_modules/@oven/full-types-each-row/lay/index.js": typed },
      [unread("node_modules/@oven/full-types-each-row", noManifest)],
      0,
    ],
  ];
  if (isLinux)
    wrong.push(["the folder capitalized", kit(".Full-Types/each-row"), [unread(".Full-Types", misnamed)], 0]);

  test.each(wrong)(
    "%s",
    (_, files, warnings, have) =>
      slot(async () => {
        using dir = tempDir("full-types-not-used", { ...installed, ...files });
        expect(await compile(String(dir))).toEqual(said(warnings, have ? [summary(have, 0)] : [], printed));
      }),
    600_000,
  );

  const hasDocument = (has: boolean) => ({
    "node_modules/each-row/index.js": `const hasDocument = ${has};\n` + installed["node_modules/each-row/index.js"],
    ".full-types/each-row/lay/index.js":
      `const hasDocument: typeof globalThis extends { document: unknown } ? true : false = ${has};\n` + typed,
  });

  test(
    "they are type checked under the options that a package's own full types are: the default lib",
    () =>
      slot(async () => {
        using dir = tempDir("full-types-options", {
          ...installed,
          ...kit(".full-types/each-row"),
          ...hasDocument(true),
        });
        expect(await compile(String(dir))).toEqual(said([], [used(".full-types/each-row"), summary(1, 1)], printed));
      }),
    600_000,
  );

  // A number where the text says string: an error only where `process` has its type.
  const readsProcess = {
    "node_modules/each-row/index.js": `const pid = process.pid;\n` + installed["node_modules/each-row/index.js"],
    ".full-types/each-row/lay/index.js": `const pid: string = process.pid;\n` + typed,
  };
  const shipsTheSame = {
    "node_modules/each-row/package.json": JSON.stringify({
      name: "each-row",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", "full-types": "./index.full.ts", default: "./index.js" } },
    }),
    "node_modules/each-row/index.js": readsProcess["node_modules/each-row/index.js"],
    "node_modules/each-row/index.full.ts": readsProcess[".full-types/each-row/lay/index.js"],
  };
  const places: [title: string, files: Files, folder: string][] = [
    ["in the project", { ...kit(".full-types/each-row"), ...readsProcess }, ".full-types/each-row"],
    ["in the package", shipsTheSame, "node_modules/each-row"],
  ];

  test.each(places)(
    "what Bun provides has its types where @types/bun is installed, and is any where it is not: full types %s",
    (_, files, folder) =>
      slot(async () => {
        using without = tempDir("full-types-options", { ...installed, ...files });
        expect(await compile(String(without))).toEqual(said([], [used(folder), summary(1, 1)], printed));
        using dir = tempDirWithBunTypes("full-types-options", { ...installed, ...files });
        const { warnings, notes, stdout } = await compile(String(dir));
        expect({ warnings: warnings.map(warning => warning.slice(0, 42)), count: notes.at(-1), stdout }).toEqual({
          warnings: ["TS100009: 'each-row' has 1 type error (the"],
          count: summary(1, 0),
          stdout: printed,
        });
      }),
    600_000,
  );

  test(
    "and under the compilerOptions of full-types.json",
    () =>
      slot(async () => {
        const stated = kit(".full-types/each-row", { compilerOptions: { lib: ["esnext"] } });
        using dir = tempDir("full-types-options", { ...installed, ...stated, ...hasDocument(false) });
        expect(await compile(String(dir))).toEqual(said([], [used(".full-types/each-row"), summary(1, 1)], printed));
      }),
    600_000,
  );

  test(
    "a folder named full-types that holds something else is nobody's mistake",
    () =>
      slot(async () => {
        using dir = tempDir("no-full-types", { ...installed, "full-types/notes/readme.md": "# Notes\n" });
        expect(await compile(String(dir))).toEqual(said([], [], printed));
      }),
    600_000,
  );

  test(
    "full types of a file that the program does not load are nobody's mistake",
    () =>
      slot(async () => {
        const files = {
          ...installed,
          "node_modules/each-row/other.js": `export const other = 1;\n`,
          ".full-types/each-row/full-types.json": manifest({ lay: { "other.js": "" } }),
          ".full-types/each-row/lay/other.js": `export const other: number = 1;\n`,
        };
        using dir = tempDir("no-full-types", files);
        expect(await compile(String(dir))).toEqual(said([], [], printed));
      }),
    600_000,
  );

  test(
    "full types that the full types of an imported package need are nobody's mistake",
    () =>
      slot(async () => {
        const files = {
          ...installed,
          ...kit(".full-types/each-row", { needs: ["every-row"] }),
          ...kit(".full-types/every-row", { name: "every-row" }),
          "node_modules/every-row/package.json": JSON.stringify({
            name: "every-row",
            version: "1.0.0",
            main: "index.js",
          }),
          "node_modules/every-row/index.js": installed["node_modules/each-row/index.js"],
        };
        using dir = tempDir("full-types-used", files);
        expect(await compile(String(dir))).toEqual(said([], [used(".full-types/each-row"), summary(1, 1)], printed));
      }),
    600_000,
  );

  test(
    "installed full types of a package that the program never imports are nobody's mistake",
    () =>
      slot(async () => {
        const files = { ...installed, ...kit("node_modules/@oven/full-types-every-row", { name: "every-row" }) };
        using dir = tempDir("no-full-types", files);
        expect(await compile(String(dir))).toEqual(said([], [], printed));
      }),
    600_000,
  );

  const under = (folder: string, files: Files): Files =>
    Object.fromEntries(Object.entries(files).map(([path, text]) => [`${folder}/${path}`, text]));

  test(
    ".full-types beside the entry point, and the build runs from above",
    () =>
      slot(async () => {
        using dir = tempDir(
          "full-types-elsewhere",
          under("packages/app", { ...installed, ...kit(".full-types/each-row") }),
        );
        const root = realpathSync(String(dir));
        const reason = `full types go in the .full-types of the directory that the build runs from, ${slashed(root)}`;
        expect(await compile(root, "./packages/app/app.ts")).toEqual(
          said([unread("packages/app/.full-types", reason)], [], printed),
        );
      }),
    600_000,
  );

  test(
    ".full-types above the directory that the build runs from",
    () =>
      slot(async () => {
        using dir = tempDir("full-types-elsewhere", {
          ...under("packages/app", installed),
          ...kit(".full-types/each-row"),
        });
        const root = realpathSync(String(dir));
        const app = join(root, "packages", "app");
        const reason = `full types go in the .full-types of the directory that the build runs from, ${slashed(app)}`;
        expect(await compile(app)).toEqual(said([unread(slashed(join(root, ".full-types")), reason)], [], printed));
      }),
    600_000,
  );

  test(
    "the last note counts the packages that have full types and those that are compiled from them",
    () =>
      slot(async () => {
        const files = {
          ...installed,
          ...kit(".full-types/each-row"),
          ...kit(".full-types/every-row", { name: "every-row" }),
          "app.ts": `import { eachRow } from "each-row";\nimport { one } from "one";\neachRow([{ id: one }, { id: 2 }], row => console.log(row.id));\n`,
          "node_modules/one/package.json": JSON.stringify({
            name: "one",
            version: "1.0.0",
            type: "module",
            main: "index.js",
          }),
          "node_modules/one/index.js": `export const one = 1;\n`,
          "node_modules/one/index.full.ts": `export const one: number = 1;\n`,
        };
        using dir = tempDir("full-types-counted", files);
        const { warnings, notes, stdout } = await compile(String(dir));
        expect({ warnings: warnings.length, notes, stdout }).toEqual({
          warnings: 2,
          notes: [used(".full-types/each-row"), summary(3, 1)],
          stdout: printed,
        });
      }),
    600_000,
  );
});
