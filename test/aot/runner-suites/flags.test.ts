import { holdSuites } from "../harness/runner-suites";

holdSuites(
  "test/cli/test/concurrent-test-glob.test.ts",
  "test/cli/test/files-from.test.ts",
  "test/cli/test/pass-with-no-tests.test.ts",
  "test/cli/test/path-ignore-patterns.test.ts",
  "test/cli/test/rerun-each.test.ts",
  "test/cli/test/retry-flag.test.ts",
  "test/cli/test/test-changed.test.ts",
  "test/cli/test/test-filter-lifecycle-snapshot.test.ts",
  "test/cli/test/test-shard.test.ts",
);
