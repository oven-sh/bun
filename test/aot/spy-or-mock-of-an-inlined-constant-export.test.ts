import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const moduleText = `export const value = 1;
export const label = "text";
export const flag = true;
export const sum = 1 + 2;
export let changing = 2;
export function exported() { return "real"; }
export const declaredLater = 7;
export const readConstants = () => [value, label, flag, sum, typeof value].join();
export const readChanging = () => changing;
export const readDeclaredLater = () => declaredLater;
export const callExported = () => exported();
`;

const helpers = `const show = value => (typeof value === "function" ? "function" : String(value));
const names = ["value", "label", "flag", "sum", "changing", "declaredLater"];
const state = (ns, held) =>
  [names.map(name => show(ns[name])).join(), held.readConstants(), show(held.readChanging()), show(held.readDeclaredLater()), held.callExported()].join(" | ");
`;

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/spied.mjs": moduleText,
  "src/left-out.mjs": moduleText,
  "src/named.mjs": moduleText,
  "src/importer.mjs": `import { value, label } from "./named.mjs"; export const readImported = () => [value, label].join();
`,
  "spy.test.mjs": `import { test, spyOn } from "bun:test";
${helpers}
test("a spy alone", async () => {
  const ns = await import("./src/spied.mjs");
  const held = { ...ns };
  console.log("before:", state(ns, held));
  const spies = names.map(name => spyOn(ns, name));
  console.log("spied:", state(ns, held));
  for (const spy of spies) spy.mockRestore();
  console.log("restored:", state(ns, held));
});
`,
  "left-out.test.mjs": `import { test, spyOn, mock } from "bun:test";
${helpers}
test("a spy behind a mock that leaves the names out", async () => {
  const ns = await import("./src/left-out.mjs");
  const held = { ...ns };
  mock.module("./src/left-out.mjs", () => ({ exported: () => "mocked" }));
  console.log("mocked without the names:", state(ns, held));
  const spies = names.map(name => spyOn(ns, name));
  console.log("spied behind the mock:", state(ns, held));
  for (const spy of spies) spy.mockRestore();
  console.log("restored behind the mock:", state(ns, held));
});
`,
  "named.test.mjs": `import { test, mock } from "bun:test";
${helpers}
test("a mock that names them", async () => {
  const ns = await import("./src/named.mjs");
  const { readImported } = await import("./src/importer.mjs");
  const held = { ...ns };
  mock.module("./src/named.mjs", () => ({ value: 10, label: "mocked", flag: false, sum: 30, changing: 20, declaredLater: 70 }));
  console.log("mocked with the names:", state(ns, held), "|", readImported());
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a file's own reads of a constant that bun run inlines keep its value under a spy or a mock, ${way}`, async () => {
    using dir = tempDir("aot-spy-or-mock-of-an-inlined-constant", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain(
      "spied: function,function,function,function,function,function | 1,text,true,3,number | function | function | real",
    );
    expect(plain.stdout).toContain(
      "spied behind the mock: function,function,function,function,function,function | 1,text,true,3,number | function | function | mocked",
    );
    expect(plain.stdout).toContain(
      "mocked with the names: 10,mocked,false,30,20,70 | 1,text,true,3,number | 20 | 70 | real | 10,mocked",
    );
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
