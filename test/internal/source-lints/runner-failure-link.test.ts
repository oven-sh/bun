/**
 * formatTestToMarkdown() (scripts/runner.node.mjs) links every failed file in
 * the Buildkite and GitHub failure annotations as getFileUrl(testPath, line),
 * with the line coming from getErrorLineInFile() (scripts/utils.mjs). Its input
 * is TestResult.errors: every `::error file=...,line=...` annotation that
 * parseTestStdout() collected from the file's output, in the order bun test
 * printed them (a file that throws while loading prints one without any test
 * result line following it). `file` and `line` are the annotation's strings,
 * with `file` relative to the directory bun test ran in.
 */
import { describe, expect, test } from "bun:test";

import { getErrorLineInFile } from "../../../scripts/utils.mjs";

const testPath = "test/js/bun/foo.test.ts";

// Shaped like parseTestStdout()'s TestError, minus the fields that play no part here.
function error(file: string, line?: string) {
  return { file, line, name: "error: boom", stack: "error: boom\n      at <anonymous>" };
}

describe("getErrorLineInFile", () => {
  test("anchors at the first error raised in the test file", () => {
    expect(getErrorLineInFile(testPath, [error(testPath, "7"), error(testPath, "10")])).toBe("7");
  });

  test("an error raised in another file carries that file's line, so it is skipped", () => {
    // A test calling into a helper that throws: the first annotation points at the helper.
    expect(getErrorLineInFile(testPath, [error("test/js/bun/helper.ts", "2"), error(testPath, "7")])).toBe("7");
    expect(getErrorLineInFile(testPath, [error("test/js/bun/helper.ts", "2")])).toBeUndefined();
    expect(getErrorLineInFile(testPath, [error("node_modules/assert/index.js", "40")])).toBeUndefined();
  });

  test("an error without a location is skipped", () => {
    // parseTestStdout() falls back to the test file for a `::error title=...` annotation
    // that has no file= and no line=.
    expect(getErrorLineInFile(testPath, [error(testPath), error(testPath, "10")])).toBe("10");
    expect(getErrorLineInFile(testPath, [error(testPath)])).toBeUndefined();
  });

  test("nothing to anchor at leaves the link unanchored", () => {
    expect(getErrorLineInFile(testPath, [])).toBeUndefined();
    // spawnBunInstall() and the node test runner report no annotations at all.
    expect(getErrorLineInFile(testPath)).toBeUndefined();
  });

  test("compares paths regardless of separator", () => {
    const windowsPath = "test\\js\\bun\\foo.test.ts";
    expect(getErrorLineInFile(windowsPath, [error(windowsPath, "7")])).toBe("7");
    expect(getErrorLineInFile(windowsPath, [error(testPath, "7")])).toBe("7");
    expect(getErrorLineInFile(testPath, [error(windowsPath, "7")])).toBe("7");
    expect(getErrorLineInFile(windowsPath, [error("test\\js\\bun\\helper.ts", "2")])).toBeUndefined();
  });

  test("vendor suites: annotations are relative to the vendored repository, the title is not", () => {
    // runTest() reports a vendor failure under `vendor/<name>/<path>` while bun test
    // ran inside vendor/<name>, so its annotations name `<path>`.
    const title = "vendor/elysia/test/core/handle.test.ts";
    expect(getErrorLineInFile(title, [error("test/core/handle.test.ts", "12")])).toBe("12");
    expect(getErrorLineInFile(title, [error("test/utils.ts", "5"), error("test/core/handle.test.ts", "12")])).toBe(
      "12",
    );
    expect(getErrorLineInFile(title, [error("test/utils.ts", "5")])).toBeUndefined();
  });

  test("a trailing match has to start at a path segment", () => {
    expect(getErrorLineInFile(testPath, [error("o.test.ts", "7")])).toBeUndefined();
    expect(getErrorLineInFile("test/js/bun/not-foo.test.ts", [error("foo.test.ts", "7")])).toBeUndefined();
  });
});
