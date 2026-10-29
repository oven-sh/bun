// A test file that imports only a type from the test package still gets `describe`, `it` and `expect` as globals: TypeScript erases the import.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const files = {
  "imports-a-type.test.ts": `
import type { Mock } from "bun:test";
let unused: Mock<() => void> | undefined;
describe("a file that imports only a type", () => {
  it("runs", () => { expect(unused).toBe(undefined); });
});
`,
  "exports-a-type.test.ts": `
export type { Mock } from "bun:test";
describe("a file that exports only a type", () => {
  it("runs", () => { expect(1 + 2).toBe(3); });
});
`,
  "names-a-type-by-import.test.ts": `
let unused: import("bun:test").Mock<() => void> | undefined;
describe("a file that names a type by import()", () => {
  it("runs", () => { expect(unused).toBe(undefined); });
});
`,
};

describe("test globals beside an import that TypeScript erases", () => {
  for (const mode of [[], ["--aot"], ["--debug-aot"]]) {
    for (const file of Object.keys(files)) {
      test(
        `bun test ${mode.join(" ")} ${file}`.replace("  ", " "),
        async () => {
          using dir = tempDir("aot-test-globals", files);
          const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...mode, "./" + file], String(dir));
          expect(stdout + stderr).not.toContain("is not defined");
          expect(stdout + stderr).toContain(" 1 pass");
          expect(exitCode).toBe(0);
        },
        120_000,
      );
    }
  }
});
