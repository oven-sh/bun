import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true } }`,
  "preload.ts": `import { add } from "./src/math";
(globalThis as any).addOfPreload = add;
`,
  "src/math.ts": `export function add(a: number, b: number): number { return a + b; }
export function twice(n: number): number { return add(n, n); }
`,
  "src/user.ts": `import { add } from "./math";
import { setting } from "./setting";
export function viaUser(a: number, b: number): number { return add(a, b); }
export function settingOfUser(): string { return setting(); }
`,
  "src/setting.ts": `export function setting(): string { return "real"; }`,
  "src/computed.ts": `import { add } from "./math";
export const addSeen = add;
`,
  "tests/identity.test.ts": `import { expect, test } from "bun:test";
import { join } from "node:path";
import { add } from "../src/math";
test("the same instance as the preload", () => {
  expect(add).toBe((globalThis as any).addOfPreload);
});
test("a source file that no scan finds", async () => {
  const it = await import(join(import.meta.dir, "../src", ["comp", "uted"].join("") + ".ts"));
  expect(it.addSeen).toBe(add);
});
`,
  "tests/spy.test.ts": `import { expect, spyOn, test } from "bun:test";
import * as math from "../src/math";
import { viaUser } from "../src/user";
test("a spy reaches the importer and the module itself", () => {
  const spy = spyOn(math, "add").mockImplementation((a, b) => a * b);
  expect(viaUser(3, 4)).toBe(12);
  expect(math.twice(5)).toBe(25);
  spy.mockRestore();
  expect(viaUser(3, 4)).toBe(7);
});
`,
  "tests/mock.test.ts": `import { expect, mock, test } from "bun:test";
import { settingOfUser } from "../src/user";
test("a mock reaches the importer", () => {
  expect(settingOfUser()).toBe("real");
  mock.module("../src/setting", () => ({ setting: () => "mocked" }));
  expect(settingOfUser()).toBe("mocked");
  mock.module("../src/setting", () => ({ setting: () => "real" }));
});
`,
  "tests/syntax.test.ts": `import { expect, test } from "bun:test";
function mark(_: unknown, __: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = () => "marked " + original();
}
class Thing {
  @mark static label() {
    return "thing";
  }
}
test("the settings of tsconfig.json", () => {
  expect(Thing.label()).toBe("marked thing");
});
`,
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", ...flags, "./tests"],
    directory,
    { ...bunEnv, ...env },
  );
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { results: results.sort(), exitCode };
}

test.each([[], ["--isolate"]])(
  "test files run from disk against one compiled program %p",
  async (...flags: string[]) => {
    using dir = tempDir("aot-test-files-from-disk", files);
    const plain = await runTests(String(dir), {}, ...flags);
    expect(plain.results.length).toBe(5);
    expect(plain.exitCode).toBe(0);
    const fromDisk = { BUN_AOT_TEST_FILES_FROM_DISK: "1" };
    expect(await runTests(String(dir), fromDisk, "--aot", ...flags)).toEqual(plain);
    const named = { ...fromDisk, BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };
    expect(await runTests(String(dir), named, "--aot", ...flags)).toEqual(plain);
  },
  60_000,
);
