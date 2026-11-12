// Runs the vendored Web Platform Tests for import.meta against Bun. The files under import-meta/ are byte-identical to
// upstream: UPSTREAM.md has the commit, the file list and what is left out.
//
// Each file is a module that reads its own import.meta, so it runs as the entry module of its own process.
// ../wpt-testharness-shim.ts runs the text of a file inside a Function, where import.meta is a syntax error.
// testharness-host.mjs is preloaded into that process. It has the testharness.js functions that the files call, and it
// prints one result for each subtest.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const host = join(import.meta.dir, "testharness-host.mjs");

// The number of subtests in each file. A file that does not load, or a subtest that is not reported, fails the suite.
const subtests: Record<string, number> = {
  "import-meta-object.any.js": 3,
  "import-meta-resolve.any.js": 7,
};

// The subtests that do not pass. Each one runs as test.failing, so a subtest that starts to pass fails the suite.
const knownFailures = new Set([
  // import.meta.resolve() with no argument looks for a package with the name "undefined". What it throws is a
  // ResolveMessage, not a TypeError.
  "import.meta.resolve ToString()s its argument",
  // A specifier that is not found throws a ResolveMessage, not a TypeError. "https://eggplant:b/c" is not a valid URL,
  // and Bun returns it as it is.
  "Invalid module specifiers",
]);

type Result = { name: string; status: "PASS" | "FAIL"; message?: string };

const runs = await Promise.all(
  Object.keys(subtests).map(async name => {
    const file = join(import.meta.dir, "import-meta", name);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-install", "--preload", host, file],
      env: { ...bunEnv, WPT_LOCATION: pathToFileURL(file).href },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let results: Result[] = [];
    try {
      results = JSON.parse(stdout);
    } catch {}
    return { name, stdout, stderr, exitCode, results };
  }),
);

for (const { name, stdout, stderr, exitCode, results } of runs) {
  describe(name, () => {
    test("every subtest ran", () => {
      expect({ subtests: results.length, stdout: results.length ? "" : stdout, stderr, exitCode }).toEqual({
        subtests: subtests[name],
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });

    for (const result of results) {
      (knownFailures.has(result.name) ? test.failing : test)(result.name, () => {
        if (result.status !== "PASS") throw new Error(result.message);
      });
    }
  });
}
