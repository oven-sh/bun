import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const fixture = {
  "package.json": JSON.stringify({ name: "related-tests", type: "module" }),
  "src/helper.ts": `export const helper = () => 1;\n`,
  "src/util.ts": `import { helper } from "./helper";\nexport const util = () => helper() + 1;\n`,
  "src/other.ts": `export const other = () => 9;\n`,
  "a.test.ts": `import { test, expect } from "bun:test";\nimport { util } from "./src/util";\ntest("a", () => expect(util()).toBe(2));\n`,
  "b.test.ts": `import { test, expect } from "bun:test";\nimport { other } from "./src/other";\ntest("b", () => expect(other()).toBe(9));\n`,
  "c.test.ts": `import { test, expect } from "bun:test";\ntest("c", () => expect(1).toBe(1));\n`,
  "README.md": "unrelated\n",
};

const testFiles = ["a.test.ts", "b.test.ts", "c.test.ts"];

async function runRelated(cwd: string, paths: string[], flag = "--find-related-tests", extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs, flag, ...paths],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function ranFiles(stderr: string): string[] {
  return testFiles.filter(name => stderr.includes(`${name}:`)).sort();
}

describe.concurrent("bun test --find-related-tests", () => {
  test("selects a test through a transitive dependency", async () => {
    using dir = tempDir("find-related-transitive", fixture);

    const { stderr, exitCode } = await runRelated(String(dir), ["src/helper.ts"]);

    expect(ranFiles(stderr)).toEqual(["a.test.ts"]);
    expect(stderr).toContain("1 source file, running 1/3 test file");
    expect(exitCode).toBe(0);
  });

  test("selects the union for multiple source files", async () => {
    using dir = tempDir("find-related-multiple", fixture);

    const { stderr, exitCode } = await runRelated(String(dir), ["src/helper.ts", "src/other.ts"]);

    expect(ranFiles(stderr)).toEqual(["a.test.ts", "b.test.ts"]);
    expect(stderr).toContain("2 source files, running 2/3 test files");
    expect(exitCode).toBe(0);
  });

  test("accepts an absolute source path", async () => {
    using dir = tempDir("find-related-absolute", fixture);

    const { stderr, exitCode } = await runRelated(String(dir), [join(String(dir), "src", "other.ts")]);

    expect(ranFiles(stderr)).toEqual(["b.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("supports Jest's camel-case flag", async () => {
    using dir = tempDir("find-related-alias", fixture);

    const { stderr, exitCode } = await runRelated(String(dir), ["src/util.ts"], "--findRelatedTests");

    expect(ranFiles(stderr)).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("an unrelated source exits successfully without running tests", async () => {
    using dir = tempDir("find-related-unrelated", fixture);

    const { stderr, exitCode } = await runRelated(String(dir), ["README.md"]);

    expect(ranFiles(stderr)).toEqual([]);
    expect(stderr).toContain("no test files are related");
    expect(exitCode).toBe(0);
  });

  test("reports a missing source file", async () => {
    using dir = tempDir("find-related-missing", {
      "package.json": fixture["package.json"],
    });

    const { stdout, stderr, exitCode } = await runRelated(String(dir), ["src/missing.ts"]);

    expect(stdout).toBeEmpty();
    expect(stderr).toContain("source file not found");
    expect(exitCode).not.toBe(0);
  });

  test("rejects --changed with --find-related-tests", async () => {
    using dir = tempDir("find-related-changed", fixture);

    const { stdout, stderr, exitCode } = await runRelated(String(dir), ["src/helper.ts"], "--find-related-tests", [
      "--changed",
    ]);

    expect(stdout).toBeEmpty();
    expect(stderr).toContain("--changed and --find-related-tests cannot be used together");
    expect(exitCode).not.toBe(0);
  });
});
