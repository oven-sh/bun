import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `mock.module("./data.json", () => ({ name: "mock" })); require("./data.json")`: what stands in the place of the file is a module like any other,
// so the first require() behind the mock gets its namespace object. A compiled run answered as for the file itself, with the default export: undefined here.
const files: Record<string, string> = {
  "data.json": `{ "value": 1, "name": "file" }`,
  "members.json": `{ "value": 1, "name": "file" }`,
  "with-default.json": `{ "value": 1 }`,
  "marked.json": `{ "value": 1 }`,
  "first.json": `{ "value": 1, "name": "file" }`,
  "data.toml": `a = "file"\n`,
  "data.yaml": `a: file\n`,
  "data.txt": `file`,
  "marked.mjs": `export const name = "file"; export default { name: "the default of the file" };`,
  "code.mjs": `export const name = "file"; export default { name: "the default of the file" };`,
  "code.cjs": `module.exports = { name: "file" };`,
  "reader.cjs": `module.exports = () => require("./data.json");`,
  "a.test.js": `const { test, mock } = require("bun:test");
const say = (...words) => console.log("SEEN", ...words);
const shown = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
function ask() { return require("./members.json"); }
test("the first require() behind a mock", () => {
  const made = { name: "mock" };
  mock.module("./data.json", () => made);
  say("names alone:", shown(require("./data.json")), require("./data.json") === made, require("./data.json") === require("./data.json"));
  say("from another file:", shown(require("./reader.cjs")()), require("./reader.cjs")() === require("./data.json"));
  mock.module("./members.json", () => ({ name: "mock", value: 2 }));
  const { name, value } = require("./members.json");
  say("members:", require("./members.json").name, ask().value, name, value, Object.keys(ask()).join(), "default" in ask());
  mock.module("./with-default.json", () => ({ default: { value: "mock" } }));
  say("a default alone:", shown(require("./with-default.json")), require("./with-default.json").default.value);
  mock.module("./marked.json", () => ({ __esModule: true, default: { value: "mock" } }));
  say("marked as an ES module:", shown(require("./marked.json")), require("./marked.json") === require("./marked.json"));
  mock.module("./marked.mjs", () => ({ __esModule: true, default: { value: "mock" }, name: "mock" }));
  say("an ES module marked so:", shown(require("./marked.mjs")));
  mock.module("./data.toml", () => ({ default: { a: "mock" }, a: "mock" }));
  say("toml:", shown(require("./data.toml")));
  mock.module("./data.yaml", () => ({ a: "mock" }));
  say("yaml:", shown(require("./data.yaml")));
  mock.module("./data.txt", () => ({ default: "mock" }));
  say("text:", shown(require("./data.txt")));
  mock.module("./code.mjs", () => ({ name: "mock" }));
  say("an ES module:", shown(require("./code.mjs")));
  mock.module("./code.cjs", () => ({ name: "mock" }));
  say("a CommonJS file:", shown(require("./code.cjs")));
  const first = require("./first.json");
  const later = { name: "mock" };
  mock.module("./first.json", () => later);
  say("required in front of the mock:", shown(first), shown(require("./first.json")), require("./first.json") === later);
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["at default flags", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const) {
  test(`require() answers as under plain bun test, ${way}`, async () => {
    using dir = tempDir("aot-first-require-behind-a-mock-of-a-data-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout[0]).toBe(`SEEN names alone: {"name":"mock"} [object Module] false true`);
    expect(plain.stdout.length).toBe(12);
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
