// Every expect matcher must bump the test runner's expect-call counter so
// `expect.assertions(n)` / `expect.hasAssertions()` work. Matchers either call
// `increment_expect_call_counter()` directly or route through one of the
// shared prologues that call it.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { basename, join } from "path";

const MATCHER_DIR = join(import.meta.dir, "../../../src/runtime/test_runner/expect");

// Helpers that call increment_expect_call_counter() internally (verified in
// src/runtime/test_runner/expect.rs and mod.rs).
const satisfying = [
  "increment_expect_call_counter",
  "matcher_prelude",
  "unary_predicate_matcher!",
  "run_unary_predicate",
  "run_string_affix_matcher",
  "contain_matcher",
  "numeric_ordering_matcher",
  "mock_prologue",
];

// Matchers that delegate to another matcher's implementation.
const excluded = new Set(["toHaveReturnedTimes.rs"]);

test("every expect matcher increments the expect-call counter", () => {
  const glob = new Glob("*.rs");
  const files = [...glob.scanSync({ cwd: MATCHER_DIR, absolute: true })].sort();
  expect(files.length).toBeGreaterThan(40);

  const missing: string[] = [];
  for (const file of files) {
    if (excluded.has(basename(file))) continue;
    const src = readFileSync(file, "utf8");
    if (!satisfying.some(token => src.includes(token))) {
      missing.push(basename(file));
    }
  }

  expect(missing).toEqual([]);
});
