import { holdSuites } from "../harness/runner-suites";

holdSuites(
  "test/js/bun/test/done-async.test.ts",
  "test/js/bun/test/expect-assertions.test.ts",
  "test/js/bun/test/expect-deferred.test.ts",
  "test/js/bun/test/expect-extend.test.js",
  "test/js/bun/test/expect-formdata-tojson-crash.test.ts",
  "test/js/bun/test/jest-each-gc-root.test.ts",
  "test/js/bun/test/mock-fn.test.js",
  "test/js/bun/test/pretty-format-overflow.test.ts",
  "test/js/bun/test/require-bun-test.test.ts",
  "test/js/bun/test/test-auto-import-jest-globals.test.js",
  "test/js/bun/test/test-failing.test.ts",
  "test/js/bun/test/test-only.test.ts",
);
