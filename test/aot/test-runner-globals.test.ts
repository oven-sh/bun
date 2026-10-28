import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = (types: string[]) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      skipLibCheck: true,
      types,
    },
  });

const vitest = {
  "node_modules/vitest/package.json": JSON.stringify({
    name: "vitest",
    version: "9.9.9",
    type: "module",
    exports: { ".": { types: "./index.d.ts" }, "./globals": { types: "./globals.d.ts" } },
  }),
  "node_modules/vitest/index.d.ts": `
    export declare const vi: { stubGlobal(name: string, value: unknown): void; fn(): () => void };
    export declare function test(name: string, run: () => void): void;
    export declare const it: typeof test;
    export declare const describe: { (name: string, run: () => void): void; runIf(condition: unknown): (name: string, run: () => void) => void };
    export declare function expect(value: unknown): { toBe(expected: unknown): void; toThrow(expected?: unknown): void };
  `,
  "node_modules/vitest/globals.d.ts": `
    declare global {
      const vi: typeof import("vitest").vi;
      const test: typeof import("vitest").test;
      const it: typeof import("vitest").it;
      const describe: typeof import("vitest").describe;
      const expect: typeof import("vitest").expect;
    }
    export {};
  `,
};

const usesWhatBunLacks = `
  export {};
  const text: string | number = "a";
  test("passes", () => { expect(text).toBe("a"); expect(1 as number).toBe(1 as unknown); });
  test("calls what bun test does not have", () => { vi.stubGlobal("name", 1); });
`;

async function run(dir: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "test", "--aot", ...args], dir);
  return { said: stdout + stderr, exitCode };
}

test.each([
  ["the tsconfig names vitest/globals", ["vitest/globals"]],
  ["nothing declares the globals, and vitest is installed", []],
])("%s: a member that bun test lacks fails its own test, not the file", async (_, types) => {
  using dir = tempDir("aot-test-runner-globals", {
    ...vitest,
    "tsconfig.json": tsconfig(types),
    "a.test.ts": usesWhatBunLacks,
  });
  const { said, exitCode } = await run(String(dir));
  expect(said).not.toContain("error: TS");
  expect(said).not.toContain("does not run this file");
  expect(said).toContain("(pass) passes");
  expect(said).toContain("(fail) calls what bun test does not have");
  expect(said).toMatch(/\b1 pass\b/);
  expect(said).toMatch(/\b1 fail\b/);
  expect(exitCode).toBe(1);
});

// TODO: without @types/bun the runner's globals are `any` today. Errors that are expected here are not reported; nothing valid is refused.
test.todo("the installed runner's types are held to: a wrong argument is still a type error", async () => {
  using dir = tempDir("aot-test-runner-globals", {
    ...vitest,
    "tsconfig.json": tsconfig([]),
    "a.test.ts": `export {}; test("never run", () => { vi.stubGlobal(1, 1); });`,
  });
  const { said, exitCode } = await run(String(dir));
  expect(said).toMatch(/error: TS2345: .*\n\s+at .*a\.test\.ts:1:\d+/);
  expect(said).not.toContain("never run");
  expect(exitCode).toBe(1);
});

// TODO: as above.
test.todo("with no runner installed the globals have Bun's declarations", async () => {
  using dir = tempDir("aot-test-runner-globals", {
    "tsconfig.json": tsconfig([]),
    "a-fine.test.ts": `export {}; const spy = vi.fn((n: number) => n + 1); describe("group", () => { it("passes", () => { expect(spy(1)).toBe(2); expect(jest.fn).toBeFunction(); }); });`,
    "b-wrong.test.ts": `export {}; test("never run", () => { vi.stubGlobal("name", 1); });`,
  });
  const { said, exitCode } = await run(String(dir));
  expect(said).toContain("(pass) group > passes");
  expect(said).toMatch(/error: TS2339: .*\n\s+at .*b-wrong\.test\.ts:1:\d+/);
  expect(said).not.toContain("never run");
  expect(exitCode).toBe(1);
});

test("a global of the program's own that is named like the runner's keeps its type", async () => {
  using dir = tempDir("aot-test-runner-globals", {
    "tsconfig.json": tsconfig([]),
    "globals.d.ts": `declare var vi: { answer: number };`,
    "a.test.ts": `/// <reference path="./globals.d.ts" />\nexport {}; test("never run", () => { const n: string = vi.answer; });`,
  });
  const { said, exitCode } = await run(String(dir));
  expect(said).toMatch(/error: TS2322: .*\n\s+at .*a\.test\.ts:2:\d+/);
  expect(exitCode).toBe(1);
});
