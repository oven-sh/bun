import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

test.skipIf(!isLinux)(
  "no memory is writable and executable, however hot an expression built at run time is",
  async () => {
    using dir = tempDir("aot-regexp-jit-memory", {
      "main.js": `
import { readFileSync } from "fs";
function writableAndExecutableMappings() {
  return readFileSync("/proc/self/maps", "utf8").split("\\n").filter(line => /^\\S+ rwx/.test(line)).length;
}
function countMatches(expression, rounds) {
  let count = 0;
  for (let i = 0; i < rounds; i++) if (expression.test("item " + i + "-" + (i & 7))) count++;
  return count;
}
console.log("at start", writableAndExecutableMappings());
console.log("a literal", countMatches(/(\\d+)-([0-3])$/, 20000), writableAndExecutableMappings());
console.log("plain text in a long subject", "a[_-]?b ".repeat(3000).replace(/\\[_-\\]\\?/g, "").length, writableAndExecutableMappings());
const unknownAtBuildTime = String(Math.floor(Math.random() * 900000) + 100000);
const built = new RegExp("(\\\\d+)-([0-3])$|^" + unknownAtBuildTime + "$");
console.log("built, a few matches", countMatches(built, 8), writableAndExecutableMappings());
console.log("built, many matches", countMatches(built, 20000), writableAndExecutableMappings());
const second = new RegExp("^item \\\\d*7-|^" + unknownAtBuildTime + "$");
console.log("a second one", countMatches(second, 20000), writableAndExecutableMappings());
`,
    });
    const cwd = String(dir);
    const { stderr: buildErrors, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", "app"],
      cwd,
    );
    expect({ buildErrors, buildExitCode }).toEqual({
      buildErrors: expect.not.stringMatching(/^error\b/m),
      buildExitCode: 0,
    });
    const outputs: Record<string, string> = {};
    for (const useRegExpJIT of ["1", "0"]) {
      const { stdout, exitCode } = await run([join(cwd, "app")], cwd, {
        ...bunEnv,
        BUN_JSC_useRegExpJIT: useRegExpJIT,
      });
      expect(exitCode).toBe(0);
      outputs[useRegExpJIT] = stdout;
    }
    expect(outputs).toEqual({
      "1": "at start 0\na literal 10000 0\nplain text in a long subject 9000 0\nbuilt, a few matches 4 0\nbuilt, many matches 10000 0\na second one 2000 0\n",
      "0": "at start 0\na literal 10000 0\nplain text in a long subject 9000 0\nbuilt, a few matches 4 0\nbuilt, many matches 10000 0\na second one 2000 0\n",
    });
  },
);
