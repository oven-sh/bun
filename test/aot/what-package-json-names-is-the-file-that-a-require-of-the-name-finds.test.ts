// What package.json names as a way into the project is a file of the product: a store to a built-in in it throws under `bun test --aot` as in the executable. The name was
// compared with the path of the file as it stood, so only a name with its ending made the file the product's: a store in the entry point of `"main": "./src/main"` passed in
// a green run, and no line said so. Now the name is also the file that a `require` of its path finds: the ending may be left out, the name may be a folder, a link, or the
// name that a build of the product gives the file. A package.json that names nothing names `index.js`, and in the folder where the run is started the index files that
// `bun compile` takes for the entry point there.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const stores = `export function patch() { Buffer.isEncoding = () => true; return "stored"; }\n`;
const named: {
  title: string;
  fields: string;
  entry: string;
  beside?: Record<string, string>;
  /** The project lies in the folder where the run is started, and not in a folder of its own below it. */
  startedHere?: true;
  said: "TypeError" | "stored";
}[] = [
  { title: "main with its ending", fields: `, "main": "./src/main.ts"`, entry: "src/main.ts", said: "TypeError" },
  { title: "main without its ending", fields: `, "main": "./src/main"`, entry: "src/main.ts", said: "TypeError" },
  {
    title: "main without its ending and without ./",
    fields: `, "main": "src/main"`,
    entry: "src/main.ts",
    said: "TypeError",
  },
  { title: "main as CommonJS names an index file", fields: `, "main": "index"`, entry: "index.ts", said: "TypeError" },
  {
    title: "main under the ending that a build gives the file",
    fields: `, "main": "./src/main.js"`,
    entry: "src/main.ts",
    said: "TypeError",
  },
  { title: "main as a folder", fields: `, "main": "./src"`, entry: "src/index.ts", said: "TypeError" },
  {
    title: "main without its ending, beside the built file",
    fields: `, "main": "./src/main"`,
    entry: "src/main.ts",
    beside: { "src/main.js": `export function patch() { return "the built file"; }\n` },
    said: "TypeError",
  },
  { title: "module without its ending", fields: `, "module": "./src/main"`, entry: "src/main.ts", said: "TypeError" },
  {
    title: "bin as a link to the file",
    fields: `, "bin": { "tool": "./bin/tool.ts" }`,
    entry: "src/main.ts",
    said: "TypeError",
  },
  {
    title: "no name, beside index.ts, where the run is started",
    fields: ``,
    entry: "index.ts",
    startedHere: true,
    said: "TypeError",
  },
  { title: "no name, beside index.ts, in a folder below", fields: ``, entry: "index.ts", said: "stored" },
  {
    title: "no name, index.js beside index.cjs",
    fields: ``,
    entry: "index.js",
    beside: { "index.cjs": `exports.patch = () => "the other index";\n` },
    said: "TypeError",
  },
  { title: "no name, and only the tests come to the file", fields: ``, entry: "src/main.ts", said: "stored" },
  { title: "a main that names another file", fields: `, "main": "./src/other"`, entry: "src/main.ts", said: "stored" },
  {
    title: "a main that names a file which is not built",
    fields: `, "main": "./dist/index.js"`,
    entry: "index.ts",
    said: "stored",
  },
];

// One run for all: each folder is a project of its own, with its package.json above its test file, and one project lies where the run is started. `--main-fields`
// says which fields the runtime reads, and changes nothing about what package.json names.
test("a file that package.json names, however it spells the name, stores to no built-in", async () => {
  const rows = named.filter(({ fields }) => !isWindows || !fields.includes(`"bin"`));
  const folderOf = (index: number) => (rows[index].startedHere ? "" : `p${index}/`);
  const files: Record<string, string> = {};
  for (const [index, { fields, entry, beside }] of rows.entries()) {
    const folder = folderOf(index);
    files[`${folder}package.json`] = `{ "name": "made-up-${index}"${fields} }`;
    files[`${folder}${entry}`] = stores;
    files[`${folder}src/other.ts`] = `export {};\n`;
    for (const [name, text] of Object.entries(beside ?? {})) files[`${folder}${name}`] = text;
    files[`${folder}tests/one.test.ts`] = `
import { test } from "bun:test";
import { patch } from "../${entry.endsWith(".ts") ? entry.slice(0, -".ts".length) : entry}";
test("patches", () => {
  let said: string;
  try { said = patch(); } catch (error) { said = (error as Error).name; }
  console.log("SAID ${index}", said);
});`;
  }
  using dir = tempDir("aot-named-by-package-json", files);
  for (const [index, { fields, entry }] of rows.entries())
    if (fields.includes(`"bin"`)) {
      mkdirSync(join(String(dir), folderOf(index), "bin"));
      symlinkSync(join("..", entry), join(String(dir), folderOf(index), "bin", "tool.ts"));
    }
  for (const flags of [[], ["--main-fields=module"]]) {
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...flags],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    const said = out.split("\n").filter(line => line.startsWith("SAID"));
    const listed = err.split("\n").filter(line => line.includes("Cannot assign to Buffer.isEncoding, at "));
    const isListed = (index: number) =>
      listed.some(line => line.includes(` at ${folderOf(index)}${rows[index].entry}:`));
    if (exitCode !== 0) console.error(err);
    expect({
      flags,
      answers: rows.map(({ title }, index) => [
        title,
        said.find(line => line.startsWith(`SAID ${index} `)),
        isListed(index),
      ]),
      listed: listed.length,
      exitCode,
    }).toEqual({
      flags,
      answers: rows.map(({ title, said }, index) => [title, `SAID ${index} ${said}`, said === "TypeError"]),
      listed: rows.filter(({ said }) => said === "TypeError").length,
      exitCode: 0,
    });
  }
});

// A run of one test file does not load the entry point that another test file imports. The name is then found on disk. So a file that the entry point imports is the
// product's alone and beside that test file.
test("a file that the named entry point imports stores to no built-in, alone and beside a test file that imports the entry point", async () => {
  const spellings = ["src/main.js", "./src/main", "./src/"];
  const files: Record<string, string> = {};
  for (const [index, main] of spellings.entries()) {
    const entry = main.endsWith("/") ? "index" : "main";
    files[`p${index}/package.json`] = `{ "name": "made-up-${index}", "main": "${main}" }`;
    files[`p${index}/src/${entry}.js`] = `import { patch } from "./patch.js";\nexport const keep = patch;\n`;
    files[`p${index}/src/patch.js`] = `export function patch(holder, name, value) { holder[name] = value; }\n`;
    files[`p${index}/a.test.js`] = `
import { test } from "bun:test";
import { patch } from "./src/patch.js";
test("a", () => {
  let said;
  try { patch(Object.getPrototypeOf([]), "push", () => 7); said = "stored"; } catch (error) { said = error.name; }
  console.log("SAID ${index}", said);
});`;
    files[`p${index}/b.test.js`] =
      `import { test } from "bun:test";\nimport "./src/${entry}.js";\ntest("b", () => {});\n`;
  }
  using dir = tempDir("aot-named-by-package-json-in-company", files);
  const said = async (...files: string[]) => {
    await using child = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...files],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (exitCode !== 0) console.error(err);
    return {
      said: out
        .split("\n")
        .filter(line => line.startsWith("SAID"))
        .sort(),
      exitCode,
    };
  };
  const alone = await said(...spellings.map((_, index) => `./p${index}/a.test.js`));
  expect(alone).toEqual({ said: spellings.map((_, index) => `SAID ${index} TypeError`), exitCode: 0 });
  expect(await said()).toEqual(alone);
});
