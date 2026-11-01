import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const passing = (name: string) => `import { test, expect } from "bun:test";
test("${name}", () => {
  expect(1).toBe(1);
});
`;
const files = {
  "lib.ts": `export const value: number = 1;`,
  "helper.ts": `import { nothing } from "./no-such-helper";
export const helped = nothing;
`,
  "good.test.ts": `import { value } from "./lib";\nconsole.log("good", value);\n${passing("good")}`,
  "also-good.test.ts": `import { value } from "./lib";\nconsole.log("also good", value);\n${passing("also good")}`,
  "missing-file.test.ts": `import { nothing } from "./no-such-file";\nconsole.log(nothing);\n${passing("missing file")}`,
  "missing-package.test.ts": `import made from "no-such-package";\nconsole.log(made);\n${passing("missing package")}`,
  "through-helper.test.ts": `import { helped } from "./helper";\nconsole.log(helped);\n${passing("through helper")}`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  const errors = [...stderr.matchAll(/^error: (Cannot find (?:module|package) .*)$/gm)].map(match => match[1]);
  const count = (word: string) => stderr.match(new RegExp(`^ *(\\d+) ${word}$`, "m"))?.[1];
  return {
    stdout: stdout.split("\n").sort(),
    results: results.sort(),
    errors: errors.sort(),
    pass: count("pass"),
    fail: count("fail"),
    exitCode,
  };
}

test("a test file with an import that names nothing fails alone, with the message of bun test", async () => {
  using dir = tempDir("aot-test-file-fails-alone", files);
  const plain = await runTests(String(dir));
  expect(plain.pass).toBe("2");
  expect(plain.fail).toBe("3");
  expect(plain.errors.length).toBe(3);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 60_000);

test("a build where no test file can be compiled still reports each file", async () => {
  using dir = tempDir("aot-no-test-file-builds", {
    "one.test.ts": `import { nothing } from "./no-such-file";\nconsole.log(nothing);\n${passing("one")}`,
    "two.test.ts": `let same = 1;\nlet same = 2;\n${passing("two")}`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(stderr).toContain("one.test.ts:");
  expect(stderr).toContain("two.test.ts:");
  expect(stderr).toMatch(/^ *0 pass$/m);
  expect(stderr).toMatch(/^ *2 fail$/m);
  expect(exitCode).toBe(1);
}, 60_000);
