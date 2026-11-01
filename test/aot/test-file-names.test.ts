// The runner says which files are test files: `bun test ./checks/latest.ts` needs no ".test" in the name, and the scan takes "Foo.Test.ts".
// What lies beside a test file is the tests' own: it may replace a built-in and load a file that it wrote, as under plain `bun test`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const helper = `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
Buffer.isEncoding = () => true;
export function patched(): boolean { return Buffer.isEncoding("no-such-encoding"); }
export function loadWritten(): number {
  const file = join(mkdtempSync(join(tmpdir(), "written-")), "late.cjs");
  writeFileSync(file, "module.exports = 41 + 1;");
  return require(file);
}
`;
const testFile = `import { expect, test } from "bun:test";
import { loadWritten, patched } from "./helper";
test("the helper replaces a built-in", () => { expect(patched()).toBe(true); });
test("the helper loads a file that it wrote", () => { expect(loadWritten()).toBe(42); });
`;

const runs: [string, string, string[]][] = [
  ["named on the command line", "latest.ts", ["./checks/latest.ts"]],
  ["found by the scan in another case", "Foo.Test.ts", []],
  ["named as usual", "foo.test.ts", []],
];
const forms: [string, string, string[]][] = [
  ["as the run is built by itself", "", []],
  ["one program", "TestRunLayers:0", []],
  ["three layers", "TestRunLayers:3", ["--isolate"]],
];

for (const [how, name, files] of runs) {
  for (const [form, words, flags] of forms) {
    test.concurrent(`a test file ${how}, ${form}`, async () => {
      using dir = tempDir("test-file-names", { [`checks/${name}`]: testFile, "checks/helper.ts": helper });
      await using run = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", ...flags, ...files],
        env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
      expect(stderr.split("\n").filter(line => /^(error|TypeError)\b/.test(line))).toEqual([]);
      expect(stderr).toContain(" 2 pass");
      expect(exitCode).toBe(0);
    });
  }
}
