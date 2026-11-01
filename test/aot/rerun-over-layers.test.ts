// `require()` runs a CommonJS file again whose last run threw. A test file makes such a file throw (the factory of a mock that it requires throws) and catches that; the next test file
// requires the same file and gets what it exports. Over layers the file lies in a program below the one that requires it, and only a file of the runner's own stands there for the
// test files: what that file loads counts as loaded where somebody catches, however it is written.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.mjs": `export const value = "real";`,
  "user.cjs": `const lib = require("./lib.mjs"); exports.read = () => lib.value;`,
  "a.test.mjs": `import { test, mock, beforeAll } from "bun:test";
beforeAll(() => { mock.module("./lib.mjs", () => { throw new Error("thrown by the factory"); }); });
test("the first file", () => {
  try { console.log("| first:", import.meta.require("./user.cjs").read()); } catch (error) { console.log("| first failed:", error.message); }
  mock.restore();
});`,
  "z.test.mjs": `import { test } from "bun:test";
test("the next file", () => {
  try { console.log("| next:", import.meta.require("./user.cjs").read()); } catch (error) { console.log("| next failed:", error.message); }
});`,
};

const printed = ({ stdout, exitCode }: { stdout: string; exitCode: number | null }) => ({
  lines: stdout.split("\n").filter(line => line.startsWith("| ")),
  exitCode,
});

for (const words of [undefined, "TestRunLayers:2", "TestRunLayers:3"]) {
  test.concurrent(`the next test file runs the file again, ${words ?? "one program"}`, async () => {
    using dir = tempDir("rerun-over-layers", files);
    const plain = printed(await run([bunExe(), "test"], String(dir), bunEnv));
    expect(plain.lines).toEqual(["| first failed: thrown by the factory", "| next: real"]);
    expect(
      printed(
        await run(
          [bunExe(), "test", "--aot"],
          String(dir),
          words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv,
        ),
      ),
    ).toEqual(plain);
  });
}
