import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const body = `globalThis.runs = (globalThis.runs ?? 0) + 1;
await Promise.resolve();
class Database {
  query(sql) {
    return "rows of " + sql;
  }
}
let calls = 0;
export const db = new Database();
export function count() {
  return ++calls;
}`;
const show = `const show = (label, { db, count }) =>
  console.log("SAID", label, vi.isMockFunction(db.query), db.query("a"), vi.isMockFunction(count), count(), globalThis.runs);`;
const start = `import { jest, test, vi } from "bun:test";\n${show}\n`;
const loadsFirst = (name: string) =>
  `import { count } from "${name}";\n${start}test("t", () => console.log("SAID first", count()));`;
const resets = `${start}test("t", () => {\n  jest.resetModules();\n});`;
const file = { "lib.mjs": body };
const library = {
  "node_modules/lib/package.json": `{ "name": "lib", "type": "module", "main": "index.js" }`,
  "node_modules/lib/index.js": body,
};

const programs: [string, Record<string, string>, string, string[]][] = [];
for (const [kind, files, name] of [
  ["a file", file, "./lib.mjs"],
  ["a package", library, "lib"],
] as const) {
  for (const call of ["vi.mock", "vi.doMock", "jest.mock"]) {
    programs.push([
      `${call}() of ${kind} that nothing has loaded, then require()`,
      {
        ...files,
        "a.test.mjs": `${start}test("t", () => {\n  ${call}("${name}", { spy: true });\n  show("required", require("${name}"));\n});`,
      },
      "./a.test.mjs",
      ["SAID required true rows of a true 1 1"],
    ]);
  }
  programs.push([
    `an automock of ${kind} that nothing has loaded, then require()`,
    {
      ...files,
      "a.test.mjs": `${start}test("t", () => {\n  vi.mock("${name}");\n  show("required", require("${name}"));\n});`,
    },
    "./a.test.mjs",
    ["SAID required true undefined true undefined 1"],
  ]);
  const imports = (call: string) =>
    `${start}test("t", async () => {\n  ${call}("${name}", { spy: true });\n  show("imported", await import("${name}"));\n});`;
  const expected = ["SAID first 1", "SAID imported true rows of a true 1 2"];
  programs.push(
    [
      `vi.doMock() of ${kind} that an earlier test file loaded`,
      { ...files, "a.test.mjs": loadsFirst(name), "b.test.mjs": imports("vi.doMock") },
      "./a.test.mjs ./b.test.mjs",
      expected,
    ],
    [
      `vi.doMock() of ${kind} that an earlier test file loaded, where a later one resets modules`,
      { ...files, "a.test.mjs": loadsFirst(name), "b.test.mjs": imports("vi.doMock"), "c.test.mjs": resets },
      "./a.test.mjs ./b.test.mjs ./c.test.mjs",
      expected,
    ],
  );
}
programs.push([
  "vi.mock() of a package that an earlier test file loaded",
  {
    ...library,
    "a.test.mjs": loadsFirst("lib"),
    "b.test.mjs": `${start}test("t", async () => {\n  vi.mock("lib", { spy: true });\n  show("imported", await import("lib"));\n});`,
  },
  "./a.test.mjs ./b.test.mjs",
  ["SAID first 1", "SAID imported true rows of a true 1 2"],
]);

test.each(programs)("%s: the original of a spy or automock with top-level await", async (_, files, args, expected) => {
  using directory = tempDir("spies-of-files-with-top-level-await", { "package.json": `{ "name": "p" }`, ...files });
  const plain = await run([bunExe(), "test", ...args.split(" ")], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...args.split(" ")], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(expected);
  expect(said(stdout)).toEqual(expected);
  expect(stdout + stderr).toContain(" 0 fail");
});
