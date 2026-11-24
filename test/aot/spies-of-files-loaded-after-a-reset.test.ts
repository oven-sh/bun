import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const esModule = `globalThis.runs = (globalThis.runs ?? 0) + 1;
let calls = 0;
export function count() {
  return ++calls;
}
export function read() {
  return calls;
}`;
const commonJS = `globalThis.runs = (globalThis.runs ?? 0) + 1;
let calls = 0;
exports.count = () => ++calls;
exports.read = () => calls;`;
const loads = {
  "import()": (name: string) => `await import("${name}")`,
  "require()": (name: string) => `require("${name}")`,
};
const programs: [string, string, string, string, string][] = [];
for (const [name, text, titles] of [
  ["./counter.mjs", esModule, ["import()", "require()"]],
  ["./counter.cjs", commonJS, ["import()"]],
] as const) {
  for (const call of ["vi.mock", "jest.mock"]) {
    for (const title of titles)
      programs.push([`${call}() over ${name} that ${title} loaded`, name, text, call, loads[title](name)]);
  }
}

test.each(programs)("%s again after a reset spies on that run", async (_, name, text, call, load) => {
  using directory = tempDir("spies-of-files-loaded-after-a-reset", {
    "package.json": `{ "name": "p" }`,
    [name]: text,
    "a.test.mjs": `import { test } from "bun:test";
import { count } from "${name}";
test("t", () => console.log("SAID first", count()));`,
    "b.test.mjs": `import { jest, test, vi } from "bun:test";
test("t", async () => {
  jest.resetModules();
  const loaded = ${load};
  ${call}("${name}", { spy: true });
  console.log("SAID spied", vi.isMockFunction(loaded.count), loaded.count(), loaded.read(), globalThis.runs);
});`,
  });
  const files = ["./a.test.mjs", "./b.test.mjs"];
  const plain = await run([bunExe(), "test", ...files], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...files], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(["SAID first 1", "SAID spied true 1 1 2"]);
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(stdout + stderr).toContain(" 0 fail");
});
