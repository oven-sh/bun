import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Row 4298. "vitest" has `vi` under the name `vitest` too.
async function printedBy(files: Record<string, string>, ...flags: string[]) {
  using directory = tempDir("aot-vitest-mock", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(directory), bunEnv);
  const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("> "));
  return { lines, exitCode };
}

const modules = {
  "mod.js": `globalThis.loads = (globalThis.loads ?? 0) + 1; export const value = "real";`,
  "side.js": `import { value } from "./mod.js"; export const captured = value;`,
};

describe.concurrent("vitest, the other name of vi", () => {
  test.each([
    [`imported`, `import { vitest } from "vitest";`, []],
    [`the global`, ``, ["--globals=vitest"]],
  ] as const)("mock() and hoisted() go above the imports: %s", async (_, header, flags) => {
    const files = {
      ...modules,
      "a.test.js": `
        ${header}
        import { captured } from "./side.js";
        const hoisted = vitest.hoisted(() => ({ value: "mocked" }));
        vitest.mock("./mod.js", () => hoisted);
        test("one", () => console.log(">", globalThis.loads ?? 0, captured));
      `,
    };
    const plain = await printedBy(files, ...flags);
    expect(plain).toEqual({ lines: ["> 0 mocked"], exitCode: 0 });
    expect(await printedBy(files, ...flags, "--aot")).toEqual(plain);
    // The layer that holds the module is built without the test files.
    const inParts = ["--aot", "--parallel=2", "--aot-memory-limit=1KB"];
    expect(await printedBy({ ...files, "b.test.js": `test("two", () => {});` }, ...flags, ...inParts)).toEqual(plain);
  });

  test("doMock() and importActual()", async () => {
    const files = {
      ...modules,
      "a.test.js": `
        import { vitest, test } from "vitest";
        test("one", async () => {
          vitest.doMock("./mod.js", () => ({ value: "mocked" }));
          console.log(">", (await import("./mod.js")).value, (await vitest.importActual("./mod.js")).value);
        });
      `,
    };
    const plain = await printedBy(files);
    expect(plain).toEqual({ lines: ["> mocked real"], exitCode: 0 });
    expect(await printedBy(files, "--aot")).toEqual(plain);
  });
});
