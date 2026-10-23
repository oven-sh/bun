import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// `bun test` hands a test file `test`, `expect`, `describe` and the hooks without an import. `bun test --aot` type checks the file with their declarations, whether or not a package of types is installed.
test("a test file that imports nothing and has no types installed", async () => {
  using dir = tempDir("run-aot-test-runner-globals", {
    "tsconfig.json": `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "typeRoots": ["./no-types-here"] } }`,
    "globals.test.ts": `
      class Point { constructor(public x: number, public y: number) {} }
      let ready = false;
      beforeAll(() => { ready = true; });
      afterEach(() => {});
      test("a test", () => { expect(new Point(1, 2).x).toBe(1); expect(ready).toBe(true); });
      describe("a group", () => { it("has a test", () => { expect(jest.fn()).not.toHaveBeenCalled(); }); });`,
    "jest.test.ts": `
      import { expect, test } from "@jest/globals";
      test("by the name of another runner", () => { expect(1 + 1).toBe(2); });`,
    "own.test.ts": `
      import { expect, mock, spyOn, test } from "bun:test";
      test("by its own name", () => {
        const f = mock((n: number) => n + 1);
        expect(f(1)).toBe(2);
        expect(f).toHaveBeenCalledTimes(1);
        const o = { m() { return 1; } };
        spyOn(o, "m").mockReturnValue(2);
        expect(o.m()).toBe(2);
      });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("TS2");
  expect(stderr).toContain(" 4 pass");
  expect(exitCode).toBe(0);
});
