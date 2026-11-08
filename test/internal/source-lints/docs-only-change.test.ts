// A pull request whose paths `isDocsOnlyChange()` (scripts/buildkite.ts) accepts gets no Buildkite pipeline: bun is not
// built and the suite does not run. So it must refuse the files that the build puts into bun.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isDocsOnlyChange, pullRequestFilePaths } from "../../../scripts/buildkite.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = resolve(import.meta.dir, "..", "..", "..");
const inSourceLists = Object.values(globAllSources())
  .flat()
  .map(file => relative(root, file).replaceAll("\\", "/"));

test("a change is docs-only when each path is under docs/ and none is under docs/lint/rules/", () => {
  const cases: [paths: string[], docsOnly: boolean][] = [
    [["docs/bundler/esbuild.mdx"], true],
    [["docs/docs.json", "docs/compiler/types.mdx", "docs/lint/index.mdx"], true],
    // What a failed query for the files leaves.
    [[], false],
    [["docs/bundler/esbuild.mdx", "src/cli.rs"], false],
    [["README.md"], false],
    [["packages/bun-types/docs/README.md"], false],
    // The build embeds the rule pages in bun, and `bun lint --rules` of that bun gives the two files beside them.
    [["docs/lint/rules/eslint/eqeqeq.mdx"], false],
    [["docs/lint/rules/index.mdx"], false],
    [["docs/lint/rules/reports.json"], false],
    [["docs/bundler/esbuild.mdx", "docs/lint/rules/eslint/eqeqeq.mdx"], false],
  ];
  expect(cases.map(([paths]) => [paths, isDocsOnlyChange(paths)])).toEqual(cases);
});

test("a moved file counts under its old path too", () => {
  const moved = (from: string, to: string) =>
    pullRequestFilePaths({ filename: to, status: "renamed", previous_filename: from });
  expect(pullRequestFilePaths({ filename: "docs/index.mdx", status: "modified" })).toEqual(["docs/index.mdx"]);
  expect({
    "a page moved inside docs/": isDocsOnlyChange(moved("docs/runtime/a.mdx", "docs/runtime/b.mdx")),
    "a rule page moved out of docs/lint/rules/": isDocsOnlyChange(
      moved("docs/lint/rules/eslint/eqeqeq.mdx", "docs/lint/eqeqeq.mdx"),
    ),
    "a source file moved into docs/": isDocsOnlyChange(moved("src/cli/README.md", "docs/project/cli.md")),
  }).toEqual({
    "a page moved inside docs/": true,
    "a rule page moved out of docs/lint/rules/": false,
    "a source file moved into docs/": false,
  });
});

// This sees the source lists. It does not see a file that the build reaches another way: a fixed path in
// scripts/build/codegen.ts, or an `include_str!`.
test("no file in a source list of scripts/glob-sources.ts is docs-only", () => {
  // Without a docs file in the source lists, the next assertion would hold for any rule.
  expect(inSourceLists.filter(file => file.startsWith("docs/")).length).toBeGreaterThan(1000);
  expect(inSourceLists.filter(file => isDocsOnlyChange([file]))).toEqual([]);
});

// Both scripts do their work when they are imported, so they are read as text.
test("the pipeline step and the test runner decide with isDocsOnlyChange()", () => {
  const conditionsAbove = (file: string, line: string) =>
    Array.from(readFileSync(join(root, file), "utf8").matchAll(/^\s*if \((.+)\) \{\r?\n(.*)$/gm))
      .filter(([, , next]) => next.trim() === line)
      .map(([, condition]) => condition);
  expect({
    ".buildkite/ci.ts": conditionsAbove(".buildkite/ci.ts", "console.log(`- PR is only docs, skipping tests!`);"),
    "scripts/runner.node.ts": conditionsAbove("scripts/runner.node.ts", "doRunTests = false;"),
  }).toEqual({
    ".buildkite/ci.ts": ["isDocsOnlyChange(allFiles)"],
    "scripts/runner.node.ts": ["isDocsOnlyChange(allFiles)"],
  });
});
