import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Bun's own tests of its test runner start `bun test` on small projects and hold what Jest and Vitest print for them. Here each of those child runs gets
// `--aot`, so what the runner learns to do reaches compiled runs too, or shows up here.
// runner-suites.known.txt names the tests that still fail so, `<file>: <test>` a line. A test that fails and isn't named there fails its file here, and so does
// one that is named and passes: take its line out.
// `~ ` before a line: that test fails in some runs and passes in others.
// Not here yet: test/cli/test/isolation.test.ts, of which a few tests run out of time on a busy machine without `--aot` too, and test/cli/test/parallel.test.ts.
const root = join(import.meta.dir, "..", "..");
const preload = join(import.meta.dir, "harness", "children-under-aot.ts");

const suites = `
  test/cli/test/bun-test.test.ts
  test/cli/test/concurrent-test-glob.test.ts
  test/cli/test/coverage.test.ts
  test/cli/test/files-from.test.ts
  test/cli/test/isolation-one-module-fetched-twice.test.ts
  test/cli/test/pass-with-no-tests.test.ts
  test/cli/test/path-ignore-patterns.test.ts
  test/cli/test/rerun-each.test.ts
  test/cli/test/retry-flag.test.ts
  test/cli/test/test-changed.test.ts
  test/cli/test/test-environment.test.ts
  test/cli/test/test-filter-lifecycle-snapshot.test.ts
  test/cli/test/test-randomize.test.ts
  test/cli/test/test-shard.test.ts
  test/js/bun/test/bun-test.test.ts
  test/js/bun/test/bun_test.test.ts
  test/js/bun/test/ci-restrictions.test.ts
  test/js/bun/test/concurrent.test.ts
  test/js/bun/test/concurrent_immediate.test.ts
  test/js/bun/test/describe.test.ts
  test/js/bun/test/dots.test.ts
  test/js/bun/test/expect-extend-preload.test.ts
  test/js/bun/test/expect-failure-message-angle-brackets.test.ts
  test/js/bun/test/failure-skip.test.ts
  test/js/bun/test/fake-timers/fake-timers.test.ts
  test/js/bun/test/jest-each.test.ts
  test/js/bun/test/mock/mock-hoist.test.ts
  test/js/bun/test/mock/mock-module.test.ts
  test/js/bun/test/only-failures.test.ts
  test/js/bun/test/only-inside-only.test.ts
  test/js/bun/test/printing/diffexample.test.ts
  test/js/bun/test/printing/dom-nodes.test.ts
  test/js/bun/test/snapshot-tests/new-snapshot.test.ts
  test/js/bun/test/test-error-code-done-callback.test.ts
  test/js/bun/test/test-retry-repeats-basic.test.ts
  test/js/bun/test/test-test.test.ts
  test/js/bun/test/test-timers.test.ts
  test/js/bun/test/vitest-apis.test.ts
  test/js/bun/test/vitest-flavor.test.ts`
  .trim()
  .split(/\s+/);

const known = readFileSync(join(import.meta.dir, "runner-suites.known.txt"), "utf8")
  .split("\n")
  .filter(line => line && !line.startsWith("#"));

describe.concurrent("with its child runs under --aot", () => {
  test.each(suites)(
    "%s",
    async suite => {
      using directory = tempDir("aot-runner-suites", { started: "" });
      const started = join(String(directory), "started");
      const env = { ...bunEnv, NO_COLOR: "1", AOT_CHILDREN_STARTED: started };
      const { stdout, stderr } = await run(
        [bunExe(), "test", "--preload", preload, "--timeout=300000", suite],
        root,
        env,
      );
      // A suite that started no compiled run has shown nothing.
      expect(readFileSync(started).length).toBeGreaterThan(0);
      // A failing test quotes what its child run printed, which has results of its own. Some runs list their own failures once more at the end.
      const lines = (stdout + "\n" + stderr).split("\n");
      const listed = lines.findLastIndex(line => /^\d+ tests? failed:$/.test(line));
      const failed = [...new Set(lines.slice(listed + 1).filter(line => line.startsWith("(fail) ")))];
      expect(` ${failed.length} fail`).toBe(lines.findLast(line => /^ *\d+ fail$/.test(line))!);
      const named = (mark: string) =>
        known
          .filter(line => line.startsWith(mark + suite + ": "))
          .map(line => line.slice(mark.length + suite.length + 2));
      const names = failed.map(line => line.slice(7).replace(/ \[[\d.]+ms\]$/, ""));
      expect(names.filter(name => !named("~ ").includes(name)).sort()).toEqual(named("").sort());
    },
    1_200_000,
  );
});
