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

// Over layers the fault had words of its own: a TypeError when the file ran, where one program refused the file at the build.
const runs: [string, string, string[], string?][] = [
  ["named on the command line", "latest.ts", ["./checks/latest.ts"]],
  ["found by the scan in another case", "Foo.Test.ts", []],
  ["named as usual", "foo.test.ts", []],
];

for (const [how, name, files, words] of runs) {
  test.concurrent(`a test file ${how}`, async () => {
    using dir = tempDir("test-file-names", { [`checks/${name}`]: testFile, "checks/helper.ts": helper });
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", ...files],
      env: words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv,
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
