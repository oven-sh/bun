import { holdSuites } from "./harness/runner-suites";

holdSuites(
  "test/js/bun/test/bun-test.test.ts",
  "test/js/bun/test/ci-restrictions.test.ts",
  "test/js/bun/test/describe.test.ts",
  "test/js/bun/test/expect-extend-preload.test.ts",
  "test/js/bun/test/expect-failure-message-angle-brackets.test.ts",
  "test/js/bun/test/jest-each.test.ts",
  "test/js/bun/test/only-inside-only.test.ts",
  "test/js/bun/test/printing/diffexample.test.ts",
  "test/js/bun/test/printing/dom-nodes.test.ts",
  "test/js/bun/test/snapshot-tests/new-snapshot.test.ts",
  "test/js/bun/test/test-error-code-done-callback.test.ts",
  "test/js/bun/test/test-retry-repeats-basic.test.ts",
  "test/js/bun/test/test-test.test.ts",
  "test/js/bun/test/test-timers.test.ts",
  "test/js/bun/test/vitest-apis.test.ts",
);
